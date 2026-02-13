import path from "path"
import fs from "fs/promises"
import { ulid } from "ulid"
import { stableJson } from "@/util/stable-json"
import { EvidenceWriter } from "@/evidence/writer"
import { Instance } from "@/project/instance"
import { defer } from "@/util/defer"
import { CacheStore } from "@/cache/store"
import { CachePolicy } from "@/cache/policy"
import { sha256Text } from "@/routing/cache"
import { verifyEvidenceChain } from "@/evidence/chain"
import { artifactCandidates, resolveTenantScope } from "@/util/tenant-context"
import { runCodeRetrieval } from "./code"
import { runWorkbenchRetrieval } from "./workbench"
import { resolveWorkspaceFingerprint } from "./workspace"
import { retrievalCacheKey } from "./cache"
import type { RetrievalPlanForKey } from "./spec"
import {
  EvidenceBundleCompatV2,
  EvidenceBundleV2,
  type EvidenceBundleCompatV2 as EvidenceBundleCompat,
  type EvidenceBundleRerankV2,
  type EvidenceBundleV2 as EvidenceBundle,
} from "@/protocol/evidence-bundle"

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
  bundle: EvidenceBundle
  compat: EvidenceBundleCompat
  rerank: EvidenceBundleRerankV2
}

type RetrievalArtifacts = {
  spec: string
  hits: string
  dedupe: string
  bundle: string
  probe: string
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

const normalizePath = (value: string) => value.replace(/\\/g, "/")

const stripArtifactRoot = (input: { artifactRoot: string; pointerPath: string }) => {
  const root = normalizePath(input.artifactRoot).replace(/\/+$/, "")
  const pointer = normalizePath(input.pointerPath)
  const prefix = root ? `${root}/` : ""
  if (prefix && pointer.startsWith(prefix)) return pointer.slice(prefix.length)
  return pointer
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object"

const normalizeHit = (hit: unknown, strip: (value: string) => string) => {
  if (!isRecord(hit)) return hit
  const pointer = hit.pointer
  if (!isRecord(pointer)) return hit
  const path = pointer.path
  if (typeof path !== "string") return hit
  const nextPointer = { ...pointer, path: strip(path) }
  return { ...hit, pointer: nextPointer }
}

const rehydrateHit = async (input: {
  hit: unknown
  writer: Awaited<ReturnType<typeof EvidenceWriter.open>>
  artifactRoot: string
  retrievalId: string
  strip: (value: string) => string
}) => {
  if (!isRecord(input.hit)) return input.hit
  const pointer = input.hit.pointer
  if (!isRecord(pointer)) return input.hit
  const pathValue = pointer.path
  if (typeof pathValue !== "string") return input.hit
  const parts = normalizePath(pathValue).split("/")
  if (parts.length < 4) return input.hit
  if (parts[0] !== "retrieval") return input.hit
  if (parts[2] !== "snippets") return input.hit
  const tail = parts.slice(2).join("/")
  const source = path.join(baseDir(), input.artifactRoot, ...parts)
  const text = await Bun.file(source)
    .text()
    .catch(() => "")
  if (!text) return input.hit
  const entry = await input.writer.artifact({
    kind: "retrieval-snippet",
    path: `retrieval/${input.retrievalId}/${tail}`,
    data: text,
  })
  const nextPointer = { ...pointer, path: input.strip(entry.path), sha256: entry.sha256 }
  return { ...input.hit, pointer: nextPointer }
}

const rehydrateHits = async (input: {
  hits: unknown[]
  writer: Awaited<ReturnType<typeof EvidenceWriter.open>>
  artifactRoot: string
  retrievalId: string
  strip: (value: string) => string
}) => {
  return Promise.all(
    input.hits.map((hit) =>
      rehydrateHit({
        hit,
        writer: input.writer,
        artifactRoot: input.artifactRoot,
        retrievalId: input.retrievalId,
        strip: input.strip,
      }),
    ),
  )
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

const storeScope = () => ({
  projectId: Instance.project.id,
  worktreeRoot: baseDir(),
})

const storeLimits = () => CachePolicy.limits()

const storeTtlMs = () => CachePolicy.ttlMs("retrieval")

const storeKey = (retrievalCacheKey: string) => {
  const scope = storeScope()
  return CacheStore.key({
    namespace: "retrieval",
    scope,
    input: {
      specVersion: "retrieval-code-cache-key/1.0",
      retrievalCacheKey,
      versions: { runner: "v2", stableJson: "v1" },
    },
  })
}

const storeArtifact = async (key: string) => {
  const rel = [".opencode", "cache", "store", "retrieval", "entries", `${key}.json`].join("/")
  const file = path.join(baseDir(), ...rel.split("/"))
  const text = await Bun.file(file).text().catch(() => "")
  if (!text) return
  return { path: rel, sha256: sha256Text(text), kind: "cache-entry" }
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

const numberValue = (value: unknown) => {
  if (typeof value !== "number" || Number.isNaN(value)) return
  if (!Number.isFinite(value)) return
  return value
}

const clamp = (value: number) => Math.max(0, Math.min(1, value))

const sourceValue = (value: unknown) => {
  if (value === "lsp") return value
  if (value === "rg") return value
  if (value === "workbench") return value
  if (value === "tree") return value
  return
}

const densityScore = (input: { hit: Record<string, unknown>; source?: "lsp" | "rg" | "workbench" | "tree" }) => {
  const explicit = numberValue(input.hit.densityScore)
  if (explicit !== undefined) return { value: clamp(explicit), fallback: false as const }
  if (input.source === "lsp") return { value: 0.95, fallback: false as const }
  if (input.source === "rg") return { value: 0.9, fallback: false as const }
  if (input.source === "workbench") return { value: 0.8, fallback: false as const }
  if (input.source === "tree") return { value: 0.25, fallback: false as const }
  return { value: 0, fallback: true as const }
}

const withDensity = (value: unknown) => {
  if (!isRecord(value)) return { hit: value, fallback: true as const }
  const source = sourceValue(value.source)
  const density = densityScore({ hit: value, source })
  return {
    hit: { ...value, densityScore: density.value },
    fallback: density.fallback,
  }
}

const textValue = (value: unknown) => {
  if (typeof value !== "string") return ""
  return value
}

const lineValue = (value: unknown) => {
  const parsed = numberValue(value)
  if (parsed === undefined) return
  const rounded = Math.round(parsed)
  if (rounded <= 0) return
  return rounded
}

const originFromHit = (value: Record<string, unknown>) => {
  const origin = value.origin
  if (!isRecord(origin)) return {}
  const sourcePath = textValue(origin.path)
  const inputId = textValue(origin.inputId)
  const kind = textValue(origin.kind)
  const lineStart = lineValue(origin.lineStart)
  const lineEnd = lineValue(origin.lineEnd)
  return {
    ...(sourcePath ? { path: sourcePath } : {}),
    ...(lineStart !== undefined ? { lineStart } : {}),
    ...(lineEnd !== undefined ? { lineEnd } : {}),
    ...(inputId ? { inputId } : {}),
    ...(kind ? { kind } : {}),
  }
}

const fallbackSnippet = (input: { hit: Record<string, unknown>; pointerPath: string }) => {
  const origin = input.hit.origin
  if (!isRecord(origin)) return input.pointerPath
  const sourcePath = textValue(origin.path)
  if (sourcePath) return sourcePath
  const inputId = textValue(origin.inputId)
  const kind = textValue(origin.kind)
  if (inputId && kind) return `${kind}:${inputId}`
  if (inputId) return inputId
  if (kind) return kind
  return input.pointerPath
}

const readSnippet = async (input: { sessionId: string; hit: Record<string, unknown>; pointerPath: string }) => {
  if (!input.pointerPath.includes("/snippets/")) return fallbackSnippet(input)
  const file = pointerFile({ cacheSessionId: input.sessionId, ref: input.pointerPath })
  const text = await Bun.file(file)
    .text()
    .catch(() => "")
  const trimmed = text.trim()
  if (trimmed.length > 0) return trimmed
  return fallbackSnippet(input)
}

const compareScore = (left: { score_bps: number; id: string }, right: { score_bps: number; id: string }) => {
  if (left.score_bps !== right.score_bps) return right.score_bps - left.score_bps
  return left.id.localeCompare(right.id)
}

const compareDensity = (
  left: { densityScore: number; score_bps: number; id: string },
  right: { densityScore: number; score_bps: number; id: string },
) => {
  if (left.densityScore !== right.densityScore) return right.densityScore - left.densityScore
  return compareScore(left, right)
}

const shaBytes = (bytes: Uint8Array) => {
  const hash = new Bun.CryptoHasher("sha256")
  hash.update(Buffer.from(bytes))
  return hash.digest("hex")
}

const pointerFile = (input: { cacheSessionId: string; ref: string }) => {
  const rel = normalizePath(input.ref).replace(/^\/+/, "")
  if (rel.startsWith(".opencode/")) return path.join(baseDir(), ...rel.split("/"))
  return path.join(baseDir(), ".opencode", "artifacts", input.cacheSessionId, ...rel.split("/"))
}

const cacheHitPointers = (hits: unknown[]) =>
  hits
    .map((item) => pointerFromHit(item))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .map((item) => ({ kind: "artifact", ref: item.path, sha256: item.sha256 }))

const verifyCacheIntegrity = async (input: { hits: unknown[]; cacheSessionId: string }) => {
  const pointers = cacheHitPointers(input.hits)
  const refs = [...new Set(pointers.map((item) => item.ref))]
  const observed = await Promise.all(
    refs.map(async (ref) => {
      const file = Bun.file(pointerFile({ cacheSessionId: input.cacheSessionId, ref }))
      const exists = await file.exists()
      if (!exists) return { ref, exists: false as const, sha256: "" }
      const bytes = await file.bytes().catch(() => new Uint8Array())
      return { ref, exists: true as const, sha256: shaBytes(bytes) }
    }),
  )
  const existing = observed.filter((item) => item.exists).map((item) => item.ref)
  const hashes = Object.fromEntries(
    observed
      .filter((item) => item.exists)
      .map((item) => [item.ref, item.sha256] as const),
  )
  return verifyEvidenceChain({
    entries: refs.map((ref) => ({ path: ref, sha256: hashes[ref] })),
    existing,
    pointers,
    hashes,
    headerZh: "缓存污染：retrieval pointer 校验失败",
  })
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

type ProbeJournal = {
  specVersion: "probe-journal/1.0"
  probeId: string
  retrievalId: string
  sessionId: string
  messageId: string
  dedupeKey: string
  why: string
  queries: RetrievalPlanForKey["queries"]
  expectedEvidence: {
    artifacts: string[]
    topK: number
  }
  dedupe: {
    by: "messageId+dedupeKey"
    duplicate: boolean
    seen: number
  }
  createdAtUtc: string
}

const probeRoots = (sessionId: string) => {
  const scope = resolveTenantScope()
  return artifactCandidates({
    base: baseDir(),
    sessionId,
    tenantId: scope.tenantId,
    orgId: scope.orgId,
  }).map((item) => path.join(item, "retrieval"))
}

const countProbeMatches = async (input: { sessionId: string; messageId: string; dedupeKey: string }) => {
  const roots = probeRoots(input.sessionId)
  const grouped = await Promise.all(
    roots.map(async (root) => {
      const dirs = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
      return dirs
        .filter((item) => item.isDirectory())
        .map((item) => path.join(root, item.name, "probe.journal.json"))
    }),
  )
  const files = [...new Set(grouped.flat())]
  const rows = await Promise.all(files.map((item) => Bun.file(item).json().catch(() => undefined)))
  return rows.filter((item) => isRecord(item) && item.messageId === input.messageId && item.dedupeKey === input.dedupeKey).length
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

    const seed = await EvidenceWriter.open({ sessionId: input.sessionId })
    const cfg = CachePolicy.effective()
    await seed.event({
      specVersion: "event/1.0",
      ts: new Date().toISOString(),
      sessionId: input.sessionId,
      severity: "info",
      actor: "cache:policy",
      type: "cache.config_effective",
      summary: "cache config effective",
      data: {
        storeEnabled: cfg.storeEnabled,
        forceContextPack: cfg.forceContextPack,
        strict: cfg.strict,
        sources: cfg.sources,
      },
      redaction: { applied: true, policyVersion: "v1" },
    })

    if (superseded) {
      await seed.event({
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

    await seed.event({
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

    const artifactRoot = `.opencode/artifacts/${input.sessionId}`
    const strip = (value: string) => stripArtifactRoot({ artifactRoot, pointerPath: value })

    const specEntry = await seed.artifact({
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

    const scope = storeScope()
    const key = storeKey(cacheKey)
    const store = CacheStore.open({
      namespace: "retrieval",
      scope,
      limits: storeLimits(),
    })
    const errors: Array<{ stage: string; error: string }> = []
    const policy = CachePolicy.policy("retrieval")
    const computeCode = async () => {
      if (signal.aborted) return { specVersion: "retrieval-code-cache/1.0", sessionId: input.sessionId, hits: [] }
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
      if (!code.ok) {
        errors.push({ stage: "code", error: code.error })
        return { specVersion: "retrieval-code-cache/1.0", sessionId: input.sessionId, hits: [] }
      }
      const normalized = code.value.hits.map((item) => normalizeHit(item, strip))
      return {
        specVersion: "retrieval-code-cache/1.0",
        sessionId: input.sessionId,
        hits: normalized,
      }
    }
    const cached = await store.getOrCompute({
      key,
      ttlMs: storeTtlMs(),
      policy: { enabled: policy.enabled, force: false },
      compute: computeCode,
    })

    // Re-open writer after code retrieval: runCodeRetrieval writes artifacts with its own EvidenceWriter.
    // Keeping a stale writer here risks overwriting manifest entries and losing those artifacts.
    const writer = await EvidenceWriter.open({ sessionId: input.sessionId })

    const artifact = await storeArtifact(key)
    await writer.event({
      specVersion: "event/1.0",
      ts: new Date().toISOString(),
      sessionId: input.sessionId,
      severity: "info",
      actor: "cache:store",
      type: "cache.read",
      summary: "cache read",
      data: {
        namespace: "retrieval",
        key,
        scope,
        sourceKey: cacheKey,
        decision: cached.status,
        tier: cached.tier,
        artifact,
      },
      redaction: { applied: true, policyVersion: "v1" },
    })

    const cacheView = cached.value as Record<string, unknown>
    const cachedHits = Array.isArray(cacheView.hits) ? cacheView.hits : []
    const cacheSessionId = typeof cacheView.sessionId === "string" ? cacheView.sessionId : input.sessionId
    const integrity =
      cached.status === "hit"
        ? await verifyCacheIntegrity({ hits: cachedHits, cacheSessionId })
        : { ok: true as const }
    const cold = cached.status === "hit" && !integrity.ok
    const recovered = cold
      ? await store.getOrCompute({
          key,
          ttlMs: storeTtlMs(),
          policy: { enabled: policy.enabled, force: true },
          compute: computeCode,
        })
      : cached

    if (cached.status === "hit" && !cold) {
      await writer.event({
        specVersion: "event/1.0",
        ts: new Date().toISOString(),
        sessionId: input.sessionId,
        severity: "info",
        actor: "cache:store",
        type: "cache.hit",
        summary: "cache hit",
        data: {
          namespace: "retrieval",
          key,
          scope,
          sourceKey: cacheKey,
          tier: cached.tier,
          artifact,
        },
        redaction: { applied: true, policyVersion: "v1" },
      })
    }

    if (cold) {
      const issue = integrity.ok
        ? await writer.artifact({
            kind: "cache-integrity",
            path: `retrieval/${retrievalId}/cache.integrity.json`,
            data: stableJson({ specVersion: "cache-integrity/1.0", ok: true }),
          })
        : await writer.artifact({
            kind: "cache-integrity",
            path: `retrieval/${retrievalId}/cache.integrity.json`,
            data: stableJson({ specVersion: "cache-integrity/1.0", ...integrity }),
          })
      await writer.event({
        specVersion: "event/1.0",
        ts: new Date().toISOString(),
        sessionId: input.sessionId,
        severity: "warn",
        actor: "cache:store",
        type: "cache.coldstart",
        summary: "cache coldstart",
        data: {
          namespace: "retrieval",
          key,
          scope,
          sourceKey: cacheKey,
          reason: "pointer_integrity_failed",
          integrity: integrity.ok
            ? { missing: [], contaminated: [], errorZh: "" }
            : {
                missing: integrity.missing,
                contaminated: integrity.contaminated,
                errorZh: integrity.errorZh,
              },
          artifact: issue,
        },
        redaction: { applied: true, policyVersion: "v1" },
      })
    }

    if (cached.status !== "hit" || cold) {
      await writer.event({
        specVersion: "event/1.0",
        ts: new Date().toISOString(),
        sessionId: input.sessionId,
        severity: "info",
        actor: "cache:store",
        type: "cache.miss",
        summary: "cache miss",
        data: {
          namespace: "retrieval",
          key,
          scope,
          sourceKey: cacheKey,
          decision: cold ? "forced_rebuild" : cached.status,
          tier: cached.tier,
          artifact,
        },
        redaction: { applied: true, policyVersion: "v1" },
      })
    }

    if (cached.status === "miss" || cached.status === "expired" || cold) {
      const stored = await storeArtifact(key)
      await writer.event({
        specVersion: "event/1.0",
        ts: new Date().toISOString(),
        sessionId: input.sessionId,
        severity: "info",
        actor: "cache:store",
        type: "cache.write",
        summary: "cache write",
        data: {
          namespace: "retrieval",
          key,
          scope,
          sourceKey: cacheKey,
          decision: cold ? "forced_rebuild" : cached.status,
          tier: "disk",
          artifact: stored,
        },
        redaction: { applied: true, policyVersion: "v1" },
      })
    }
    const attempts = await (async () => {
      if (signal.aborted) return { hits: [], dedupe: undefined, cacheHit: false, code: [], workbench: [] }

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
          return [] as Awaited<ReturnType<typeof runWorkbenchRetrieval>>
        }
        return item.value
      })

      const view = recovered.value as Record<string, unknown>
      const codeHits = Array.isArray(view.hits) ? view.hits : []
      const cacheSessionId = typeof view.sessionId === "string" ? view.sessionId : input.sessionId
      return {
        hits: [...codeHits, ...workbenchHits],
        dedupe: undefined,
        cacheHit: recovered.status === "hit" && !cold,
        cacheSessionId,
        code: codeHits,
        workbench: workbenchHits,
      }
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

    const normalizedHits = hits.map((item) => normalizeHit(item, strip))
    const finalizedHits = attempts.cacheHit
      ? await rehydrateHits({
          hits: normalizedHits,
          writer,
          artifactRoot: `.opencode/artifacts/${(attempts as { cacheSessionId?: string }).cacheSessionId ?? input.sessionId}`,
          retrievalId,
          strip,
        })
      : normalizedHits

    const scoredHits = finalizedHits.map((item) => withDensity(item))
    const enrichedHits = scoredHits.map((item) => item.hit)
    const bundleRows = await Promise.all(
      enrichedHits.map(async (item, index) => {
        if (!isRecord(item)) return
        const pointer = pointerFromHit(item)
        if (!pointer) return
        const source = sourceValue(item.source) ?? "tree"
        const density = densityScore({ hit: item, source })
        const score = numberValue(item.score_bps)
        return {
          id: `E${index + 1}`,
          pointer,
          origin: originFromHit(item),
          snippet: await readSnippet({ sessionId: input.sessionId, hit: item, pointerPath: pointer.path }),
          source,
          score_bps: score === undefined ? 0 : Math.max(0, Math.round(score)),
          densityScore: density.value,
        }
      }),
    )
    const bundleHits = bundleRows.filter((item): item is NonNullable<typeof item> => Boolean(item))
    const fallbackTriggered = scoredHits.some((item) => item.fallback) || bundleHits.length !== enrichedHits.length
    const rerank = {
      mode: fallbackTriggered ? "score_only" : "density_first",
      fallback: {
        condition: "density_missing_or_invalid",
        triggered: fallbackTriggered,
        reason: fallbackTriggered ? "at_least_one_hit_missing_density" : "density_available_for_all_hits",
      },
    } satisfies EvidenceBundleRerankV2
    const reranked = (rerank.mode === "density_first" ? bundleHits.toSorted(compareDensity) : bundleHits.toSorted(compareScore))
    const topEvidence = reranked.slice(0, 5).map((item) => item.id)
    const topK = reranked.slice(0, 5).map((item) => item.pointer)
    const densityThreshold = 0.8
    const densityPass = reranked.filter((item) => item.densityScore >= densityThreshold).length
    const densitySum = reranked.reduce((sum, item) => sum + item.densityScore, 0)
    const densityMean = reranked.length === 0 ? 0 : densitySum / reranked.length
    const bundle = EvidenceBundleV2.parse({
      specVersion: "evidence-bundle/2.0",
      retrievalId,
      summary,
      hits: reranked,
      topEvidence,
      dedupe: {
        method: "hash+overlap",
        report: `retrieval/${retrievalId}/dedupe.report.json`,
      },
      rerank,
    })
    const compat = EvidenceBundleCompatV2.parse({
      v1TopK: topK.length,
      v2TopEvidence: topEvidence.length,
      v1Total: summary.total,
      v2Total: bundle.summary.total,
      densityMean,
      densityPass,
      densityThreshold,
    })

    const hitsEntry = await writer.artifact({
      kind: "retrieval-hits",
      path: `retrieval/${retrievalId}/hits.json`,
      data: stableJson(enrichedHits),
    })
    const dedupeEntry = await writer.artifact({
      kind: "retrieval-dedupe",
      path: `retrieval/${retrievalId}/dedupe.report.json`,
      data: stableJson(dedupe),
    })
    const bundleEntry = await writer.artifact({
      kind: "retrieval-evidence-bundle-v2",
      path: `retrieval/${retrievalId}/evidence.bundle.v2.json`,
      data: stableJson(bundle),
    })
    const errorEntry = await writeErrorArtifact(writer, { retrievalId, errors })

    const expectedArtifacts = [strip(specEntry.path), strip(hitsEntry.path), strip(dedupeEntry.path), strip(bundleEntry.path)]
    if (errorEntry) expectedArtifacts.push(strip(errorEntry.path))

    const seen = (await countProbeMatches({
      sessionId: input.sessionId,
      messageId: input.messageId,
      dedupeKey: cacheKey,
    })) + 1

    const probe: ProbeJournal = {
      specVersion: "probe-journal/1.0",
      probeId: retrievalId,
      retrievalId,
      sessionId: input.sessionId,
      messageId: input.messageId,
      dedupeKey: cacheKey,
      why: "retrieval runner probe for evidence planning and message-level dedupe audit",
      queries: plan.queries,
      expectedEvidence: {
        artifacts: expectedArtifacts,
        topK: topEvidence.length,
      },
      dedupe: {
        by: "messageId+dedupeKey",
        duplicate: seen > 1,
        seen,
      },
      createdAtUtc: new Date().toISOString(),
    }

    const probeEntry = await writer.artifact({
      kind: "retrieval-probe-journal",
      path: `retrieval/${retrievalId}/probe.journal.json`,
      data: stableJson(probe),
    })

    const artifacts: ArtifactPointer[] = [
      { path: strip(specEntry.path), sha256: specEntry.sha256, kind: specEntry.kind },
      { path: strip(hitsEntry.path), sha256: hitsEntry.sha256, kind: hitsEntry.kind },
      { path: strip(dedupeEntry.path), sha256: dedupeEntry.sha256, kind: dedupeEntry.kind },
      { path: strip(bundleEntry.path), sha256: bundleEntry.sha256, kind: bundleEntry.kind },
      { path: strip(probeEntry.path), sha256: probeEntry.sha256, kind: probeEntry.kind },
    ]
    if (errorEntry) artifacts.push({ path: strip(errorEntry.path), sha256: errorEntry.sha256, kind: errorEntry.kind })

    const evidencePointers: EvidencePointers = {
      retrievalId,
      retrievalCacheKey: cacheKey,
      summary,
      artifacts,
      topK,
      bundle,
      compat,
      rerank,
    }

    const issue = errors[0]
    const reason =
      state.reason ||
      (input.abort.aborted ? "user_abort" : budgetState.timedOut ? "timeout" : issue ? `${issue.stage}_error` : "")
    const error = issue ? (issue.error.trim() ? issue.error : `${issue.stage}:unknown_error`) : ""

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
          spec: strip(specEntry.path),
          hits: strip(hitsEntry.path),
          dedupe: strip(dedupeEntry.path),
          bundle: strip(bundleEntry.path),
          probe: strip(probeEntry.path),
          errors: errorEntry ? strip(errorEntry.path) : undefined,
        },
        probe: {
          dedupeKey: probe.dedupeKey,
          duplicate: probe.dedupe.duplicate,
          seen: probe.dedupe.seen,
        },
        rerank: rerank,
        reason,
        error: error || undefined,
      },
      redaction: { applied: true, policyVersion: "v1" },
    })

    return {
      retrievalId,
      retrievalCacheKey: cacheKey,
      artifacts: {
        spec: strip(specEntry.path),
        hits: strip(hitsEntry.path),
        dedupe: strip(dedupeEntry.path),
        bundle: strip(bundleEntry.path),
        probe: strip(probeEntry.path),
        errors: errorEntry ? strip(errorEntry.path) : undefined,
      },
      evidencePointers,
    }
  },
}

export const runRetrieval = RetrievalRunner.run
