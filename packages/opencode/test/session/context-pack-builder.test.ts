import { describe, expect, test } from "bun:test"
import { ContextPack } from "../../src/protocol/context-pack"
import { ContextPackBuilder } from "../../src/session/context-pack"
import { tool, jsonSchema, type ModelMessage } from "ai"

describe("session.context-pack", () => {
  test("build returns schema-valid pack with consistent totals", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi" },
    ]

    const tools = {
      hello: tool({
        description: "say hi",
        inputSchema: jsonSchema({ type: "object", properties: {} }),
        execute: async () => ({ output: "ok", title: "", metadata: {} }),
      }),
    }

    const pack = ContextPackBuilder.build({
      sessionId: "session_test",
      messageId: "message_test",
      model: {
        providerID: "openai",
        id: "gpt-test",
        limit: { context: 4096, input: 2048, output: 1024 },
      },
      system: ["System"],
      messages,
      tools,
      maxOutputTokens: 1024,
    })

    const parsed = ContextPack.parse(pack)
    const total = parsed.segments.reduce((sum, segment) => sum + segment.tokenEstimate, 0)

    expect(parsed.totals.segments).toBe(parsed.segments.length)
    expect(parsed.totals.tokenEstimate).toBe(total)
  })

  test("schema rejects totals mismatch", () => {
    const pack = ContextPackBuilder.build({
      sessionId: "session_test",
      messageId: "message_test",
      model: {
        providerID: "openai",
        id: "gpt-test",
        limit: { context: 4096, input: 2048, output: 1024 },
      },
      system: ["System"],
      messages: [{ role: "user", content: "Hello" }],
      tools: {},
      maxOutputTokens: 1024,
    })

    expect(() =>
      ContextPack.parse({
        ...pack,
        totals: { ...pack.totals, segments: pack.totals.segments + 1 },
      }),
    ).toThrow()
  })
})
