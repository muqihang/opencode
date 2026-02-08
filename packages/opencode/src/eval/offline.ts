import fs from "fs/promises"
import { $ } from "bun"
import path from "path"
import { EvidenceWriter } from "@/evidence/writer"
import { verifyEvidenceChain } from "@/evidence/chain"
import { runRetrieval } from "@/retrieval/runner"
import { RoutingRunner } from "@/routing/runner"
import { sha256Text } from "@/routing/cache"
import { RoutingRunRequest } from "@/protocol/routing-run-request"
import { stableJson } from "@/util/stable-json"
import { Instance } from "@/project/instance"
import { exportEvidence } from "@/evidence/export"
import { defer } from "@/util/defer"
import { EvidenceManifest } from "@/protocol/evidence-manifest"
import { EvidencePack } from "@/protocol/evidence-pack"
import { extractFeatures } from "@/session/orchestrator/features"
import { buildPlan } from "@/session/orchestrator/plan"
import { runToolBroker } from "@/session/orchestrator/tool-broker"
import { ToolRequest } from "@/protocol/llm-worker-result"
import { OrchestratorPlan } from "@/protocol/orchestrator-plan"
import { z } from "zod"
import { evaluateOfflineGate, OFFLINE_EVAL_SPEC, type OfflineGateResult } from "./offline-gate"

type Status = "pass" | "fail" | "skip"

type Check = {
  ok: boolean
  status: Status
  artifact: string
  detail: Record<string, unknown>
  errorZh?: string
}

export type OfflineEvalResult = {
  kind: "eval"
  suite: "offline"
  sessionId: string
  fixtureDir: string
  exportDir: string
  evidenceDir: string
  checks: {
    routingContract: Check
    retrievalDeterminism: Check
    orchestratorPlanDeterminism: Check
    toolBrokerNonInteractive: Check
    compactionPointers: Check
    evidenceChain: Check
    exportEvidenceChain: Check
  }
}

const baseDir = () => (Instance.worktree === "/" ? Instance.directory : Instance.worktree)

const baseline = {
  routingContractHash: "e7c7e8214a952671261330a04c5965aec5f4beb43aff9ced0a4ea2762b7b2638",
  retrievalDeterminismHash: "0adc7f7de965d2bb52ff5264e82ae0aca97d0f24b2e91f1ad7ece13cfcbc492c",
  orchestratorPlanChatHash: "0844c28fe130faf00de6ce8e9e6e2d69474e9bc6483ecb9e4232378feb57083f",
  orchestratorPlanAssistHash: "5c703f8dc3c099d6fe7a1057820ba7bc724353c015237e6209a69109c6dcef98",
  orchestratorPlanForkHash: "86282fe6b138c7b857ec002521ffe3f37c9a234aaf867ca17cb7f596816951bd",
  toolBrokerContractHash: "d8cfa578753c0dd35feb72057e483c4062f8feea2d86c5196b8fd071afc7b28b",
} as const

const asPath = (value: unknown) => (typeof value === "string" ? value : "")

const pointerPath = (value: unknown) => {
  if (typeof value === "string") return value
  if (!value || typeof value !== "object") return ""
  const ref = (value as { ref?: unknown }).ref
  return asPath(ref)
}

const normRel = (value: string) => value.replace(/\\/g, "/").replace(/\/+/g, "/")

const isCapsuleRef = (ref: string) =>
  ref.endsWith("capsule.session.json") ||
  ref.endsWith("capsule.handoff.json") ||
  ref.endsWith("capsule.assisted.json") ||
  ref.endsWith("capsule.assisted.md") ||
  ref.endsWith("capsule.assisted.verify.json")

const exportArtifactPath = (input: { sessionId: string; ref: string }) => {
  const normalized = normRel(input.ref)
  const prefix = `.opencode/artifacts/${input.sessionId}/`
  if (normalized.startsWith(prefix)) return `artifacts/${normalized.slice(prefix.length)}`
  if (normalized.startsWith("artifacts/")) return normalized
  if (normalized.startsWith(".opencode/")) return ""
  return `artifacts/${normalized}`
}

