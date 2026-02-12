import { describe, expect, test } from "bun:test"
import { LLM } from "../../src/session/llm"
import type { ModelMessage } from "ai"

describe("session.llm.hasToolCalls", () => {
  test("returns false for empty messages array", () => {
    expect(LLM.hasToolCalls([])).toBe(false)
  })

  test("returns false for messages with only text content", () => {
    const messages: ModelMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "Hello" }],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "Hi there" }],
      },
    ]
    expect(LLM.hasToolCalls(messages)).toBe(false)
  })

  test("returns true when messages contain tool-call", () => {
    const messages = [
      {
        role: "user",
        content: [{ type: "text", text: "Run a command" }],
      },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call-123",
            toolName: "bash",
          },
        ],
      },
    ] as ModelMessage[]
    expect(LLM.hasToolCalls(messages)).toBe(true)
  })

  test("returns true when messages contain tool-result", () => {
    const messages = [
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-123",
            toolName: "bash",
          },
        ],
      },
    ] as ModelMessage[]
    expect(LLM.hasToolCalls(messages)).toBe(true)
  })

  test("returns false for messages with string content", () => {
    const messages: ModelMessage[] = [
      {
        role: "user",
        content: "Hello world",
      },
      {
        role: "assistant",
        content: "Hi there",
      },
    ]
    expect(LLM.hasToolCalls(messages)).toBe(false)
  })

  test("returns true when tool-call is mixed with text content", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "Let me run that command" },
          {
            type: "tool-call",
            toolCallId: "call-456",
            toolName: "read",
          },
        ],
      },
    ] as ModelMessage[]
    expect(LLM.hasToolCalls(messages)).toBe(true)
  })
})

describe("session.llm.compensation-retrieval", () => {
  test("orchestrator assist main chain suppresses compensation retrieval", async () => {
    const calls: string[] = []

    const result = await LLM.runCompensationRetrieval({
      sessionID: "s-main-chain",
      messageID: "m-main-chain",
      intentText: "need retrieval",
      abort: new AbortController().signal,
      route: {
        main: {
          source: "orchestrator",
          enabled: true,
          mode: "assist",
          degraded: false,
        },
      },
      execute: async (input) => {
        calls.push(input.intentText)
        return "ok"
      },
    })

    expect(result).toBeUndefined()
    expect(calls.length).toBe(0)
  })

  test("orchestrator degraded allows compensation retrieval fallback", async () => {
    const calls: string[] = []

    const result = await LLM.runCompensationRetrieval({
      sessionID: "s-main-chain-degraded",
      messageID: "m-main-chain-degraded",
      intentText: "need retrieval",
      abort: new AbortController().signal,
      route: {
        main: {
          source: "orchestrator",
          enabled: true,
          mode: "assist",
          degraded: true,
        },
      },
      execute: async (input) => {
        calls.push(input.intentText)
        return "ok"
      },
    })

    expect(result).toBe("ok")
    expect(calls.length).toBe(1)
  })
})
