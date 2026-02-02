import { describe, expect, test } from "bun:test"
import { Session } from "../../src/session"

// NOTE: This test is intentionally lightweight.
// It validates provider-specific cache token extraction without hitting any network.

describe("Session.getUsage", () => {
  test("reads OpenAI-compatible chat prompt_tokens_details.cached_tokens when flag enabled (GLM)", () => {
    const model = {
      providerID: "zai",
      id: "glm-4.7",
      api: { npm: "@ai-sdk/openai-compatible", id: "glm-4.7" },
    }

    const usage = Session.getUsage({
      // Session.getUsage only needs a small slice of Provider.Model at runtime.
      model,
      usage: {
        inputTokens: 100,
        outputTokens: 0,
        // Provider-specific field documented for GLM.
        // @ts-expect-error
        prompt_tokens_details: { cached_tokens: 40 },
      },
      metadata: {},
      // Feature flag: do not enable this extraction globally by default.
      flags: { openaiChatCachedTokens: true },
    })

    expect(usage.tokens.cache.read).toBe(40)
    expect(usage.tokens.input).toBe(60)
  })

  test("does not read prompt_tokens_details.cached_tokens when flag disabled", () => {
    const model = {
      providerID: "zai",
      id: "glm-4.7",
      api: { npm: "@ai-sdk/openai-compatible", id: "glm-4.7" },
    }

    const usage = Session.getUsage({
      model,
      usage: {
        inputTokens: 100,
        outputTokens: 0,
        // @ts-expect-error
        prompt_tokens_details: { cached_tokens: 40 },
      },
      metadata: {},
      flags: { openaiChatCachedTokens: false },
    })

    expect(usage.tokens.cache.read).toBe(0)
    expect(usage.tokens.input).toBe(100)
  })
})