export const verifyOfflineExportEvidenceChain = async (input: {
  exportDir: string
  sessionId: string
}): Promise<ReturnType<typeof verifyEvidenceChain>> => {
  const manifestAbs = path.join(input.exportDir, "manifest.json")
  const manifestRaw = (await Bun.file(manifestAbs).json().catch(() => null)) as unknown
  const manifest = manifestRaw ? EvidenceManifest.safeParse(manifestRaw) : { success: false as const }

  const packAbs = path.join(input.exportDir, "pack.json")
  const packRaw = (await Bun.file(packAbs).json().catch(() => null)) as unknown
  const pack = packRaw ? EvidencePack.safeParse(packRaw) : { success: false as const }

  const manifestRefs = manifest.success ? manifest.data.entries.map((e) => e.path) : []
  const packRefs = pack.success ? pack.data.capsule.pointers.map((p) => pointerPath(p)).filter((p) => p) : []

  const refs = [...manifestRefs, ...packRefs].map((p) => normRel(p)).filter((p) => p)
  const required = [...new Set(refs.filter((p) => isCapsuleRef(p)).map((p) => exportArtifactPath({ sessionId: input.sessionId, ref: p })))].filter((p) => p).toSorted()

  const existing = (
    await Promise.all(
      required.map(async (p) => {
        const ok = await Bun.file(path.join(input.exportDir, p)).exists()
        return ok ? p : ""
      }),
    )
  ).filter((p) => p)

  return verifyEvidenceChain({
    entries: required.map((p) => ({ path: p, kind: "export:required" })),
    existing,
    headerZh: "证据断链：导出目录缺失被引用的 capsule/handoff/assisted 产物（引用了就不断链）",
  })
}

const fingerprintRetrievalHits = async (input: { sessionId: string; rel: string }) => {
  const abs = path.join(baseDir(), ".opencode", "artifacts", input.sessionId, input.rel)
  const raw = (await Bun.file(abs).json().catch(() => [])) as unknown
  const hits = Array.isArray(raw) ? raw : []
  const norm = hits
    .map((item) => {
      if (!item || typeof item !== "object") return
      const hit = item as Record<string, unknown>
      const pointer = hit.pointer && typeof hit.pointer === "object" ? (hit.pointer as Record<string, unknown>) : undefined
      const origin = hit.origin && typeof hit.origin === "object" ? (hit.origin as Record<string, unknown>) : undefined
      const sha256 = typeof pointer?.sha256 === "string" ? pointer.sha256 : ""
      const src = typeof hit.source === "string" ? hit.source : ""
      const oPath = typeof origin?.path === "string" ? origin.path : ""
      const oStart = typeof origin?.lineStart === "number" ? origin.lineStart : 0
      const oEnd = typeof origin?.lineEnd === "number" ? origin.lineEnd : 0
      if (!sha256 || !src || !oPath) return
      return { source: src, origin: { path: oPath, lineStart: oStart, lineEnd: oEnd }, sha256 }
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x))
    .toSorted((a, b) => stableJson(a).localeCompare(stableJson(b)))
  const payload = stableJson({ specVersion: "eval-retrieval-fingerprint/1.0", hits: norm })
  return { hash: sha256Text(payload), hits: norm }
}

const check = (ok: boolean) => ({ ok, status: ok ? ("pass" as const) : ("fail" as const) })

const planShape = (plan: OrchestratorPlan) => {
  const evidencePolicy = plan.evidencePolicy
    ? { enabled: plan.evidencePolicy.enabled, mode: plan.evidencePolicy.mode }
    : null

  return {
    orchestratorMode: plan.orchestratorMode,
    uxMode: plan.uxMode,
    workers: plan.workers.map((item) => ({
      id: item.id,
      model: item.model,
      budget: { timeoutMs: item.budget.timeoutMs },
    })),
    budgets: plan.budgets,
    toolPolicy: plan.toolPolicy,
    evidencePolicy,
    reasons: plan.reasons.map((item) => item.code),
  }
}

const planHash = (shape: ReturnType<typeof planShape>) =>
  sha256Text(stableJson({ specVersion: "eval-orchestrator-plan/1.0", shape }))

