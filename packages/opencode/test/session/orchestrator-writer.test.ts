import { describe, expect, test } from "bun:test"
import { EvidenceReader } from "../../src/evidence/reader"
import { Instance } from "../../src/project/instance"
import { OrchestratorFeatures } from "../../src/protocol/orchestrator-features"
import { OrchestratorPlan } from "../../src/protocol/orchestrator-plan"
import { writeOrchestratorArtifacts } from "../../src/session/orchestrator/writer"
import { tmpdir } from "../fixture/fixture"

const plan = (input: { sessionId: string; messageId: string; planId: string; reasons: string[] }) =>
  OrchestratorPlan.parse({
    specVersion: "orchestrator-plan/1.0",
    orchestratorPlanId: input.planId,
    sessionId: input.sessionId,
    messageId: input.messageId,
    orchestratorMode: "assist",
    uxMode: "auto",
    workers: [
      {
        id: "retrieval_planner",
        model: "small",
        budget: { timeoutMs: 8_000 },
      },
      {
        id: "evidence_critic",
        model: "small",
        budget: { timeoutMs: 8_000 },
      },
    ],
    budgets: {
      maxWallClockMs: 20_000,
      workerTimeoutMs: 12_000,
      maxOutputTokens: 32_000,
      maxToolCalls: 4,
    },
    evidencePolicy: {
      enabled: true,
      mode: "balanced",
    },
    toolPolicy: {
      allowed: ["retrieval"],
      bounceMax: 1,
    },
    reasons: input.reasons.map((code) => ({ code, message: code })),
    inputsFingerprint: { sha256: "a".repeat(64) },
  })

const features = OrchestratorFeatures.parse({
  specVersion: "orchestrator-features/1.0",
  features: {
    uxMode: "auto",
    intentBytes: 120,
    intentTokensEstimate: 30,
    hasFileParts: false,
    hasWriteIntent: false,
    hasExecIntent: false,
    hasVerificationIntent: true,
  },
})

describe("orchestrator writer adaptive ttc events", () => {
  test("default adaptive policy does not emit degraded event", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const sessionId = "s-writer-adaptive-default"
        const messageId = "m-writer-adaptive-default"
        await writeOrchestratorArtifacts({
          sessionId,
          plan: plan({
            sessionId,
            messageId,
            planId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
            reasons: ["adaptive.ttc.default_2", "intent.verification"],
          }),
          features,
        })

        const events = await EvidenceReader.readEvents(sessionId, { cursor: 0 })
        const degraded = events.events.filter(
          (item) => item.type === "orchestrator.degraded" && item.data?.["stage"] === "adaptive_ttc",
        )
        expect(degraded.length).toBe(0)
      },
    })
  })

  test("budget or breaker reductions still emit degraded adaptive event", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const sessionId = "s-writer-adaptive-degraded"
        const messageId = "m-writer-adaptive-degraded"
        await writeOrchestratorArtifacts({
          sessionId,
          plan: plan({
            sessionId,
            messageId,
            planId: "01ARZ3NDEKTSV4RRFFQ69G5FAW",
            reasons: ["adaptive.ttc.degrade_2_to_1", "adaptive.ttc.breaker.active"],
          }),
          features,
        })

        const events = await EvidenceReader.readEvents(sessionId, { cursor: 0 })
        const degraded = events.events.find(
          (item) => item.type === "orchestrator.degraded" && item.data?.["stage"] === "adaptive_ttc",
        )

        expect(Boolean(degraded)).toBe(true)
        expect(String(degraded?.data?.["reason"] ?? "").includes("adaptive.ttc.degrade_2_to_1")).toBe(true)
        expect(String(degraded?.data?.["reason"] ?? "").includes("adaptive.ttc.breaker.active")).toBe(true)
      },
    })
  })
})
