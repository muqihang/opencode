import { CacheStore } from "@/cache/store"
import { stableJson } from "@/util/stable-json"
import { sha256Text } from "@/routing/cache"

type Scope = {
  projectId: string
  worktreeRoot: string
}

type Clock = {
  nowMs: () => number
}

type Policy = {
  enabled: boolean
}

type ModelRef = {
  providerID: string
  id: string
  api: { npm: string; id: string }
}

type ProviderRef = {
  baseURL: string
  apiKey?: string
}

type Block = {
  id: string
  text: string
}

type Blocks = {
  blocks: Block[]
  blockFingerprints: Record<string, string>
  toolsetFingerprint: string
  cacheKey: string
}

type Decision = "created" | "reused" | "invalidated" | "degraded" | "disabled"

type Result = {
  cachedContentKey: string
  cachedContentId: string | null
  expiresAtUtc: string | null
  ttlMs: number
  decision: Decision
  previousCachedContentId?: string
  cache: {
    namespace: string
    key: string
    scope: Scope
    status: "hit" | "miss" | "expired" | "forced_rebuild"
    tier: "memory" | "disk" | "none"
  } | null
  reason?: string
  meta: {
    selector: "v1"
    model: { providerID: string; apiNpm: string; apiId: string; modelId: string }
    fingerprint: {
      blocksCacheKey: string
      toolsetFingerprint: string
      blockFingerprints: Record<string, string>
    }
  }
}

type Entry = {
  specVersion: "gemini-cached-content/1.0"
  cachedContentKey: string
  cachedContentId: string
  expiresAtUtc: string
  ttlMs: number
  error?: string
}

const namespace = "provider.gemini.cached-content"

const iso = (ms: number) => new Date(ms).toISOString()

const normalizeBaseURL = (baseURL: string) => baseURL.replace(/\/$/, "")

