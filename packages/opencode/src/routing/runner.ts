import z from "zod"
import path from "path"
import { $ } from "bun"
import { ulid } from "ulid"
import { stableJson } from "@/util/stable-json"
import { EvidenceWriter } from "@/evidence/writer"
import { Instance } from "@/project/instance"
import { RoutingRunRequest, RoutingTier, RoutingWorkerId } from "@/protocol/routing-run-request"
import { RoutingWorkerResult } from "@/protocol/routing-worker-result"
import { resolveRoutingConfig, RoutingConfigOverride } from "./config"
import { routingCacheKey, routingConfigFingerprint, routingRepoFingerprint, readRoutingCache, sha256Text, writeRoutingCache } from "./cache"
import { WorkerA } from "./worker-a"
import { WorkerB } from "./worker-b"
import { WorkerC } from "./worker-c"

const RunInput = z
  .object({
    sessionId: z.string().min(1),
    messageId: z.string().min(1),
    intentText: z.string().min(1),
    tier: RoutingTier,
    config: RoutingConfigOverride.optional(),
  })
  .strict()

type WorkerResult = z.infer<typeof RoutingWorkerResult>["result"]
type WorkerCore = {
  status: z.infer<typeof RoutingWorkerResult>["status"]
  result: WorkerResult
  capsule: z.infer<typeof RoutingWorkerResult>["capsule"]
  errors: z.infer<typeof RoutingWorkerResult>["errors"]
}

const normalizeIntent = (text: string) => text.trim().replace(/\s+/g, " ")

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const withTimeout = async <T>(promise: Promise<T>, ms: number) => {
  const timer = delay(ms).then(() => ({ ok: false as const }))
  const result = await Promise.race([
    promise.then((value) => ({ ok: true as const, value })),
    timer,
  ])
  return result
}

const baseCapsule = (handoff: string) => ({
  handoff,
  pointers: [],
  openQuestions: [],
})

const emptyResult: Record<z.infer<typeof RoutingWorkerId>, WorkerResult> = {
  worker_a_repo: {
    kind: "repo-lsp",
    files: [],
  },
  worker_b_kb: {
    kind: "kb-rag",
    hits: [],
    queries: [],
  },
  worker_c_graph: {
    kind: "graph-impact",
    seeds: [],
    nodes: [],
    edges: [],
    queries: [],
  },
}

const unavailableCore = (workerId: z.infer<typeof RoutingWorkerId>, message: string): WorkerCore => ({
  status: "unavailable",
  result: emptyResult[workerId],
  capsule: baseCapsule(message),
  errors: [{ message, code: "worker_unavailable" }],
})

const timeoutCore = (workerId: z.infer<typeof RoutingWorkerId>, message: string): WorkerCore => ({
  status: "error",
  result: emptyResult[workerId],
  capsule: baseCapsule(message),
  errors: [{ message, code: "worker_timeout" }],
})

const buildResult = (input: {
  runId: string
  sessionId: string
  workerId: z.infer<typeof RoutingWorkerId>
  cache: { hit: boolean; key: string; reason: z.infer<typeof RoutingWorkerResult>["cache"]["reason"] }
  timing: { startedAtUtc: string; endedAtUtc: string; durationMs: number }
  inputs: { intentFingerprint: string; repoFingerprint: string; configFingerprint: string }
  core: WorkerCore
}) => {
  return RoutingWorkerResult.parse({
    specVersion: "routing-worker-result/1.0",
    routingRunId: input.runId,
    sessionId: input.sessionId,
    workerId: input.workerId,
    status: input.core.status,
    cache: {
      hit: input.cache.hit,
      key: input.cache.key,
      scope: "project",
      reason: input.cache.reason,
    },
    timing: input.timing,
    inputs: input.inputs,
    result: input.core.result,
    capsule: input.core.capsule,
    errors: input.core.errors,
  })
}

const gitDiff = async (root: string) => {
  const proc = await $`git diff --patch --no-color`.quiet().nothrow().cwd(root)
  if (proc.exitCode > 1) return ""
  return proc.stdout?.toString() ?? ""
}

const gitDiffCached = async (root: string) => {
  const proc = await $`git diff --patch --no-color --cached`.quiet().nothrow().cwd(root)
  if (proc.exitCode > 1) return ""
  return proc.stdout?.toString() ?? ""
}

const isInternalPath = (value: string) => value === ".opencode" || value.startsWith(".opencode/")

const gitUntracked = async (root: string) => {
  const proc = await $`git ls-files --others --exclude-standard`.quiet().nothrow().cwd(root)
  if (proc.exitCode !== 0) return [] as string[]
  return (proc.stdout?.toString() ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => Boolean(line) && !isInternalPath(line))
    .toSorted()
}

