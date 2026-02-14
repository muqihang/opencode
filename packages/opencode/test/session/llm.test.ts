import { describe, expect, test } from "bun:test"
import { LLM } from "../../src/session/llm"
import { resolveHybridRoutingPolicy } from "../../src/session/hybrid-routing-policy"
import { SecureOutputContract } from "../../src/session/secure-output-contract"
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

    const result = await LLM.runCompensationRetrieval<string>({
      sessionID: "s-main-chain",
      messageID: "m-main-chain",
      intentText: "need retrieval",
      abort: new AbortController().signal,
      route: {
        policy: resolveHybridRoutingPolicy({ gate: "balanced" }),
        main: {
          source: "orchestrator",
          enabled: true,
          coversRetrieval: true,
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

    const result = await LLM.runCompensationRetrieval<string>({
      sessionID: "s-main-chain-degraded",
      messageID: "m-main-chain-degraded",
      intentText: "need retrieval",
      abort: new AbortController().signal,
      route: {
        policy: resolveHybridRoutingPolicy({ gate: "balanced" }),
        main: {
          source: "orchestrator",
          enabled: true,
          coversRetrieval: true,
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

  test("strict gate keeps orchestrator main-chain priority when main is healthy", async () => {
    const calls: string[] = []

    const result = await LLM.runCompensationRetrieval<string>({
      sessionID: "s-main-chain-strict",
      messageID: "m-main-chain-strict",
      intentText: "need retrieval",
      abort: new AbortController().signal,
      route: {
        policy: resolveHybridRoutingPolicy({ gate: "strict" }),
        main: {
          source: "orchestrator",
          enabled: true,
          coversRetrieval: false,
          mode: "chat",
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

  test("balanced gate runs compensation when orchestrator main cannot cover retrieval", async () => {
    const calls: string[] = []

    const result = await LLM.runCompensationRetrieval<string>({
      sessionID: "s-main-chain-balanced",
      messageID: "m-main-chain-balanced",
      intentText: "need retrieval",
      abort: new AbortController().signal,
      route: {
        policy: resolveHybridRoutingPolicy({ gate: "balanced" }),
        main: {
          source: "orchestrator",
          enabled: true,
          coversRetrieval: false,
          mode: "chat",
          degraded: false,
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

  test("off gate disables compensation even when main is degraded", async () => {
    const calls: string[] = []

    const result = await LLM.runCompensationRetrieval<string>({
      sessionID: "s-main-chain-off",
      messageID: "m-main-chain-off",
      intentText: "need retrieval",
      abort: new AbortController().signal,
      route: {
        policy: resolveHybridRoutingPolicy({ gate: "off" }),
        main: {
          source: "orchestrator",
          enabled: true,
          coversRetrieval: true,
          mode: "assist",
          degraded: true,
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
})

describe("session.llm.secure-output contract granularity", () => {
  test("normal chat defaults to lightweight contract instead of strict claims schema", () => {
    const sections = LLM.buildSystemSections({
      providerPrompt: "provider",
      permissionText: "permissions",
      environmentText: "environment",
      capsuleText: "",
      userText: "",
    })

    const contract = sections.find((item) => item.id === "stable:secure_output_contract")?.text ?? ""
    expect(contract.includes("<assistant_claims_json>")).toBe(false)
  })

  test("strict path can still inject full claims contract explicitly", () => {
    const sections = LLM.buildSystemSections({
      providerPrompt: "provider",
      permissionText: "permissions",
      environmentText: "environment",
      capsuleText: "",
      userText: "",
      secureOutputContract: SecureOutputContract.text,
    })

    const contract = sections.find((item) => item.id === "stable:secure_output_contract")?.text ?? ""
    expect(contract.includes("<assistant_claims_json>")).toBe(true)
  })
})

describe("session.hybrid-routing-policy", () => {
  test("invalid gate falls back to orchestrator-main rollback policy", () => {
    const policy = resolveHybridRoutingPolicy({
      gate: "broken",
    })

    expect(policy.source).toBe("fallback")
    expect(policy.compensationGate).toBe("strict")
    expect(policy.rollback).toBe("orchestrator_main")
  })

  test("config policy is explicit and valid", () => {
    const policy = resolveHybridRoutingPolicy({
      strategy: "main_first",
      gate: "strict",
      rollback: "orchestrator_main",
    })

    expect(policy.source).toBe("config")
    expect(policy.strategy).toBe("main_first")
    expect(policy.compensationGate).toBe("strict")
    expect(policy.rollback).toBe("orchestrator_main")
  })

  test("invalid env strategy triggers fallback policy", () => {
    const policy = resolveHybridRoutingPolicy({
      envStrategy: "legacy",
    })

    expect(policy.source).toBe("fallback")
    expect(policy.compensationGate).toBe("strict")
    expect(policy.rollback).toBe("orchestrator_main")
  })

  test("env values override config policy", () => {
    const policy = resolveHybridRoutingPolicy({
      strategy: "main_first",
      gate: "off",
      rollback: "orchestrator_main",
      envGate: "balanced",
    })

    expect(policy.source).toBe("env")
    expect(policy.compensationGate).toBe("balanced")
  })
})