const pointerScope = (input: {
  sessionId: string
  pointers?: {
    artifacts: { path: string; kind?: string }[]
    topK: { path: string }[]
  }
}) => {
  if (!input.pointers) {
    return {
      ok: false,
      artifacts: [] as Array<"retrieval" | "tool-broker" | "other">,
      topK: [] as boolean[],
      counts: { retrieval: 0, toolBroker: 0, other: 0 },
    }
  }

  const retrievalPrefix = `.opencode/artifacts/${input.sessionId}/retrieval/`
  const toolBrokerPrefix = `.opencode/artifacts/${input.sessionId}/tool-broker/`
  const artifacts = input.pointers.artifacts.map((item) => {
    if (item.path.startsWith(retrievalPrefix)) return "retrieval" as const
    if (item.path.startsWith(toolBrokerPrefix) && item.kind === "tool-broker-pointer") return "tool-broker" as const
    return "other" as const
  })
  const topK = input.pointers.topK.map((item) => item.path.startsWith(retrievalPrefix))
  const counts = {
    retrieval: artifacts.filter((item) => item === "retrieval").length,
    toolBroker: artifacts.filter((item) => item === "tool-broker").length,
    other: artifacts.filter((item) => item === "other").length,
  }
  const ok = topK.every(Boolean) && counts.other === 0
  return { ok, artifacts, topK, counts }
}

const fixtureFiles = () => [
  { rel: "README.md", text: "# Offline Eval Fixture\n\nThis is an eval-only fixture repo.\n" },
  { rel: "src/alpha.ts", text: "export const alpha = 1\n" },
  { rel: "src/beta.ts", text: "export const beta = 2\n" },
  { rel: "docs/notes.md", text: "alpha and beta\n" },
]

const runGit = async (cwd: string, args: string[]) => {
  const proc = await $`git ${args}`.quiet().nothrow().cwd(cwd)
  return proc.exitCode
}

const initFixtureRepo = async (dir: string) => {
  await fs.mkdir(dir, { recursive: true })
  await Promise.all(
    fixtureFiles().map(async (item) => {
      const file = path.join(dir, item.rel)
      await fs.mkdir(path.dirname(file), { recursive: true })
      await Bun.write(file, item.text)
    }),
  )

  const init = await runGit(dir, ["init"])
  if (init !== 0) throw new Error("eval fixture git init failed")

  const name = await runGit(dir, ["config", "user.name", "opencode-eval"])
  if (name !== 0) throw new Error("eval fixture git config user.name failed")

  const email = await runGit(dir, ["config", "user.email", "opencode-eval@local"])
  if (email !== 0) throw new Error("eval fixture git config user.email failed")

  const add = await runGit(dir, ["add", "-A"])
  if (add !== 0) throw new Error("eval fixture git add failed")

  const commit = await runGit(dir, ["commit", "-m", "eval fixture"])
  if (commit !== 0) throw new Error("eval fixture git commit failed")
}