const gitPatch = async (root: string) => {
  const base = await gitDiff(root)
  const staged = await gitDiffCached(root)
  const untracked = await gitUntracked(root)
  const adds = await Promise.all(
    untracked.map(async (file) => {
      const proc = await $`git diff --patch --no-color --no-index /dev/null ${file}`
        .quiet()
        .nothrow()
        .cwd(root)
      if (proc.exitCode > 1) return ""
      return proc.stdout?.toString() ?? ""
    }),
  )
  return [base, staged, ...adds].join("")
}

const resolveRepo = async (root: string) => {
  const headProc = await $`git rev-parse HEAD`.quiet().nothrow().cwd(root)
  if (headProc.exitCode !== 0) {
    return { vcs: "none" as const, head: "", dirty: false, diffFingerprint: "" }
  }
  const head = headProc.stdout?.toString().trim() ?? ""
  if (!head) {
    return { vcs: "none" as const, head: "", dirty: false, diffFingerprint: "" }
  }
  const statusProc = await $`git status --porcelain`.quiet().nothrow().cwd(root)
  const status = statusProc.exitCode === 0 ? statusProc.stdout?.toString() ?? "" : ""
  const dirty = status.trim().length > 0
  if (!dirty) {
    return { vcs: "git" as const, head, dirty: false, diffFingerprint: "" }
  }
  const patch = await gitPatch(root)
  const diffFingerprint = sha256Text(patch)
  return { vcs: "git" as const, head, dirty: true, diffFingerprint }
}

const capsuleText = (input: {
  runId: string
  sessionId: string
  request: { path: string; sha256: string }
  results: Array<{ workerId: string; status: string; path: string; sha256: string }>
}) => {
  const lines = [
    "---",
    "artifactKind: routing-capsule",
    "specVersion: routing-capsule/1.0",
    `routingRunId: ${input.runId}`,
    `sessionId: ${input.sessionId}`,
    "---",
    "",
    "# Routing Capsule",
    "",
    "## Workers",
    ...input.results.map((item) => `- ${item.workerId}: ${item.status}`),
    "",
    "## Artifacts",
    `- request.json: ${input.request.path} (${input.request.sha256})`,
    ...input.results.map((item) => `- ${item.path} (${item.sha256})`),
    "",
  ]
  return lines.join("\n")
}

