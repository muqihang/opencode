import { describe, expect, test } from "bun:test"

import { extractCacheReadTokens, extractCacheWriteTokens, normalizeUsage } from "../../src/usage/normalized"

describe("usage.normalized", () => {
  describe("extractCacheReadTokens()", () => {
    test("reads DeepSeek prompt_cache_hit_tokens as cache.read", () => {
      const got = extractCacheReadTokens({
        model: {
          providerID: "deepseek",
          api: { npm: "@ai-sdk/openai-compatible", id: "deepseek-chat" },
          id: "deepseek-chat",
        },
        usage: {
          // LanguageModelUsage allows extra provider fields at runtime.
          prompt_cache_hit_tokens: 123,
        },
        flags: {},
      })

      expect(got).toEqual({
        state: "known",
        value: 123,
        source: "usage.prompt_cache_hit_tokens",
      })
    })

    test("reads OpenAI Responses cachedInputTokens as cache.read", () => {
      const got = extractCacheReadTokens({
        model: {
          providerID: "openai",
          api: { npm: "@ai-sdk/openai", id: "gpt-5" },
          id: "gpt-5",
        },
        usage: {
          cachedInputTokens: 50,
        },
        flags: {},
      })

      expect(got).toEqual({
        state: "known",
        value: 50,
        source: "usage.cachedInputTokens",
      })
    })

    test("does not read OpenAI-compatible chat prompt_tokens_details.cached_tokens unless flag enabled", () => {
      const base = {
        model: {
          providerID: "zai",
          api: { npm: "@ai-sdk/openai-compatible", id: "glm-4.7" },
          id: "glm-4.7",
        },
        usage: {
          prompt_tokens_details: { cached_tokens: 42 },
        },
      }

      const disabled = extractCacheReadTokens({
        ...base,
        flags: { openaiChatCachedTokens: false },
      })
      expect(disabled.state).toBe("unknown")

      const enabled = extractCacheReadTokens({
        ...base,
        flags: { openaiChatCachedTokens: true },
      })
      expect(enabled).toEqual({
        state: "known",
        value: 42,
        source: "usage.prompt_tokens_details.cached_tokens",
      })
    })

    test("reads Gemini cachedContentTokenCount from provider metadata when available", () => {
      const got = extractCacheReadTokens({
        model: {
          providerID: "google",
          api: { npm: "@ai-sdk/google", id: "gemini-2.5-pro" },
          id: "gemini-2.5-pro",
        },
        usage: {},
        metadata: {
          google: { usageMetadata: { cachedContentTokenCount: 7 } },
        },
        flags: {},
      })

      expect(got).toEqual({
        state: "known",
        value: 7,
        source: "metadata.google.usageMetadata.cachedContentTokenCount",
      })
    })

    test("returns unknown when no cache read field is present (do not pretend)", () => {
      const got = extractCacheReadTokens({
        model: {
          providerID: "google",
          api: { npm: "@ai-sdk/google", id: "gemini-2.5-pro" },
          id: "gemini-2.5-pro",
        },
        usage: {},
        flags: {},
      })

      expect(got.state).toBe("unknown")
      expect(got.value).toBe(null)
    })
  })

  describe("extractCacheWriteTokens()", () => {
    test("reads anthropic cacheCreationInputTokens as cache.write", () => {
      const got = extractCacheWriteTokens({
        model: {
          providerID: "anthropic",
          api: { npm: "@ai-sdk/anthropic", id: "claude-sonnet-4" },
          id: "claude-sonnet-4",
        },
        metadata: {
          // ProviderMetadata is loose at runtime; we only care about a narrow slice.
          anthropic: { cacheCreationInputTokens: 9 },
        },
      })

      expect(got).toEqual({
        state: "known",
        value: 9,
        source: "metadata.anthropic.cacheCreationInputTokens",
      })
    })

    test("returns unknown when cache write field is missing", () => {
      const got = extractCacheWriteTokens({
        model: {
          providerID: "anthropic",
          api: { npm: "@ai-sdk/anthropic", id: "claude-sonnet-4" },
          id: "claude-sonnet-4",
        },
        metadata: {},
      })

      expect(got.state).toBe("unknown")
      expect(got.value).toBe(null)
    })
  })

  describe("normalizeUsage()", () => {
    test("derives cacheHit only when cacheReadTokens is known/derived and > 0", () => {
      const normalized = normalizeUsage({
        model: {
          providerID: "openai",
          api: { npm: "@ai-sdk/openai", id: "gpt-5" },
          id: "gpt-5",
        },
        usage: { cachedInputTokens: 2 },
        metadata: {},
        // Align promptTokens with existing Session.getUsage.tokens.input semantics.
        // (Here we supply the already-computed token breakdown.)
        tokens: {
          input: 10,
          output: 3,
          reasoning: 0,
          cache: { read: 2, write: 0 },
        },
        flags: {},
      })

      expect(normalized.specVersion).toBe("usage-normalized/1.0")
      expect(normalized.tokens.promptTokens).toEqual({
        state: "known",
        value: 10,
        source: "session.getUsage.tokens.input",
      })
      expect(normalized.tokens.cacheReadTokens).toEqual({
        state: "known",
        value: 2,
        source: "usage.cachedInputTokens",
      })
      expect(normalized.tokens.cacheHit).toEqual({
        state: "derived",
        value: true,
        source: "tokens.cacheReadTokens",
        note: "cacheReadTokens > 0",
      })
      expect(normalized.tokens.totalTokens.state).toBe("derived")
      expect(normalized.providerRaw).toBe(null)
    })

    test("keeps cacheHit unknown when cacheReadTokens is unknown", () => {
      const normalized = normalizeUsage({
        model: {
          providerID: "google",
          api: { npm: "@ai-sdk/google", id: "gemini-2.5-pro" },
          id: "gemini-2.5-pro",
        },
        usage: {},
        metadata: {},
        tokens: {
          input: 10,
          output: 3,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
        flags: {},
      })

      expect(normalized.tokens.cacheReadTokens.state).toBe("unknown")
      expect(normalized.tokens.cacheHit.state).toBe("unknown")
    })
  })
})