export const runOfflineEval = async (input: {
  suite: "offline"
  sessionId?: string
  intentText?: string
  rootDir?: string
  outDir?: string
}): Promise<OfflineEvalResult> => {
  const rootDir = input.rootDir ?? baseDir()
  const sessionId = input.sessionId ?? "eval_offline"
  const intentText = input.intentText ?? "alpha"
  const exportDir = path.resolve(rootDir, input.outDir ?? path.join(".opencode", "evals", sessionId))
  const fixtureDir = path.join(exportDir, "fixture")

  await initFixtureRepo(fixtureDir)

  return Instance.provide({
    directory: fixtureDir,
    fn: async () => {
      const prior = process.env["OPENCODE_DISABLE_LSP"]
      process.env["OPENCODE_DISABLE_LSP"] = "1"
      using _ = defer(() => {
        if (prior === undefined) {
          delete process.env["OPENCODE_DISABLE_LSP"]
          return
        }
        process.env["OPENCODE_DISABLE_LSP"] = prior
      })

      const messageId = "eval_message"
      const writer = await EvidenceWriter.open({ sessionId })

      writer.task({
        title: "EVAL: offline",
        intent: "EVAL: offline",
        successCriteria: ["offline regression checks pass", "evidence pack exported"],
        constraints: ["OFFLINE ONLY", "DO NOT CONFUSE WITH REAL SESSION"],
      })

      await writer.event({
        specVersion: "event/1.0",
        ts: new Date().toISOString(),
        sessionId,
        severity: "info",
        actor: "eval:offline",
        type: "eval.started",
        summary: "offline eval started",
        data: { suite: "offline" },
        redaction: { applied: true, policyVersion: "v1" },
      })

      const routing = await RoutingRunner.run({
        sessionId,
        messageId,
        intentText,
        tier: "plan",
      })

      const requestAbs = path.join(
        baseDir(),
        ".opencode",
        "artifacts",
        sessionId,
        "routing",
        routing.routingRunId,
        "request.json",
      )
      const request = RoutingRunRequest.parse(await Bun.file(requestAbs).json())

      const canonical = {
        specVersion: request.specVersion,
        tier: request.tier,
        budgets: request.budgets,
        workers: request.workers,
        versions: request.versions,
        intent: { normalized: request.intent.normalized, fingerprint: request.intent.fingerprint },
        repo: { vcs: request.repo.vcs, dirty: request.repo.dirty },
      }
      const routingHash = sha256Text(stableJson(canonical))
      const routingEntry = await writer.artifact({
        kind: "eval-routing-contract",
        path: "eval/routing.contract.json",
        data: stableJson({
          specVersion: "eval-routing-contract/1.0",
          hash: routingHash,
          expected: baseline.routingContractHash,
          canonical,
        }),
      })

      const routingOk = routingHash === baseline.routingContractHash
      await writer.check({
        id: "eval:routing.contract",
        command: "RoutingRunRequest.parse + stableJson(canonical) hash",
        status: check(routingOk).status,
        artifact: routingEntry.path,
      })

      const abort = AbortSignal.any([])
      const first = await runRetrieval({ sessionId, messageId: "eval_retr_1", intentText, abort })
      const second = await runRetrieval({ sessionId, messageId: "eval_retr_2", intentText, abort })

      const fpA = await fingerprintRetrievalHits({ sessionId, rel: first.artifacts.hits })
      const fpB = await fingerprintRetrievalHits({ sessionId, rel: second.artifacts.hits })
      const retrievalOk = fpA.hash === fpB.hash && fpA.hash === baseline.retrievalDeterminismHash

      const retrievalEntry = await writer.artifact({
        kind: "eval-retrieval-determinism",
        path: "eval/retrieval.determinism.json",
        data: stableJson({
          specVersion: "eval-retrieval-determinism/1.0",
          intentText,
          hash: fpA.hash,
          again: fpB.hash,
          expected: baseline.retrievalDeterminismHash,
          samples: fpA.hits.slice(0, 5),
        }),
      })

      await writer.check({
        id: "eval:retrieval.determinism",
        command: "same input -> same normalized hits hash (sha256 over origin+sha256)",
        status: check(retrievalOk).status,
        artifact: retrievalEntry.path,
      })

      const toolsetFingerprint = sha256Text("eval-toolset")
      const planCases = [
        { name: "chat", intentText: "alpha", expected: baseline.orchestratorPlanChatHash },
        { name: "assist", intentText: "please provide evidence", expected: baseline.orchestratorPlanAssistHash },
        { name: "fork", intentText: "帮我改一下 foo.ts 并运行测试", expected: baseline.orchestratorPlanForkHash },
      ]

      const planResults = await Promise.all(
        planCases.map(async (item) => {
          const features = extractFeatures({
            uxMode: "auto",
            intentText: item.intentText,
            hasFileParts: false,
          })
          const built = await buildPlan({
            sessionId,
            messageId: `eval_plan_${item.name}`,
            features,
            toolsetFingerprint,
          })
          const shape = planShape(built.plan)
          const hash = planHash(shape)
          return { name: item.name, hash, expected: item.expected, shape }
        }),
      )

      const planOk = planResults.every((item) => item.hash === item.expected)
      const planEntry = await writer.artifact({
        kind: "eval-orchestrator-plan",
        path: "eval/orchestrator.plan.json",
        data: stableJson({
          specVersion: "eval-orchestrator-plan/1.0",
          cases: planResults,
        }),
      })

      await writer.check({
        id: "eval:orchestrator.plan",
        command: "extractFeatures + buildPlan -> planShape hash",
        status: check(planOk).status,
        artifact: planEntry.path,
      })

      const toolRequests: ToolRequest[] = [
        { kind: "verification", input: "please provide evidence" },
        { kind: "retrieval", input: "alpha" },
      ]
      const broker = await runToolBroker({
        sessionId,
        messageId: "eval_tool_broker",
        toolRequests,
        toolPolicy: { allowed: ["retrieval"], bounceMax: 1 },
        abort,
      })
      const brokerResults = broker.results.map((item) => {
        const summaryTotal = typeof item.summary?.total === "number" ? item.summary.total : null
        const scope = pointerScope({ sessionId, pointers: item.pointers })
        return {
          kind: item.kind,
          status: item.status,
          reason: item.reason ?? null,
          summary: { total: summaryTotal },
          pointers: {
            artifacts: scope.artifacts,
            topK: scope.topK,
            counts: scope.counts,
          },
          pointerOk: scope.ok,
        }
      })

      const toolHash = sha256Text(stableJson({ specVersion: "eval-tool-broker/1.0", results: brokerResults }))
      const toolEntry = await writer.artifact({
        kind: "eval-tool-broker",
        path: "eval/tool.broker.json",
        data: stableJson({
          specVersion: "eval-tool-broker/1.0",
          hash: toolHash,
          expected: baseline.toolBrokerContractHash,
          results: brokerResults,
        }),
      })

      const rejected = broker.results.find((item) => item.kind === "verification")
      const rejectedScope = pointerScope({ sessionId, pointers: rejected?.pointers })
      const rejectedOk =
        rejected?.status === "rejected" &&
        rejected.reason === "unsupported_kind_v0" &&
        rejectedScope.ok &&
        rejectedScope.counts.toolBroker >= 1 &&
        rejectedScope.counts.retrieval === 0
      const retrieval = broker.results.find((item) => item.kind === "retrieval")
      const retrievalScope = pointerScope({ sessionId, pointers: retrieval?.pointers })
      const brokerSummaryOk = typeof retrieval?.summary?.total === "number"
      const brokerRetrievalOk =
        retrieval?.status === "ok" &&
        brokerSummaryOk &&
        retrievalScope.ok &&
        retrievalScope.counts.retrieval >= 1 &&
        retrievalScope.counts.toolBroker >= 1 &&
        Boolean(retrieval?.pointers)

      const toolSemanticOk = rejectedOk && brokerRetrievalOk
      const toolOk = toolSemanticOk && toolHash === baseline.toolBrokerContractHash
      await writer.check({
        id: "eval:tool-broker.contract",
        command: "runToolBroker (offline) -> canonicalized contract",
        status: check(toolOk).status,
        artifact: toolEntry.path,
      })

      const capsulePointers = [
        { kind: "artifact", ref: routingEntry.path, label: "routing contract" },
        { kind: "artifact", ref: retrievalEntry.path, label: "retrieval determinism" },
        { kind: "artifact", ref: planEntry.path, label: "orchestrator plan determinism" },
        { kind: "artifact", ref: toolEntry.path, label: "tool broker contract" },
      ]

      writer.capsule({ pointers: capsulePointers, openQuestions: [] })

      const manifest = await writer.manifest()
      const entrySet = new Set(manifest.entries.map((e) => e.path.replace(/\\/g, "/")))
      const pointerPaths = capsulePointers.map((p) => pointerPath(p)).filter((p) => p)
      const missingPointers = pointerPaths.filter((p) => !entrySet.has(p)).toSorted()
      const compactionOk = missingPointers.length === 0

      const compactionEntry = await writer.artifact({
        kind: "eval-compaction-pointers",
        path: "eval/compaction.pointers.json",
        data: stableJson({
          specVersion: "eval-compaction-pointers/1.0",
          rule: "pointers-not-paste",
          pointers: capsulePointers,
          missing: missingPointers,
        }),
      })

      await writer.check({
        id: "eval:compaction.pointers",
        command: "capsule pointers must reference manifest entry paths",
        status: check(compactionOk).status,
        artifact: compactionEntry.path,
      })

      const required = pointerPaths.map((p) => ({ path: p, kind: "capsule-pointer" }))
      const existing = (
        await Promise.all(
          pointerPaths.map(async (p) => {
            const abs = path.join(baseDir(), p)
            const ok = await Bun.file(abs).exists()
            if (!ok) return ""
            return p
          }),
        )
      ).filter((p) => p)

      const chain = verifyEvidenceChain({ entries: required, existing })
      const chainEntry = await writer.artifact({
        kind: "eval-evidence-chain",
        path: "eval/evidence.chain.json",
        data: stableJson({ specVersion: "eval-evidence-chain/1.0", ...chain }),
      })

      await writer.check({
        id: "eval:evidence.chain",
        command: "missing artifact must fail with Chinese reason",
        status: check(chain.ok).status,
        artifact: chainEntry.path,
      })

      await writer.pack({ handoff: "EVAL: offline" })

      await exportEvidence({ sessionId, outDir: exportDir })

      const exportChain = await verifyOfflineExportEvidenceChain({ exportDir, sessionId })
      const exportChainEntry = await writer.artifact({
        kind: "eval-export-evidence-chain",
        path: "eval/evidence.export.chain.json",
        data: stableJson({ specVersion: "eval-evidence-export-chain/1.0", ...exportChain }),
      })

      await writer.check({
        id: "eval:evidence.chain.export",
        command: "export dir must include referenced capsule/handoff artifacts",
        status: check(exportChain.ok).status,
        artifact: exportChainEntry.path,
      })

      const copyTree = async (src: string, dst: string) => {
        await fs.mkdir(path.dirname(dst), { recursive: true })
        await fs.cp(src, dst, { recursive: true })
      }

      await Promise.all([
        copyTree(
          path.join(fixtureDir, ".opencode", "evidence", sessionId),
          path.join(exportDir, ".opencode", "evidence", sessionId),
        ),
        copyTree(
          path.join(fixtureDir, ".opencode", "artifacts", sessionId),
          path.join(exportDir, ".opencode", "artifacts", sessionId),
        ),
      ])

      await writer.event({
        specVersion: "event/1.0",
        ts: new Date().toISOString(),
        sessionId,
        severity: "info",
        actor: "eval:offline",
        type: "eval.completed",
        summary: "offline eval completed",
        data: {
          suite: "offline",
          exportDir,
          checks: {
            routingContract: routingOk,
            retrievalDeterminism: retrievalOk,
            orchestratorPlanDeterminism: planOk,
            toolBrokerNonInteractive: toolOk,
            compactionPointers: compactionOk,
            evidenceChain: chain.ok,
            exportEvidenceChain: exportChain.ok,
          },
        },
        redaction: { applied: true, policyVersion: "v1" },
      })

      const evidenceDir = path.join(baseDir(), ".opencode", "evidence", sessionId)
      return {
        kind: "eval",
        suite: "offline",
        sessionId,
        fixtureDir,
        exportDir,
        evidenceDir,
        checks: {
          routingContract: {
            ...check(routingOk),
            artifact: routingEntry.path,
            detail: { hash: routingHash, canonical },
          },
          retrievalDeterminism: {
            ...check(retrievalOk),
            artifact: retrievalEntry.path,
            detail: { hash: fpA.hash, again: fpB.hash },
          },
          orchestratorPlanDeterminism: {
            ...check(planOk),
            artifact: planEntry.path,
            detail: { cases: planResults.map((item) => ({ name: item.name, hash: item.hash, expected: item.expected })) },
          },
          toolBrokerNonInteractive: {
            ...check(toolOk),
            artifact: toolEntry.path,
            detail: {
              hash: toolHash,
              expected: baseline.toolBrokerContractHash,
              semanticOk: toolSemanticOk,
              rejectedOk,
              brokerRetrievalOk,
            },
          },
          compactionPointers: {
            ...check(compactionOk),
            artifact: compactionEntry.path,
            detail: { missing: missingPointers, pointers: capsulePointers },
            ...(missingPointers.length > 0 ? { errorZh: `指针未指向 manifest 条目：${missingPointers.join("；")}` } : {}),
          },
          evidenceChain: {
            ...check(chain.ok),
            artifact: chainEntry.path,
            detail: { missing: chain.ok ? [] : chain.missing },
            ...(!chain.ok ? { errorZh: chain.errorZh } : {}),
          },
          exportEvidenceChain: {
            ...check(exportChain.ok),
            artifact: exportChainEntry.path,
            detail: { missing: exportChain.ok ? [] : exportChain.missing },
            ...(!exportChain.ok ? { errorZh: exportChain.errorZh } : {}),
          },
        },
      } satisfies OfflineEvalResult
    },
  })
}

