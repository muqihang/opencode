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
    compactionPointers: Check
    evidenceChain: Check
  }
}

const baseDir = () => (Instance.worktree === "/" ? Instance.directory : Instance.worktree)

const baseline = {
  routingContractHash: "e7c7e8214a952671261330a04c5965aec5f4beb43aff9ced0a4ea2762b7b2638",
  retrievalDeterminismHash: "0adc7f7de965d2bb52ff5264e82ae0aca97d0f24b2e91f1ad7ece13cfcbc492c",
} as const

const asPath = (value: unknown) => (typeof value === "string" ? value : "")

const pointerPath = (value: unknown) => {
  if (typeof value === "string") return value
  if (!value || typeof value !== "object") return ""
  const ref = (value as { ref?: unknown }).ref
  return asPath(ref)
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

      const capsulePointers = [
        { kind: "artifact", ref: routingEntry.path, label: "routing contract" },
        { kind: "artifact", ref: retrievalEntry.path, label: "retrieval determinism" },
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
            compactionPointers: compactionOk,
            evidenceChain: chain.ok,
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
        },
      } satisfies OfflineEvalResult
    },
  })
}
