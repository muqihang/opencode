import type { ProviderMetadata } from "ai"

export type UsageSpecVersion = "usage-normalized/1.0"

export type UsageFlags = {
  openaiChatCachedTokens?: boolean
}

export type TokenValue =
  | {
      state: "known"
      value: number
      source: string
    }
  | {
      state: "unknown"
      value: null
      source: string
      note: string
    }

export type UsageMeasure =
  | {
      state: "known"
      value: number
      source: string
    }
  | {
      state: "derived"
      value: number
      source: string
      note: string
    }
  | {
      state: "unknown"
      value: null
      source: string
      note: string
    }

export type UsageBool =
  | {
      state: "known"
      value: boolean
      source: string
    }
  | {
      state: "derived"
      value: boolean
      source: string
      note: string
    }
  | {
      state: "unknown"
      value: null
      source: string
      note: string
    }

export type UsageNormalizedV1 = {
  specVersion: UsageSpecVersion
  provider: {
    providerID: string
    apiNpm: string
    modelID: string
    wire: "openai.responses" | "openai.chat" | "anthropic.messages" | "google.gemini" | "unknown"
    maturity: "experimental" | "beta" | "stable"
  }
  tokens: {
    promptTokens: UsageMeasure
    completionTokens: UsageMeasure
    totalTokens: UsageMeasure

    cacheReadTokens: UsageMeasure
    cacheWriteTokens: UsageMeasure
    cacheHit: UsageBool
  }
  providerRaw:
    | null
    | {
        kind: "artifact"
        pointer: string
        summary?: Record<string, string | number | boolean | null>
      }
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

export function extractCacheReadTokens(input: {
  model: {
    providerID: string
    id: string
    api: { npm: string; id: string }
  }
  usage: Record<string, unknown>
  metadata?: ProviderMetadata
  flags?: UsageFlags
}): TokenValue {
  const direct = numberFrom(input.usage["cachedInputTokens"])
  if (direct !== null) {
    return {
      state: "known",
      value: direct,
      source: "usage.cachedInputTokens",
    }
  }

  const deepseekHit = input.model.providerID === "deepseek" ? numberFrom(input.usage["prompt_cache_hit_tokens"]) : null
  if (deepseekHit !== null) {
    return {
      state: "known",
      value: deepseekHit,
      source: "usage.prompt_cache_hit_tokens",
    }
  }

  const google = meta(input.metadata, "google")
  const usageMeta =
    google && isRecord(google["usageMetadata"]) ? (google["usageMetadata"] as Record<string, unknown>) : null
  const googleCached = usageMeta ? numberFrom(usageMeta["cachedContentTokenCount"]) : null
  if (googleCached !== null) {
    return {
      state: "known",
      value: googleCached,
      source: "metadata.google.usageMetadata.cachedContentTokenCount",
    }
  }

  if (input.flags?.openaiChatCachedTokens) {
    const details = input.usage["prompt_tokens_details"]
    if (isRecord(details)) {
      const cached = numberFrom(details["cached_tokens"])
      if (cached !== null) {
        return {
          state: "known",
          value: cached,
          source: "usage.prompt_tokens_details.cached_tokens",
        }
      }
    }
  }

  return {
    state: "unknown",
    value: null,
    source: "usage",
    note: "no cache read token field available",
  }
}

export function extractCacheWriteTokens(input: {
  model: {
    providerID: string
    id: string
    api: { npm: string; id: string }
  }
  metadata: ProviderMetadata | undefined
}): TokenValue {
  const anthropic = meta(input.metadata, "anthropic")
  const anthropicWrite = anthropic ? numberFrom(anthropic["cacheCreationInputTokens"]) : null
  if (anthropicWrite !== null) {
    return {
      state: "known",
      value: anthropicWrite,
      source: "metadata.anthropic.cacheCreationInputTokens",
    }
  }

  const bedrock = meta(input.metadata, "bedrock")
  const bedrockUsage = bedrock && isRecord(bedrock["usage"]) ? (bedrock["usage"] as Record<string, unknown>) : null
  const bedrockWrite = bedrockUsage ? numberFrom(bedrockUsage["cacheWriteInputTokens"]) : null
  if (bedrockWrite !== null) {
    return {
      state: "known",
      value: bedrockWrite,
      source: "metadata.bedrock.usage.cacheWriteInputTokens",
    }
  }

  return {
    state: "unknown",
    value: null,
    source: "metadata",
    note: "no cache write token field available",
  }
}

function wire(model: { providerID: string; api: { npm: string } }) {
  if (model.providerID === "openai") return "openai.responses" as const
  if (["@ai-sdk/anthropic", "@ai-sdk/google-vertex/anthropic"].includes(model.api.npm)) return "anthropic.messages" as const
  if (["@ai-sdk/google", "@ai-sdk/google-vertex"].includes(model.api.npm)) return "google.gemini" as const
  if (model.api.npm === "@ai-sdk/openai-compatible") return "openai.chat" as const
  return "unknown" as const
}

function maturity(model: { providerID: string; api: { npm: string } }) {
  if (model.providerID === "openai") return "stable" as const
  if (["@ai-sdk/anthropic", "@ai-sdk/google-vertex/anthropic"].includes(model.api.npm)) return "beta" as const
  if (model.providerID === "deepseek") return "beta" as const
  if (["@ai-sdk/google", "@ai-sdk/google-vertex"].includes(model.api.npm)) return "experimental" as const
  if (model.api.npm === "@ai-sdk/openai-compatible") return "experimental" as const
  return "experimental" as const
}

export function normalizeUsage(input: {
  model: {
    providerID: string
    id: string
    api: { npm: string; id: string }
  }
  usage: Record<string, unknown>
  metadata: ProviderMetadata | undefined
  // Existing Session.getUsage token breakdown.
  tokens: {
    input: number
    output: number
    reasoning: number
    cache: { read: number; write: number }
  }
  flags?: UsageFlags
}): UsageNormalizedV1 {
  const read = extractCacheReadTokens({ model: input.model, usage: input.usage, metadata: input.metadata, flags: input.flags })
  const write = extractCacheWriteTokens({ model: input.model, metadata: input.metadata })

  const prompt: UsageMeasure = {
    state: "known",
    value: input.tokens.input,
    source: "session.getUsage.tokens.input",
  }

  const completion: UsageMeasure = {
    state: "known",
    value: input.tokens.output,
    source: "session.getUsage.tokens.output",
  }

  const total: UsageMeasure = {
    state: "derived",
    value: prompt.value + completion.value,
    source: "tokens.promptTokens+tokens.completionTokens",
    note: "billable total",
  }

  const cacheReadTokens: UsageMeasure =
    read.state === "known"
      ? { state: "known", value: read.value, source: read.source }
      : {
          state: "unknown",
          value: null,
          source: read.source,
          note: read.note,
        }

  const cacheWriteTokens: UsageMeasure =
    write.state === "known"
      ? { state: "known", value: write.value, source: write.source }
      : {
          state: "unknown",
          value: null,
          source: write.source,
          note: write.note,
        }

  const cacheHit: UsageBool = (() => {
    if (cacheReadTokens.state === "unknown") {
      return {
        state: "unknown",
        value: null,
        source: "tokens.cacheReadTokens",
        note: "cacheReadTokens is unknown",
      }
    }

    if (cacheReadTokens.value > 0) {
      return {
        state: "derived",
        value: true,
        source: "tokens.cacheReadTokens",
        note: "cacheReadTokens > 0",
      }
    }

    return {
      state: "derived",
      value: false,
      source: "tokens.cacheReadTokens",
      note: "cacheReadTokens === 0",
    }
  })()

  return {
    specVersion: "usage-normalized/1.0",
    provider: {
      providerID: input.model.providerID,
      apiNpm: input.model.api.npm,
      modelID: input.model.api.id,
      wire: wire(input.model),
      maturity: maturity(input.model),
    },
    tokens: {
      promptTokens: prompt,
      completionTokens: completion,
      totalTokens: total,
      cacheReadTokens,
      cacheWriteTokens,
      cacheHit,
    },
    providerRaw: null,
  }
}