const joinURL = (baseURL: string, path: string) => {
  const left = normalizeBaseURL(baseURL)
  const right = path.replace(/^\//, "")
  return `${left}/${right}`
}

const selectedIds = () => new Set(["block:developer_instructions", "block:permissions_instructions", "block:decision_boundary"])

const prefixText = (blocks: Blocks) => {
  const allow = selectedIds()
  const parts = blocks.blocks
    .filter((b) => allow.has(b.id))
    .map((b) => b.text.trim())
    .filter((t) => t.length > 0)
  return parts.join("\n\n")
}

const fingerprint = (blocks: Blocks) => {
  const allow = selectedIds()
  const ids = Object.keys(blocks.blockFingerprints)
    .filter((id) => allow.has(id))
    .toSorted((a, b) => a.localeCompare(b))

  const picked: Record<string, string> = {}
  for (const id of ids) {
    const fp = blocks.blockFingerprints[id]
    if (typeof fp === "string" && fp.length > 0) {
      picked[id] = fp
    }
  }

  return {
    blocksCacheKey: blocks.cacheKey,
    toolsetFingerprint: blocks.toolsetFingerprint,
    blockFingerprints: picked,
  }
}

const keySpec = (input: { model: ModelRef; ttlMs: number; fingerprint: ReturnType<typeof fingerprint> }) => ({
  specVersion: "gemini-cached-content-key/1.0",
  selector: "v1",
  model: {
    providerID: input.model.providerID,
    apiNpm: input.model.api.npm,
    apiId: input.model.api.id,
    modelId: input.model.id,
  },
  ttlMs: input.ttlMs,
  fingerprint: input.fingerprint,
  versions: { stableJson: "v1" },
})

const cachedContentKey = (input: { model: ModelRef; ttlMs: number; blocks: Blocks }) => {
  const fp = fingerprint(input.blocks)
  const spec = keySpec({ model: input.model, ttlMs: input.ttlMs, fingerprint: fp })
  return { key: sha256Text(stableJson(spec)), meta: { selector: "v1" as const, model: spec.model, fingerprint: fp } }
}

const headers = (input: ProviderRef) => ({
  "content-type": "application/json",
  ...(input.apiKey ? { "x-goog-api-key": input.apiKey } : {}),
})

const readJson = async (res: Response) => {
  const data = await res.json().catch(() => null)
  if (!data || typeof data !== "object") return null
  return data as Record<string, unknown>
}

const classify = (res: Response) => {
  if (res.status === 404) return { kind: "not_found" as const }
  if (res.status === 400) return { kind: "invalid" as const }
  return { kind: "other" as const }
}

const validate = async (input: { provider: ProviderRef; cachedContentId: string; abort: AbortSignal; timeoutMs: number }) => {
  const url = joinURL(input.provider.baseURL, input.cachedContentId)
  const signal = AbortSignal.any([input.abort, AbortSignal.timeout(input.timeoutMs)])
  const res = await fetch(url, { method: "GET", headers: headers(input.provider), signal }).catch(() => null)
  if (!res) return { ok: false as const, retryable: true as const }
  if (res.ok) return { ok: true as const }
  const kind = classify(res)
  if (kind.kind === "not_found" || kind.kind === "invalid") return { ok: false as const, retryable: true as const }
  return { ok: false as const, retryable: false as const }
}

const create = async (input: {
  provider: ProviderRef
  model: ModelRef
  prefix: string
  ttlMs: number
  abort: AbortSignal
  timeoutMs: number
  nowMs: number
}) => {
  const url = joinURL(input.provider.baseURL, "cachedContents")
  const ttlSeconds = Math.max(1, Math.ceil(input.ttlMs / 1000))
  const body = stableJson({
    model: input.model.api.id.includes("/") ? input.model.api.id : `models/${input.model.api.id}`,
    ttl: `${ttlSeconds}s`,
    contents: [
      {
        role: "user",
        parts: [{ text: input.prefix }],
      },
    ],
  })

  const signal = AbortSignal.any([input.abort, AbortSignal.timeout(input.timeoutMs)])
  const res = await fetch(url, { method: "POST", headers: headers(input.provider), body, signal }).catch(() => null)
  if (!res) {
    return { ok: false as const, reason: "创建缓存内容失败：请求已取消或超时。" }
  }
  const data = await readJson(res)
  const name = typeof data?.name === "string" ? data.name : ""
  if (res.ok && name) {
    return {
      ok: true as const,
      value: {
        specVersion: "gemini-cached-content/1.0" as const,
        cachedContentId: name,
        expiresAtUtc: iso(input.nowMs + Math.max(0, input.ttlMs)),
      },
    }
  }
  const kind = classify(res)
  const reason =
    kind.kind === "not_found"
      ? "创建缓存内容失败：接口不存在（可能是网关未实现 cachedContents）。"
      : kind.kind === "invalid"
        ? "创建缓存内容失败：请求参数无效（可能是 cached content payload/ttl 格式不被支持）。"
        : `创建缓存内容失败：HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}。`
  return { ok: false as const, reason }
}

export namespace GeminiCachedContent {
  export async function resolve(input: {
    sessionId: string
    messageId: string
    model: ModelRef
    provider: ProviderRef
    blocks: Blocks
    scope: Scope
    ttlMs: number
    policy: Policy
    clock?: Clock
    abort: AbortSignal
    timeoutMs?: number
  }): Promise<Result> {
    const clock = input.clock ?? { nowMs: () => Date.now() }
    const timeoutMs = input.timeoutMs ?? 10_000
    const computed = cachedContentKey({ model: input.model, ttlMs: input.ttlMs, blocks: input.blocks })
    const key = computed.key

    if (!input.policy.enabled) {
      return {
        cachedContentKey: key,
        cachedContentId: null,
        expiresAtUtc: null,
        ttlMs: input.ttlMs,
        decision: "disabled",
        cache: null,
        meta: computed.meta,
      }
    }

    const store = CacheStore.open({
      namespace,
      scope: input.scope,
      limits: { memoryMaxEntries: 30, diskMaxEntries: 300 },
      clock,
    })

    const compute = async (): Promise<Entry> => {
      const nowMs = clock.nowMs()
      const prefix = prefixText(input.blocks)
      const created = await create({
        provider: input.provider,
        model: input.model,
        prefix,
        ttlMs: input.ttlMs,
        abort: input.abort,
        timeoutMs,
        nowMs,
      })
      if (created.ok) {
      return {
        specVersion: "gemini-cached-content/1.0",
        cachedContentKey: key,
        cachedContentId: created.value.cachedContentId,
        expiresAtUtc: created.value.expiresAtUtc,
        ttlMs: input.ttlMs,
      }
    }
    return {
      specVersion: "gemini-cached-content/1.0",
      cachedContentKey: key,
      cachedContentId: "",
      expiresAtUtc: iso(nowMs),
      ttlMs: input.ttlMs,
      error: created.reason,
    }
  }

    const base = await store.getOrCompute({
      key,
      ttlMs: input.ttlMs,
      policy: { enabled: true, force: false },
      compute,
    })

    const view = base.value as Entry
    const id = typeof view.cachedContentId === "string" && view.cachedContentId.length > 0 ? view.cachedContentId : null
    const expiresAtUtc = typeof view.expiresAtUtc === "string" && view.expiresAtUtc.length > 0 ? view.expiresAtUtc : null

    if (!id) {
      return {
        cachedContentKey: key,
        cachedContentId: null,
        expiresAtUtc: null,
        ttlMs: input.ttlMs,
        decision: "degraded",
        cache: { namespace, key, scope: input.scope, status: base.status, tier: base.tier },
        reason: view.error ?? "缓存内容创建失败，已降级为普通请求（不使用 cached content）。",
        meta: computed.meta,
      }
    }

    if (base.status !== "hit") {
      return {
        cachedContentKey: key,
        cachedContentId: id,
        expiresAtUtc,
        ttlMs: input.ttlMs,
        decision: "created",
        cache: { namespace, key, scope: input.scope, status: base.status, tier: base.tier },
        meta: computed.meta,
      }
    }

    const checked = await validate({ provider: input.provider, cachedContentId: id, abort: input.abort, timeoutMs })
    if (checked.ok) {
      return {
        cachedContentKey: key,
        cachedContentId: id,
        expiresAtUtc,
        ttlMs: input.ttlMs,
        decision: "reused",
        cache: { namespace, key, scope: input.scope, status: base.status, tier: base.tier },
        meta: computed.meta,
      }
    }

    if (!checked.retryable) {
      return {
        cachedContentKey: key,
        cachedContentId: null,
        expiresAtUtc: null,
        ttlMs: input.ttlMs,
        decision: "degraded",
        cache: { namespace, key, scope: input.scope, status: base.status, tier: base.tier },
        reason: "cached content 复用校验失败（非可重试），已降级为普通请求。",
        meta: computed.meta,
      }
    }

    const rebuilt = await store.getOrCompute({
      key,
      ttlMs: input.ttlMs,
      policy: { enabled: true, force: true },
      compute,
    })

    const view2 = rebuilt.value as Entry
    const id2 = typeof view2.cachedContentId === "string" && view2.cachedContentId.length > 0 ? view2.cachedContentId : null
    const expires2 = typeof view2.expiresAtUtc === "string" && view2.expiresAtUtc.length > 0 ? view2.expiresAtUtc : null

    if (id2) {
      return {
        cachedContentKey: key,
        cachedContentId: id2,
        expiresAtUtc: expires2,
        ttlMs: input.ttlMs,
        decision: "invalidated",
        previousCachedContentId: id,
        cache: { namespace, key, scope: input.scope, status: rebuilt.status, tier: rebuilt.tier },
        meta: computed.meta,
      }
    }

    return {
      cachedContentKey: key,
      cachedContentId: null,
      expiresAtUtc: null,
      ttlMs: input.ttlMs,
      decision: "degraded",
      cache: { namespace, key, scope: input.scope, status: rebuilt.status, tier: rebuilt.tier },
      reason: "cached content 已失效且重建失败，已降级为普通请求。",
      meta: computed.meta,
    }
  }
}