const OfflineEvalTotals = z
  .object({
    claims: z.number().int().nonnegative(),
    unsupportedClaims: z.number().int().nonnegative(),
    unknownPredictions: z.number().int().nonnegative(),
    correctUnknownPredictions: z.number().int().nonnegative(),
    citationChecks: z.number().int().nonnegative(),
    validCitations: z.number().int().nonnegative(),
    tasks: z.number().int().nonnegative(),
    completedTasks: z.number().int().nonnegative(),
  })
  .superRefine((value, ctx) => {
    if (value.unsupportedClaims > value.claims) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "unsupportedClaims cannot exceed claims",
        path: ["unsupportedClaims"],
      })
    }
    if (value.correctUnknownPredictions > value.unknownPredictions) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "correctUnknownPredictions cannot exceed unknownPredictions",
        path: ["correctUnknownPredictions"],
      })
    }
    if (value.validCitations > value.citationChecks) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "validCitations cannot exceed citationChecks",
        path: ["validCitations"],
      })
    }
    if (value.completedTasks > value.tasks) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "completedTasks cannot exceed tasks",
        path: ["completedTasks"],
      })
    }
  })

export const OfflineEvalSuiteSchema = z.object({
  specVersion: z.literal(OFFLINE_EVAL_SPEC),
  id: z.string().min(1),
  baselineTaskCompletion: z.number().min(0).max(1),
  totals: OfflineEvalTotals,
})