export const RoutingRunner = {
  async run(input: z.infer<typeof RunInput>) {
    const data = RunInput.parse(input)
    const config = resolveRoutingConfig(data.config)
    const writer = await EvidenceWriter.open({ sessionId: data.sessionId })
    const runId = ulid()
    const started = new Date().toISOString()
    await writer.event({
      specVersion: "event/1.0",
      ts: started,
      sessionId: data.sessionId,
      severity: "info",
      actor: "routing:runner",
      type: "routing.started",
      summary: "routing started",
      data: {
        routingRunId: runId,
      },
      redaction: { applied: true, policyVersion: "v1" },
    })

    const intentNormalized = normalizeIntent(data.intentText)
    const intentFingerprint = sha256Text(intentNormalized + "\n" + config.versions.routingTemplate)
    const repo = await resolveRepo(Instance.worktree)
    const repoFingerprint = routingRepoFingerprint(repo)
    const configFingerprint = routingConfigFingerprint(config)

    const request = RoutingRunRequest.parse({
      specVersion: "routing-run-request/1.0",
      routingRunId: runId,
      sessionId: data.sessionId,
      messageId: data.messageId,
      tier: data.tier,
      intent: {
        text: data.intentText,
        normalized: intentNormalized,
        fingerprint: intentFingerprint,
      },
      project: {
        projectId: Instance.project.id,
        worktreeRoot: Instance.worktree,
      },
      repo,
      budgets: {
        maxWallClockMs: config.maxWallClockMs,
        workerTimeoutMs: config.workerTimeoutMs,
        topK: config.topK,
      },
      workers: config.workers,
      versions: config.versions,
    })

    const requestEntry = await writer.artifact({
      kind: "routing-run-request",
      path: path.join("routing", runId, "request.json"),
      data: stableJson(request),
    })

    const scope = {
      projectId: Instance.project.id,
      worktreeRoot: Instance.worktree,
    }

    const timeoutMs = Math.min(config.workerTimeoutMs, config.maxWallClockMs)
    const workers = [
      {
        id: "worker_a_repo" as const,
        enabled: config.workers.worker_a_repo.enabled,
        topK: config.workers.worker_a_repo.topK,
        run: WorkerA.run,
        filename: "worker-a.result.json",
      },
      {
        id: "worker_b_kb" as const,
        enabled: config.workers.worker_b_kb.enabled,
        topK: config.workers.worker_b_kb.topK,
        run: WorkerB.run,
        filename: "worker-b.result.json",
      },
      {
        id: "worker_c_graph" as const,
        enabled: config.workers.worker_c_graph.enabled,
        topK: config.workers.worker_c_graph.topK,
        run: WorkerC.run,
        filename: "worker-c.result.json",
      },
    ]

    const limited = workers.slice(0, config.maxWorkersInFlight)
    const skipped = workers.slice(config.maxWorkersInFlight)

    const executed = await Promise.all(
      limited.map(async (item) => {
        const key = routingCacheKey({
          workerId: item.id,
          scope,
          repoFingerprint,
          intentFingerprint,
          configFingerprint,
        })

        const cached = await readRoutingCache(key)
        if (cached) {
          const now = Date.now()
          const result = buildResult({
            runId,
            sessionId: data.sessionId,
            workerId: item.id,
            cache: { hit: true, key, reason: "exact_match" },
            timing: {
              startedAtUtc: new Date(now).toISOString(),
              endedAtUtc: new Date(now).toISOString(),
              durationMs: 0,
            },
            inputs: { intentFingerprint, repoFingerprint, configFingerprint },
            core: {
              status: cached.status,
              result: cached.result,
              capsule: cached.capsule,
              errors: cached.errors,
            },
          })
          return result
        }

        if (!item.enabled) {
          const now = Date.now()
          const result = buildResult({
            runId,
            sessionId: data.sessionId,
            workerId: item.id,
            cache: { hit: false, key, reason: "disabled" },
            timing: {
              startedAtUtc: new Date(now).toISOString(),
              endedAtUtc: new Date(now).toISOString(),
              durationMs: 0,
            },
            inputs: { intentFingerprint, repoFingerprint, configFingerprint },
            core: unavailableCore(item.id, "worker disabled"),
          })
          return result
        }

        const start = Date.now()
        const output = await withTimeout(
          item.run({
            root: Instance.worktree,
            topK: item.topK,
            intent: data.intentText,
          }),
          timeoutMs,
        )
        const end = Date.now()

        if (!output.ok) {
          const result = buildResult({
            runId,
            sessionId: data.sessionId,
            workerId: item.id,
            cache: { hit: false, key, reason: "ttl_expired" },
            timing: {
              startedAtUtc: new Date(start).toISOString(),
              endedAtUtc: new Date(end).toISOString(),
              durationMs: Math.max(0, end - start),
            },
            inputs: { intentFingerprint, repoFingerprint, configFingerprint },
            core: timeoutCore(item.id, "worker timeout"),
          })
          await writeRoutingCache(key, result)
          return result
        }

        const result = buildResult({
          runId,
          sessionId: data.sessionId,
          workerId: item.id,
          cache: { hit: false, key, reason: "ttl_expired" },
          timing: {
            startedAtUtc: new Date(start).toISOString(),
            endedAtUtc: new Date(end).toISOString(),
            durationMs: Math.max(0, end - start),
          },
          inputs: { intentFingerprint, repoFingerprint, configFingerprint },
          core: output.value,
        })
        await writeRoutingCache(key, result)
        return result
      }),
    )

    const skippedResults = skipped.map((item) => {
      const key = routingCacheKey({
        workerId: item.id,
        scope,
        repoFingerprint,
        intentFingerprint,
        configFingerprint,
      })
      const now = Date.now()
      return buildResult({
        runId,
        sessionId: data.sessionId,
        workerId: item.id,
        cache: { hit: false, key, reason: "disabled" },
        timing: {
          startedAtUtc: new Date(now).toISOString(),
          endedAtUtc: new Date(now).toISOString(),
          durationMs: 0,
        },
        inputs: { intentFingerprint, repoFingerprint, configFingerprint },
        core: unavailableCore(item.id, "worker skipped"),
      })
    })

    const results = [...executed, ...skippedResults]

    const resultEntries = await Promise.all(
      results.map(async (item, index) => {
        const name = workers[index]?.filename ?? "worker.result.json"
        const entry = await writer.artifact({
          kind: "routing-worker-result",
          path: path.join("routing", runId, name),
          data: stableJson(item),
        })
        return {
          workerId: item.workerId,
          status: item.status,
          path: entry.path,
          sha256: entry.sha256,
        }
      }),
    )

    const capsule = capsuleText({
      runId,
      sessionId: data.sessionId,
      request: { path: requestEntry.path, sha256: requestEntry.sha256 },
      results: resultEntries.map((item) => ({
        workerId: item.workerId,
        status: item.status,
        path: item.path,
        sha256: item.sha256,
      })),
    })

    const capsuleEntry = await writer.artifact({
      kind: "routing-capsule",
      path: path.join("routing", runId, "routing.capsule.md"),
      data: capsule,
    })

    await writer.event({
      specVersion: "event/1.0",
      ts: new Date().toISOString(),
      sessionId: data.sessionId,
      severity: "info",
      actor: "routing:runner",
      type: "routing.completed",
      summary: "routing completed",
      data: {
        routingRunId: runId,
        request: requestEntry.path,
        capsule: capsuleEntry.path,
      },
      redaction: { applied: true, policyVersion: "v1" },
    })

    return {
      routingRunId: runId,
      requestPath: requestEntry.path,
      capsulePath: capsuleEntry.path,
      results: resultEntries.map((item) => item.path),
    }
  },
}
