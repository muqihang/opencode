import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import type { OrchestratorPlan } from "../../src/protocol/orchestrator-plan"
import { resolveSecureOutputMode } from "../../src/session/orchestrator/policy"
import { LLM } from "../../src/session/llm"
import { buildReferenceCheckModeResolvedEventData } from "../../src/session/processor"
import { applyStrictReferenceCheck } from "../../src/session/reference-check"
import { SecureOutputContract } from "../../src/session/secure-output-contract"
import { resolveSecureOutputContract } from "../../src/session/secure-output-contract"
import { packPromptSections } from "../../src/session/orchestrator/prepare"
import { tmpdir } from "../fixture/fixture"

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

  test("secure output contract uses lightweight default and supports strict override", () => {
    const build = (
      LLM as unknown as {
        buildSystemSections?: (input: {
          providerPrompt: string
          permissionText: string
          environmentText: string
          capsuleText: string
          userText: string
          secureOutputContract?: string
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
    expect(contract?.text).toBe(SecureOutputContract.light)

    const packed = packPromptSections({ sections })
    expect(packed.packed.join("\n\n")).toContain("<secure_output_contract_light>")

    const strictSections = build({
      providerPrompt: "provider",
      permissionText: "permissions",
      environmentText: "environment",
      capsuleText: "",
      userText: "",
      secureOutputContract: SecureOutputContract.text,
    })
    const strict = strictSections.find((item) => item.id === "stable:secure_output_contract")
    expect(strict?.text).toBe(SecureOutputContract.text)
  })

  test("verification/resume/handoff/audit/summary stay strict across contract and reference-check", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "docs"), { recursive: true })
        await Bun.write(path.join(dir, "docs", "proof.md"), "line 1\nline 2\nline 3\n")
      },
    })

    const intents = [
      "please verify this with evidence",
      "please resume this task",
      "prepare a handoff capsule",
      "run an audit and cite sources",
      "please provide a summary",
      "请做总结并给出证据",
    ]

    for (const intentText of intents) {
      const contract = resolveSecureOutputContract({ intentText })
      expect(contract).toBe(SecureOutputContract.strict)

      const checked = await applyStrictReferenceCheck({
        intentText,
        text: "[evidence: docs/proof.md:2]",
        baseDir: tmp.path,
        sessionId: "session-contract-ref-check",
      })

      expect(checked.applied).toBe(true)
      expect(checked.blocked).toBe(false)
    }

    const normalContract = resolveSecureOutputContract({ intentText: "hello there" })
    expect(normalContract).toBe(SecureOutputContract.light)

    const normalCheck = await applyStrictReferenceCheck({
      intentText: "hello there",
      text: "普通回复",
      baseDir: tmp.path,
      sessionId: "session-contract-ref-check",
    })
    expect(normalCheck.applied).toBe(false)
  })

  test("balanced policy can escalate to strict under high-risk evidence-heavy confidence", async () => {
    const mode = resolveSecureOutputMode({
      enabled: true,
      plan: makePlan({ orchestratorMode: "assist" }),
    })
    expect(mode).toBe("balanced")

    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "docs"), { recursive: true })
        await Bun.write(path.join(dir, "docs", "proof.md"), "line 1\nline 2\nline 3\n")
      },
    })

    const checked = await applyStrictReferenceCheck({
      intentText: "直接回答，不要展开",
      text: "[evidence: docs/proof.md:2]",
      baseDir: tmp.path,
      sessionId: "session-policy-escalate",
      modeResolved: {
        mode: "normal",
        confidence: 0.96,
        reasonCodes: ["intent_not_verification", "high_risk", "evidence_heavy"],
        intent: "直接回答，不要展开",
      },
    })

    const structured = {
      mode_resolved: checked.modeResolved.mode,
      confidence: checked.modeResolved.confidence,
      reason_codes: checked.modeResolved.reasonCodes,
    }

    expect(checked.applied).toBe(true)
    expect(checked.blocked).toBe(false)
    expect(structured.mode_resolved).toBe("strict")
    expect(structured.confidence).toBeGreaterThanOrEqual(0.95)
    expect(structured.reason_codes.includes("confidence_escalated_strict")).toBe(true)
  })

  test("reference_check.mode_resolved event includes mode_resolved and legacy mode", () => {
    const data = buildReferenceCheckModeResolvedEventData({
      messageId: "msg-event",
      mode: "strict",
      confidence: 0.99,
      reasonCodes: ["confidence_escalated_strict"],
      intentText: "请输出最终审计结论",
    })

    expect(data.mode_resolved).toBe("strict")
    expect(data.mode).toBe("strict")
    expect(data.confidence).toBe(0.99)
    expect(data.reason_codes).toEqual(["confidence_escalated_strict"])
  })
})