export type OfflineEvalSuite = z.infer<typeof OfflineEvalSuiteSchema>

export type OfflineEvalMetrics = {
  unsupportedClaimRate: number
  unknownPrecision: number
  citationIntegrity: number
  taskCompletion: number
}

export type OfflineEvalSuiteResult = {
  id: string
  baselineTaskCompletion: number
  totals: OfflineEvalSuite["totals"]
  metrics: OfflineEvalMetrics
  gate: OfflineGateResult
}

export type OfflineEvalReport = {
  specVersion: typeof OFFLINE_EVAL_SPEC
  generatedAt: string
  suiteDir: string
  suites: OfflineEvalSuiteResult[]
  aggregate: {
    baselineTaskCompletion: number
    totals: OfflineEvalSuite["totals"]
    metrics: OfflineEvalMetrics
  }
  gate: OfflineGateResult
  passed: boolean
}

const ratio = (numerator: number, denominator: number, fallback: number) =>
  denominator === 0 ? fallback : Math.round((numerator / denominator) * 1_000_000) / 1_000_000

const calcMetrics = (totals: OfflineEvalSuite["totals"]): OfflineEvalMetrics => ({
  unsupportedClaimRate: ratio(totals.unsupportedClaims, totals.claims, 0),
  unknownPrecision: ratio(totals.correctUnknownPredictions, totals.unknownPredictions, 1),
  citationIntegrity: ratio(totals.validCitations, totals.citationChecks, 1),
  taskCompletion: ratio(totals.completedTasks, totals.tasks, 0),
})

