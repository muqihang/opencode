import { describe, expect, test } from "bun:test"
import { LLM } from "../../src/session/llm"

describe("LLM.buildGatewayHeaders", () => {
  test("adds session_id/conversation_id when wire_api=responses for openai npm providers", () => {
    const headers = LLM.buildGatewayHeaders({
      sessionID: "ses_123",
      model: { api: { npm: "@ai-sdk/openai" } },
      providerOptions: { wire_api: "responses" },
    })
    expect(headers).toEqual({ session_id: "ses_123", conversation_id: "ses_123" })
  })

  test("returns empty object for non-openai providers by default", () => {
    const headers = LLM.buildGatewayHeaders({
      sessionID: "ses_123",
      model: { api: { npm: "@ai-sdk/anthropic" } },
      providerOptions: { wire_api: "responses" },
    })
    expect(headers).toEqual({})
  })

  test("can be forced on for non-openai gateways (Gemini/Anthropic via Sub2API)", () => {
    const headers = LLM.buildGatewayHeaders({
      sessionID: "ses_123",
      model: { api: { npm: "@ai-sdk/google" } },
      providerOptions: { stickySessionHeaders: true },
    })
    expect(headers).toEqual({ session_id: "ses_123", conversation_id: "ses_123" })
  })
})
