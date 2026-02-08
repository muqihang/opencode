import type { ProviderMetadata } from "ai"
import { stableJson } from "@/util/stable-json"
import { extractCacheReadTokens, extractCacheWriteTokens, normalizeUsage, type UsageFlags } from "@/usage/normalized"

type Writer = {
  event: (input: {
    specVersion: "event/1.0"
    ts: string
    sessionId: string
    severity: "info" | "error" | "warn"
    actor: string
    type: string
    summary: string
    data?: Record<string, unknown>
    redaction: { applied: boolean; policyVersion: string }
  }) => Promise<void>
  artifact: (input: { kind: string; path: string; data: string }) => Promise<{ path: string }>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function numberFrom(value: unknown): number | null {
  if (typeof value !== "number") return null
  if (!Number.isFinite(value)) return null
  return value
}

function meta(input: ProviderMetadata | undefined, key: string): Record<string, unknown> | null {
  if (!input) return null
  const value = input[key]
  if (!isRecord(value)) return null
  return value
}

function cacheHitRatio(input: { hit: number | null; miss: number | null }) {
  if (input.hit === null || input.miss === null) {
    return {
      cache_hit_ratio: null,
      cache_hit_ratio_source: null,
    }
  }

  const denominator = input.hit + input.miss
  if (denominator === 0) {
    return {
      cache_hit_ratio: 0,
      cache_hit_ratio_source: "usage.prompt_cache_hit_tokens+usage.prompt_cache_miss_tokens:denominator_zero",
    }
  }

  return {
    cache_hit_ratio: input.hit / denominator,
    cache_hit_ratio_source: "usage.prompt_cache_hit_tokens+usage.prompt_cache_miss_tokens",
  }
}

export function providerUsageSummary(input: {
  model: {
    providerID: string
    id: string
    api: { npm: string; id: string }
  }
  usage: Record<string, unknown>
  metadata: ProviderMetadata | undefined
  flags?: UsageFlags
}) {
  const read = extractCacheReadTokens({ model: input.model, usage: input.usage, metadata: input.metadata, flags: input.flags })
  const write = extractCacheWriteTokens({ model: input.model, metadata: input.metadata })

  const openai = meta(input.metadata, "openai")
  const responseId = openai ? (typeof openai["responseId"] === "string" ? openai["responseId"] : null) : null

  const hit = numberFrom(input.usage["prompt_cache_hit_tokens"])
  const miss = numberFrom(input.usage["prompt_cache_miss_tokens"])

  const details = input.usage["prompt_tokens_details"]
  const cachedDetails = isRecord(details) ? numberFrom(details["cached_tokens"]) : null
  const ratio = cacheHitRatio({ hit, miss })

  return {
    specVersion: "provider-usage-summary/1.0",
    provider: {
      providerID: input.model.providerID,
      apiNpm: input.model.api.npm,
      modelID: input.model.api.id,
    },
    usage: {
      inputTokens: numberFrom(input.usage["inputTokens"]),
      outputTokens: numberFrom(input.usage["outputTokens"]),
      totalTokens: numberFrom(input.usage["totalTokens"]),
      cachedInputTokens: numberFrom(input.usage["cachedInputTokens"]),
      promptCacheHitTokens: hit,
      promptCacheMissTokens: miss,
      promptTokensDetailsCachedTokens: cachedDetails,
    },
    cache: {
      read: read.state === "known" ? read.value : null,
      read_source: read.state === "known" ? read.source : null,
      write: write.state === "known" ? write.value : null,
      write_source: write.state === "known" ? write.source : null,
      cache_hit_ratio: ratio.cache_hit_ratio,
      cache_hit_ratio_source: ratio.cache_hit_ratio_source,
    },
    ids: {
      openaiResponseId: responseId,
    },
  }
}

export async function writeUsageEvents(input: {
  writer: Writer
  ts: string
  sessionId: string
  messageId: string
  model: {
    providerID: string
    id: string
    api: { npm: string; id: string }
  }
  usage: Record<string, unknown>
  metadata: ProviderMetadata | undefined
  tokens: {
    input: number
    output: number
    reasoning: number
    cache: { read: number; write: number }
  }
  flags?: UsageFlags
  providerRaw: { enabled: boolean }
}) {
  const normalized = normalizeUsage({
    model: input.model,
    usage: input.usage,
    metadata: input.metadata,
    tokens: input.tokens,
    flags: input.flags,
  })
  const summary = providerUsageSummary({
    model: input.model,
    usage: input.usage,
    metadata: input.metadata,
    flags: input.flags,
  })

  const withRaw = await (async () => {
    if (!input.providerRaw.enabled) return normalized

    const entry = await input.writer.artifact({
      kind: "usage-provider-summary",
      path: `usage/${input.messageId}/provider-usage-summary.json`,
      data: stableJson(summary),
    })

    return {
      ...normalized,
      providerRaw: {
        kind: "artifact" as const,
        pointer: entry.path,
        summary: {
          openaiResponseId: summary.ids.openaiResponseId,
          cacheReadTokens: summary.cache.read,
          cacheReadTokensSource: summary.cache.read_source,
          cacheWriteTokens: summary.cache.write,
          cacheWriteTokensSource: summary.cache.write_source,
          cache_hit_ratio: summary.cache.cache_hit_ratio,
          cache_hit_ratio_source: summary.cache.cache_hit_ratio_source,
        },
      },
    }
  })()

  await input.writer.event({
    specVersion: "event/1.0",
    ts: input.ts,
    sessionId: input.sessionId,
    severity: "info",
    actor: "session:usage",
    type: "usage.normalized",
    summary: "usage normalized",
    data: {
      messageId: input.messageId,
      normalized: withRaw,
      cache: {
        cache_hit_ratio: summary.cache.cache_hit_ratio,
        cache_hit_ratio_source: summary.cache.cache_hit_ratio_source,
      },
    },
    redaction: { applied: true, policyVersion: "v1" },
  })

  if (withRaw.tokens.cacheReadTokens.state !== "unknown" && withRaw.tokens.cacheReadTokens.value > 0) {
    await input.writer.event({
      specVersion: "event/1.0",
      ts: input.ts,
      sessionId: input.sessionId,
      severity: "info",
      actor: "session:usage",
      type: "cache.read",
      summary: "provider cache read",
      data: {
        messageId: input.messageId,
        tokens: {
          cacheReadTokens: withRaw.tokens.cacheReadTokens,
        },
        provider: withRaw.provider,
        providerRaw: withRaw.providerRaw,
        cache: {
          cache_hit_ratio: summary.cache.cache_hit_ratio,
          cache_hit_ratio_source: summary.cache.cache_hit_ratio_source,
        },
      },
      redaction: { applied: true, policyVersion: "v1" },
    })
  }

  if (withRaw.tokens.cacheWriteTokens.state !== "unknown" && withRaw.tokens.cacheWriteTokens.value > 0) {
    await input.writer.event({
      specVersion: "event/1.0",
      ts: input.ts,
      sessionId: input.sessionId,
      severity: "info",
      actor: "session:usage",
      type: "cache.write",
      summary: "provider cache write",
      data: {
        messageId: input.messageId,
        tokens: {
          cacheWriteTokens: withRaw.tokens.cacheWriteTokens,
        },
        provider: withRaw.provider,
        providerRaw: withRaw.providerRaw,
        cache: {
          cache_hit_ratio: summary.cache.cache_hit_ratio,
          cache_hit_ratio_source: summary.cache.cache_hit_ratio_source,
        },
      },
      redaction: { applied: true, policyVersion: "v1" },
    })
  }

  return { normalized: withRaw }
}