const reduceTotals = (items: OfflineEvalSuite[]): OfflineEvalSuite["totals"] =>
  items.reduce(
    (sum, item) => ({
      claims: sum.claims + item.totals.claims,
      unsupportedClaims: sum.unsupportedClaims + item.totals.unsupportedClaims,
      unknownPredictions: sum.unknownPredictions + item.totals.unknownPredictions,
      correctUnknownPredictions: sum.correctUnknownPredictions + item.totals.correctUnknownPredictions,
      citationChecks: sum.citationChecks + item.totals.citationChecks,
      validCitations: sum.validCitations + item.totals.validCitations,
      tasks: sum.tasks + item.totals.tasks,
      completedTasks: sum.completedTasks + item.totals.completedTasks,
    }),
    {
      claims: 0,
      unsupportedClaims: 0,
      unknownPredictions: 0,
      correctUnknownPredictions: 0,
      citationChecks: 0,
      validCitations: 0,
      tasks: 0,
      completedTasks: 0,
    },
  )

const weightedBaseline = (items: OfflineEvalSuite[]) => {
  const taskCount = items.reduce((sum, item) => sum + item.totals.tasks, 0)
  if (taskCount > 0) {
    const weighted = items.reduce((sum, item) => sum + item.baselineTaskCompletion * item.totals.tasks, 0)
    return ratio(weighted, taskCount, 0)
  }
  const count = items.length
  if (count === 0) return 0
  const average = items.reduce((sum, item) => sum + item.baselineTaskCompletion, 0)
  return ratio(average, count, 0)
}

export const loadOfflineEvalSuites = async (input: { suiteDir: string }) => {
  const suiteDir = path.resolve(input.suiteDir)
  const names = (await fs.readdir(suiteDir)).filter((name) => name.endsWith(".json")).toSorted()
  if (names.length === 0) {
    throw new Error(`offline eval suites not found: ${suiteDir}`)
  }
  return Promise.all(
    names.map(async (name) => {
      const abs = path.join(suiteDir, name)
      const json = (await Bun.file(abs).json()) as unknown
      const suite = OfflineEvalSuiteSchema.parse(json)
      return suite
    }),
  )
}

