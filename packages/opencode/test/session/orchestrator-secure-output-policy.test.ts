import { describe, expect, test } from "bun:test"
import type { OrchestratorPlan } from "../../src/protocol/orchestrator-plan"
import { resolveSecureOutputMode } from "../../src/session/orchestrator/policy"
import { LLM } from "../../src/session/llm"
import { SecureOutputContract } from "../../src/session/secure-output-contract"
import { packPromptSections } from "../../src/session/orchestrator/prepare"

const makePlan = (overrides: Partial<OrchestratorPlan> = {}): OrchestratorPlan => {
  return {
    specVersion: "orchestrator-plan/1.0",
    orchestratorPlanId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    sessionId: "ses_test",
    messageId: "msg_test",
    orchestratorMode: "assist",
    uxMode: "auto",
    mainTools: null,
    workers: [],
    budgets: {
      maxWallClockMs: 1,
      workerTimeoutMs: 1,
      maxOutputTokens: 1,
      maxToolCalls: 1,
    },
    toolPolicy: {
      allowed: ["read"],
      bounceMax: 1,
    },
    reasons: [],
    inputsFingerprint: {
      sha256: "0".repeat(64),
    },
    ...overrides,
  }
}

describe("orchestrator secure-output policy", () => {
  test("orchestrator disabled keeps balanced", () => {
    const mode = resolveSecureOutputMode({ enabled: false, plan: makePlan() })
    expect(mode).toBe("balanced")
  })

  test("chat mode skips unless evidencePolicy enabled", () => {
    const skip = resolveSecureOutputMode({
      enabled: true,
      plan: makePlan({ orchestratorMode: "chat" }),
    })
    expect(skip).toBeNull()

    const enabled = resolveSecureOutputMode({
      enabled: true,
      plan: makePlan({
        orchestratorMode: "chat",
        evidencePolicy: { enabled: true, mode: "loose" },
      }),
    })
    expect(enabled).toBe("loose")
  })

  test("assist/heavy default modes and overrides", () => {
    const assist = resolveSecureOutputMode({
      enabled: true,
      plan: makePlan({ orchestratorMode: "assist" }),
    })
    expect(assist).toBe("balanced")

    const assistOverride = resolveSecureOutputMode({
      enabled: true,
      plan: makePlan({
        orchestratorMode: "assist",
        evidencePolicy: { enabled: true, mode: "strict" },
      }),
    })
    expect(assistOverride).toBe("strict")

    const heavy = resolveSecureOutputMode({
      enabled: true,
      plan: makePlan({ orchestratorMode: "heavy" }),
    })
    expect(heavy).toBe("strict")

    const heavyOverride = resolveSecureOutputMode({
      enabled: true,
      plan: makePlan({
        orchestratorMode: "heavy",
        evidencePolicy: { enabled: true, mode: "loose" },
      }),
    })
    expect(heavyOverride).toBe("loose")
  })

  test("fork mode skips secure-output in parent", () => {
    const mode = resolveSecureOutputMode({
      enabled: true,
      plan: makePlan({ orchestratorMode: "fork" }),
    })
    expect(mode).toBeNull()
  })

  test("secure output contract arrival in system prompt", () => {
    const build = (
      LLM as unknown as {
        buildSystemSections?: (input: {
          providerPrompt: string
          permissionText: string
          environmentText: string
          capsuleText: string
          userText: string
        }) => Array<{ id: string; stability: "stable" | "dynamic"; text: string }>
      }
    ).buildSystemSections

    expect(typeof build).toBe("function")
    if (!build) return

    const sections = build({
      providerPrompt: "provider",
      permissionText: "permissions",
      environmentText: "environment",
      capsuleText: "",
      userText: "",
    })
    const contract = sections.find((item) => item.id === "stable:secure_output_contract")
    expect(contract?.text).toBe(SecureOutputContract.text)

    const packed = packPromptSections({ sections })
    expect(packed.packed.join("\n\n")).toContain("<secure_output_contract>")
  })
})
