import { describe, expect, test } from "bun:test"
import { ulid } from "ulid"
import { tool, jsonSchema, type Tool } from "ai"
import { runDualPass } from "../../src/session/orchestrator/dual-pass"
import { runOrchestratorTurn } from "../../src/session/orchestrator"
import { OrchestratorPlan } from "../../src/protocol/orchestrator-plan"
import { OrchestratorFeatures } from "../../src/protocol/orchestrator-features"

const makeTool = (): Tool =>
  tool({
    description: "test tool",
    inputSchema: jsonSchema({ type: "object", properties: {} }),
    execute: async () => ({ output: "", title: "", metadata: {} }),
  })

const baseFeatures = OrchestratorFeatures.parse({
  specVersion: "orchestrator-features/1.0",
  features: {
    uxMode: "auto",
    intentBytes: 8,
    intentTokensEstimate: 8,
    hasFileParts: false,
    hasWriteIntent: false,
    hasExecIntent: false,
    hasVerificationIntent: true,
  },
})

const plan = (workerId: string) =>
  OrchestratorPlan.parse({
    specVersion: "orchestrator-plan/1.0",
    orchestratorPlanId: ulid(),
    sessionId: "s-dual-pass",
    messageId: "m-dual-pass",
    orchestratorMode: "assist",
    uxMode: "auto",
    workers: [{ id: workerId, model: "small", budget: { timeoutMs: 100 } }],
    budgets: {
      maxWallClockMs: 2000,
      workerTimeoutMs: 100,
      maxOutputTokens: 800,
      maxToolCalls: 2,
    },
    toolPolicy: { allowed: ["retrieval"], bounceMax: 1 },
    dualPass: {
      enabled: true,
      criticTimeoutMs: 20,
      unknownFirst: "unknown-first",
    },
    reasons: [{ code: "test", message: "test" }],
    inputsFingerprint: { sha256: "a".repeat(64) },
  })

describe("dual-pass degrade", () => {
  test("critic error degrades to draft", async () => {
    const result = await runDualPass({
      draft: async () => "draft answer",
      critic: async () => {
        throw new Error("critic failed")
      },
      timeoutMs: 100,
      unknownFirst: "unknown-first",
    })

    expect(result.stage).toBe("degrade")
    expect(result.text).toBe("draft answer")
    if (result.stage !== "degrade") throw new Error("expected degrade stage")
    expect(result.degrade.fallback).toBe("draft")
    expect(result.degrade.reason.includes("critic failed")).toBe(true)
  })

  test("critic timeout degrades to unknown-first when draft is empty", async () => {
    const result = await runDualPass({
      draft: async () => "  ",
      critic: async () => new Promise(() => {}),
      timeoutMs: 5,
      unknownFirst: "unknown-first",
    })

    expect(result.stage).toBe("degrade")
    expect(result.text).toBe("unknown-first")
    if (result.stage !== "degrade") throw new Error("expected degrade stage")
    expect(result.degrade.fallback).toBe("unknown-first")
    expect(result.degrade.reason.includes("timeout")).toBe(true)
  })

  test("critic accept returns final", async () => {
    const result = await runDualPass({
      draft: async () => "draft answer",
      critic: async () => ({
        specVersion: "dual-pass/1.0",
        stage: "critic",
        verdict: "accept",
        text: "final answer",
      }),
      timeoutMs: 100,
      unknownFirst: "unknown-first",
    })

    expect(result.stage).toBe("final")
    expect(result.text).toBe("final answer")
  })

  test("orchestrator turn applies dual-pass degrade when worker is non-ok", async () => {
    const result = await runOrchestratorTurn({
      sessionId: "s-dual-pass-turn",
      messageId: "m-dual-pass-turn",
      abort: new AbortController().signal,
      plan: plan("unknown_worker"),
      features: baseFeatures,
      intentText: "需要证据",
      system: ["base"],
      tools: { read: makeTool() },
    })

    expect(result.degraded).toBe(true)
    expect(result.system.length).toBe(2)
    const injected = result.system[1] ?? ""
    const tagged = injected.includes("<orchestrator>") || injected.includes("<orchestrator_evidence_v2>")
    expect(tagged).toBe(true)
  })
})