const fmt = (value: number) => value.toFixed(4)

const checkRow = (input: {
  metric: string
  check: {
    cmp: "<=" | ">="
    actual: number
    threshold: number
    ok: boolean
  }
}) => {
  const mark = input.check.ok ? "pass" : "fail"
  return `| ${input.metric} | ${fmt(input.check.actual)} | ${input.check.cmp} ${fmt(input.check.threshold)} | ${mark} |`
}

export const renderOfflineEvalSummary = (report: OfflineEvalReport) => {
  const lines = [
    "# Offline Eval Summary",
    "",
    `- specVersion: ${report.specVersion}`,
    `- generatedAt: ${report.generatedAt}`,
    `- suiteDir: ${report.suiteDir}`,
    `- suites: ${report.suites.length}`,
    `- gate: ${report.gate.passed ? "pass" : "fail"}`,
    "",
    "## Aggregate Metrics",
    "",
    `- unsupportedClaimRate: ${fmt(report.aggregate.metrics.unsupportedClaimRate)}`,
    `- unknownPrecision: ${fmt(report.aggregate.metrics.unknownPrecision)}`,
    `- citationIntegrity: ${fmt(report.aggregate.metrics.citationIntegrity)}`,
    `- taskCompletion: ${fmt(report.aggregate.metrics.taskCompletion)} (baseline ${fmt(report.aggregate.baselineTaskCompletion)})`,
    "",
    "## Gate Checks",
    "",
    "| metric | actual | threshold | status |",
    "| --- | ---: | ---: | --- |",
    checkRow({ metric: "unsupportedClaimRate", check: report.gate.checks.unsupportedClaimRate }),
    checkRow({ metric: "unknownPrecision", check: report.gate.checks.unknownPrecision }),
    checkRow({ metric: "citationIntegrity", check: report.gate.checks.citationIntegrity }),
    checkRow({ metric: "taskCompletion", check: report.gate.checks.taskCompletion }),
  ]
  return `${lines.join("\n")}\n`
}

export const runOfflineGateEval = async (input: {
  suiteDir: string
  reportPath: string
  summaryPath: string
}) => {
  const suites = await loadOfflineEvalSuites({ suiteDir: input.suiteDir })
  const suiteResults = suites.map((suite) => {
    const metrics = calcMetrics(suite.totals)
    const gate = evaluateOfflineGate({
      unsupportedClaimRate: metrics.unsupportedClaimRate,
      unknownPrecision: metrics.unknownPrecision,
      citationIntegrity: metrics.citationIntegrity,
      taskCompletion: metrics.taskCompletion,
      baselineTaskCompletion: suite.baselineTaskCompletion,
    })
    return {
      id: suite.id,
      baselineTaskCompletion: suite.baselineTaskCompletion,
      totals: suite.totals,
      metrics,
      gate,
    } satisfies OfflineEvalSuiteResult
  })

  const totals = reduceTotals(suites)
  const baselineTaskCompletion = weightedBaseline(suites)
  const aggregateMetrics = calcMetrics(totals)
  const gate = evaluateOfflineGate({
    unsupportedClaimRate: aggregateMetrics.unsupportedClaimRate,
    unknownPrecision: aggregateMetrics.unknownPrecision,
    citationIntegrity: aggregateMetrics.citationIntegrity,
    taskCompletion: aggregateMetrics.taskCompletion,
    baselineTaskCompletion,
  })

  const report = {
    specVersion: OFFLINE_EVAL_SPEC,
    generatedAt: new Date().toISOString(),
    suiteDir: path.resolve(input.suiteDir),
    suites: suiteResults,
    aggregate: {
      baselineTaskCompletion,
      totals,
      metrics: aggregateMetrics,
    },
    gate,
    passed: gate.passed,
  } satisfies OfflineEvalReport

  await fs.mkdir(path.dirname(input.reportPath), { recursive: true })
  await fs.mkdir(path.dirname(input.summaryPath), { recursive: true })
  await Bun.write(input.reportPath, stableJson(report))
  await Bun.write(input.summaryPath, renderOfflineEvalSummary(report))
  return report
}
