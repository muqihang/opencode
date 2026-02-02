import path from "path"
import fs from "fs/promises"
import { ulid } from "ulid"
import { stableJson } from "@/util/stable-json"
import { EvidenceWriter } from "@/evidence/writer"
import { Instance } from "@/project/instance"
import { defer } from "@/util/defer"
import { runCodeRetrieval } from "./code"
import { runWorkbenchRetrieval } from "./workbench"
import { resolveWorkspaceFingerprint } from "./workspace"
import { retrievalCacheKey } from "./cache"
import type { RetrievalPlanForKey } from "./spec"

type ArtifactPointer = {
  path: string
  sha256: string
  kind: string
}

type EvidencePointers = {
  retrievalId: string
  retrievalCacheKey: string
  summary: { total: number; code: number; workbench: number }
  artifacts: ArtifactPointer[]
  topK: Array<{ path: string; sha256: string; anchor?: Record<string, number> }>
}

type RetrievalArtifacts = {
  spec: string
  hits: string
  dedupe: string
  errors?: string
}

type RetrievalRun = {
  retrievalId: string
  retrievalCacheKey: string
  artifacts: RetrievalArtifacts
  evidencePointers: EvidencePointers
}

type Inflight = {
  abort: AbortController
  reason: "" | "superseded" | "user_abort"
}

const inflight = new Map<string, Map<string, Inflight>>()

const inflightMap = (sessionId: string) => {
  const current = inflight.get(sessionId)
  if (current) return current
  const created = new Map<string, Inflight>()
  inflight.set(sessionId, created)
  return created
}

const removeInflight = (sessionId: string, retrievalId: string) => {
  const current = inflight.get(sessionId)
  if (!current) return
  current.delete(retrievalId)
  if (current.size === 0) inflight.delete(sessionId)
}

const normalizeIntent = (text: string) => text.trim().replace(/\s+/g, " ")

const baseDir = () => (Instance.worktree === "/" ? Instance.directory : Instance.worktree)

const cacheDir = () => path.join(baseDir(), ".opencode", "cache", "retrieval")

const cachePath = (key: string) => path.join(cacheDir(), `${key}.json`)

const errorText = (error: unknown) => {
  if (error instanceof Error) return error.message
  return String(error)
}

const readCache = async (key: string) => {
  const file = Bun.file(cachePath(key))
  const exists = await file.exists()
  if (!exists) return
  const data = await file.json().catch(() => undefined)
  if (!data || typeof data !== "object") return
  const view = data as Record<string, unknown>
  const hits = Array.isArray(view.hits) ? view.hits : []
  const dedupe = view.dedupe
  return { hits, dedupe }
}

const writeCache = async (key: string, data: unknown) => {
  await fs.mkdir(cacheDir(), { recursive: true })
  await Bun.write(cachePath(key), stableJson(data))
}

const pointerFromHit = (value: unknown) => {
  if (!value || typeof value !== "object") return
  const hit = value as Record<string, unknown>
  const pointer = hit.pointer
  if (!pointer || typeof pointer !== "object") return
  const ref = pointer as Record<string, unknown>
  const path = ref.path
  const sha256 = ref.sha256
  if (typeof path !== "string" || typeof sha256 !== "string") return
  const anchor = ref.anchor
  if (!anchor || typeof anchor !== "object") return { path, sha256 }
  const anchorView = anchor as Record<string, unknown>
  const pairs = Object.entries(anchorView).filter(([, value]) => typeof value === "number")
  const mapped = Object.fromEntries(pairs) as Record<string, number>
  return { path, sha256, anchor: mapped }
}

const retrievalBudget = () => ({
  maxHits: 40,
  topK: 20,
  maxWallClockMs: 8000,
})

const buildPlan = (intentText: string): RetrievalPlanForKey => {
  const normalized = normalizeIntent(intentText)
  const budget = retrievalBudget()
  return {
    specVersion: "retrieval-plan/1.0",
    intent: { normalized },
    queries: [
      { role: "precision", q: normalized, lang: "auto", kind: "code" },
      { role: "recall", q: normalized, lang: "auto", kind: "code" },
    ],
    filters: { paths: [], symbols: [], kinds: [] },
    budget: { maxHits: budget.maxHits, topK: budget.topK, maxWallClockMs: budget.maxWallClockMs },
    sources: ["code", "workbench"],
    versions: { rules: "v1", stableJson: "v1" },
  }
}

const writeErrorArtifact = async (writer: Awaited<ReturnType<typeof EvidenceWriter.open>>, input: { retrievalId: string; errors: Array<{ stage: string; error: string }> }) => {
  if (input.errors.length === 0) return
  const nextStepZh = "请检查工作区与派生索引是否存在，必要时重试检索。"
  return writer.artifact({
    kind: "retrieval-error",
    path: `retrieval/${input.retrievalId}/errors.json`,
    data: stableJson({
      specVersion: "retrieval-errors/1.0",
      errors: input.errors,
      nextStepZh,
    }),
  })
}

export const RetrievalRunner = {
  async cancel(input: { sessionId: string }) {
    const current = inflight.get(input.sessionId)
    if (!current) return
    const entries = Array.from(current.entries())
    current.clear()
    inflight.delete(input.sessionId)
    for (const [, item] of entries) {
      item.reason = "user_abort"
      item.abort.abort()
    }
    const writer = await EvidenceWriter.open({ sessionId: input.sessionId })
    await Promise.all(
      entries.map(([retrievalId]) =>
        writer.event({
          specVersion: "event/1.0",
          ts: new Date().toISOString(),
          sessionId: input.sessionId,
          severity: "info",
          actor: "retrieval:runner",
          type: "retrieval.cancelled",
          summary: "retrieval cancelled",
          data: { retrievalId, reason: "user_abort" },
          redaction: { applied: true, policyVersion: "v1" },
        }),
      ),
    )
  },
  async run(input: { sessionId: string; messageId: string; intentText: string; abort: AbortSignal }): Promise<RetrievalRun> {
    const retrievalId = ulid()
    const state: Inflight = { abort: new AbortController(), reason: "" }
    const current = inflightMap(input.sessionId)
    const previousEntry = current.size > 0 ? (current.entries().next().value as [string, Inflight] | undefined) : undefined
    const superseded = previousEntry
      ? (() => {
          const [previousId, previous] = previousEntry
          previous.reason = "superseded"
          previous.abort.abort()
          current.delete(previousId)
          return previousId
        })()
      : ""
    current.set(retrievalId, state)
    using _ = defer(() => removeInflight(input.sessionId, retrievalId))

    const budget = retrievalBudget()
    const budgetAbort = new AbortController()
    const budgetState = { timedOut: false }
    const timer = setTimeout(() => {
      budgetState.timedOut = true
      budgetAbort.abort()
    }, budget.maxWallClockMs)
    using __ = defer(() => clearTimeout(timer))

    const signal = AbortSignal.any([state.abort.signal, input.abort, budgetAbort.signal])
    const workspace = await resolveWorkspaceFingerprint({ root: baseDir() })
    const plan = buildPlan(input.intentText)
    const cacheKey = retrievalCacheKey({ plan, workspace })

    const writer = await EvidenceWriter.open({ sessionId: input.sessionId })

    if (superseded) {
      await writer.event({
        specVersion: "event/1.0",
        ts: new Date().toISOString(),
        sessionId: input.sessionId,
        severity: "info",
        actor: "retrieval:runner",
        type: "retrieval.cancelled",
        summary: "retrieval superseded",
        data: { retrievalId: superseded, newRetrievalId: retrievalId, reason: "superseded" },
        redaction: { applied: true, policyVersion: "v1" },
      })
    }

    await writer.event({
      specVersion: "event/1.0",
      ts: new Date().toISOString(),
      sessionId: input.sessionId,
      severity: "info",
      actor: "retrieval:runner",
      type: "retrieval.started",
      summary: "retrieval started",
      data: {
        retrievalId,
        retrievalCacheKey: cacheKey,
        messageId: input.messageId,
      },
      redaction: { applied: true, policyVersion: "v1" },
    })

    const specEntry = await writer.artifact({
      kind: "retrieval-spec",
      path: `retrieval/${retrievalId}/retrieval.spec.json`,
      data: stableJson({
        specVersion: "retrieval-spec/1.0",
        retrievalId,
        retrievalCacheKey: cacheKey,
        sessionId: input.sessionId,
        messageId: input.messageId,
        intent: { raw: input.intentText, normalized: plan.intent.normalized },
        plan,
        workspace,
        createdAtUtc: new Date().toISOString(),
      }),
    })

    const cached = await readCache(cacheKey)
    const errors: Array<{ stage: string; error: string }> = []
    const attempts = await (async () => {
      if (cached) return { hits: cached.hits, dedupe: cached.dedupe, cacheHit: true, code: [], workbench: [] }
      if (signal.aborted) return { hits: [], dedupe: undefined, cacheHit: false, code: [], workbench: [] }

      const code = await runCodeRetrieval({
        sessionId: input.sessionId,
        retrievalId,
        root: baseDir(),
        queries: plan.queries,
        budget,
        abort: signal,
      })
        .then((value) => ({ ok: true as const, value }))
        .catch((error) => ({ ok: false as const, error: errorText(error) }))
      if (!code.ok) errors.push({ stage: "code", error: code.error })

      const derivedBase = path.join(baseDir(), ".opencode", "artifacts", input.sessionId, "derived")
      const entries = await fs
        .readdir(derivedBase, { withFileTypes: true })
        .catch(() => [])
      const roots = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => ({ id: entry.name, root: path.join(derivedBase, entry.name) }))

      const workbenchResults = await Promise.all(
        roots.map((item) =>
          runWorkbenchRetrieval({
            sessionId: input.sessionId,
            inputId: item.id,
            derivedRoot: item.root,
            retrievalId,
          })
            .then((value) => ({ ok: true as const, value }))
            .catch((error) => ({ ok: false as const, error: errorText(error) })),
        ),
      )

      const workbenchHits = workbenchResults.flatMap((item) => {
        if (!item.ok) {
          errors.push({ stage: "workbench", error: item.error })
          return [] as typeof item.value
        }
        return item.value
      })

      const codeHits = code.ok ? code.value.hits : []
      const hits = [...codeHits, ...workbenchHits]
      return { hits, dedupe: undefined, cacheHit: false, code: codeHits, workbench: workbenchHits }
    })()

    const hits = Array.isArray(attempts.hits) ? attempts.hits : []
    const summary = {
      total: hits.length,
      code: Array.isArray(attempts.code) ? attempts.code.length : 0,
      workbench: Array.isArray(attempts.workbench) ? attempts.workbench.length : 0,
    }
    const dedupe = attempts.dedupe ?? {
      specVersion: "retrieval-dedupe/1.0",
      total: summary.total,
      unique: summary.total,
      rules: {
        contentHash: "sha256(normalized snippet text)",
        overlap: "line-range",
      },
    }

    if (!attempts.cacheHit) {
      await writeCache(cacheKey, { specVersion: "retrieval-cache/1.0", hits, dedupe })
    }

    const hitsEntry = await writer.artifact({
      kind: "retrieval-hits",
      path: `retrieval/${retrievalId}/hits.json`,
      data: stableJson(hits),
    })
    const dedupeEntry = await writer.artifact({
      kind: "retrieval-dedupe",
      path: `retrieval/${retrievalId}/dedupe.report.json`,
      data: stableJson(dedupe),
    })
    const errorEntry = await writeErrorArtifact(writer, { retrievalId, errors })

    const topK = hits
      .slice(0, 5)
      .map((item) => pointerFromHit(item))
      .filter((item): item is { path: string; sha256: string; anchor?: Record<string, number> } => Boolean(item))

    const artifacts: ArtifactPointer[] = [
      { path: specEntry.path, sha256: specEntry.sha256, kind: specEntry.kind },
      { path: hitsEntry.path, sha256: hitsEntry.sha256, kind: hitsEntry.kind },
      { path: dedupeEntry.path, sha256: dedupeEntry.sha256, kind: dedupeEntry.kind },
    ]
    if (errorEntry) artifacts.push({ path: errorEntry.path, sha256: errorEntry.sha256, kind: errorEntry.kind })

    const evidencePointers: EvidencePointers = {
      retrievalId,
      retrievalCacheKey: cacheKey,
      summary,
      artifacts,
      topK,
    }

    const status = (() => {
      if (budgetState.timedOut) return "retrieval.timeout"
      if (state.reason === "superseded" || input.abort.aborted) return "retrieval.cancelled"
      if (errors.length > 0) return "retrieval.degraded"
      if (attempts.cacheHit) return "retrieval.cache_hit"
      return "retrieval.completed"
    })()

    await writer.event({
      specVersion: "event/1.0",
      ts: new Date().toISOString(),
      sessionId: input.sessionId,
      severity: "info",
      actor: "retrieval:runner",
      type: status,
      summary: status.replace("retrieval.", "retrieval "),
      data: {
        retrievalId,
        retrievalCacheKey: cacheKey,
        summary,
        artifacts: {
          spec: specEntry.path,
          hits: hitsEntry.path,
          dedupe: dedupeEntry.path,
          errors: errorEntry?.path,
        },
        reason: state.reason || (input.abort.aborted ? "user_abort" : budgetState.timedOut ? "timeout" : ""),
      },
      redaction: { applied: true, policyVersion: "v1" },
    })

    return {
      retrievalId,
      retrievalCacheKey: cacheKey,
      artifacts: {
        spec: specEntry.path,
        hits: hitsEntry.path,
        dedupe: dedupeEntry.path,
        errors: errorEntry?.path,
      },
      evidencePointers,
    }
  },
}

export const runRetrieval = RetrievalRunner.run
