import { describe, expect, test } from "bun:test"
import { EvidenceReader } from "../../src/evidence/reader"
import { Instance } from "../../src/project/instance"
import { OrchestratorFeatures } from "../../src/protocol/orchestrator-features"
import { OrchestratorPlan } from "../../src/protocol/orchestrator-plan"
import { writeOrchestratorArtifacts } from "../../src/session/orchestrator/writer"
import { tmpdir } from "../fixture/fixture"

const plan = (input: {
  sessionId: string
  messageId: string
  planId: string
  reasons: string[]
  mode?: "chat" | "assist" | "heavy" | "fork"
}) => {
  const mode = input.mode ?? "assist"
  const workers = (() => {
    if (mode === "assist" || mode === "fork") {
      return [
        {
          id: "retrieval_planner",
          model: "small" as const,
          budget: { timeoutMs: 8_000 },
        },
        {
          id: "evidence_critic",
          model: "small" as const,
          budget: { timeoutMs: 8_000 },
        },
      ]
    }
    if (mode === "heavy") {
      return [
        {
          id: "retrieval_planner",
          model: "small" as const,
          budget: { timeoutMs: 8_000 },
        },
        {
          id: "patch_planner",
          model: "small" as const,
          budget: { timeoutMs: 8_000 },
        },
      ]
    }
    return []
  })()

  return OrchestratorPlan.parse({
    specVersion: "orchestrator-plan/1.0",
    orchestratorPlanId: input.planId,
    sessionId: input.sessionId,
    messageId: input.messageId,
    orchestratorMode: mode,
    uxMode: "auto",
    workers,
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
}

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

  test("chat and fork keep progress ledger rerunCount bounded", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const chatSession = "s-writer-chat-bounded"
        const chatMessage = "m-writer-chat-bounded"
        await writeOrchestratorArtifacts({
          sessionId: chatSession,
          plan: plan({
            sessionId: chatSession,
            messageId: chatMessage,
            planId: "01ARZ3NDEKTSV4RRFFQ69G5FAX",
            mode: "chat",
            reasons: ["intent.chat"],
          }),
          features,
        })
        await writeOrchestratorArtifacts({
          sessionId: chatSession,
          plan: plan({
            sessionId: chatSession,
            messageId: chatMessage,
            planId: "01ARZ3NDEKTSV4RRFFQ69G5FAX",
            mode: "chat",
            reasons: ["intent.chat"],
          }),
          features,
        })
        await writeOrchestratorArtifacts({
          sessionId: chatSession,
          plan: plan({
            sessionId: chatSession,
            messageId: chatMessage,
            planId: "01ARZ3NDEKTSV4RRFFQ69G5FAX",
            mode: "chat",
            reasons: ["intent.chat"],
          }),
          features,
        })

        const chatEvents = await EvidenceReader.readEvents(chatSession, { cursor: 0 })
        const chatPlanned = chatEvents.events.filter(
          (item) => item.type === "orchestrator.planned" && item.data?.["messageId"] === chatMessage,
        )
        expect(chatPlanned.every((item) => Number(item.data?.["rerunCount"] ?? 0) <= 1)).toBe(true)
        expect(chatPlanned.some((item) => item.data?.["stopReason"] === "max_rerun_exceeded")).toBe(false)

        const forkSession = "s-writer-fork-bounded"
        const forkMessage = "m-writer-fork-bounded"
        await writeOrchestratorArtifacts({
          sessionId: forkSession,
          plan: plan({
            sessionId: forkSession,
            messageId: forkMessage,
            planId: "01ARZ3NDEKTSV4RRFFQ69G5FAY",
            mode: "fork",
            reasons: ["intent.write_exec"],
          }),
          features,
        })
        await writeOrchestratorArtifacts({
          sessionId: forkSession,
          plan: plan({
            sessionId: forkSession,
            messageId: forkMessage,
            planId: "01ARZ3NDEKTSV4RRFFQ69G5FAY",
            mode: "fork",
            reasons: ["intent.write_exec"],
          }),
          features,
        })
        await writeOrchestratorArtifacts({
          sessionId: forkSession,
          plan: plan({
            sessionId: forkSession,
            messageId: forkMessage,
            planId: "01ARZ3NDEKTSV4RRFFQ69G5FAY",
            mode: "fork",
            reasons: ["intent.write_exec"],
          }),
          features,
        })

        const forkEvents = await EvidenceReader.readEvents(forkSession, { cursor: 0 })
        const forkPlanned = forkEvents.events.filter(
          (item) => item.type === "orchestrator.planned" && item.data?.["messageId"] === forkMessage,
        )
        expect(forkPlanned.every((item) => Number(item.data?.["rerunCount"] ?? 0) <= 1)).toBe(true)
        expect(forkPlanned.some((item) => item.data?.["stopReason"] === "max_rerun_exceeded")).toBe(false)
      },
    })
  })

  test("max rerun and adaptive degraded rows are deduped per message", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const sessionId = "s-writer-rerun-dedupe"
        const messageId = "m-writer-rerun-dedupe"
        const msgPlan = plan({
          sessionId,
          messageId,
          planId: "01ARZ3NDEKTSV4RRFFQ69G5FAZ",
          reasons: [
            "adaptive.ttc.max_rerun.stop",
            "adaptive.ttc.breaker.active",
            "adaptive.ttc.breaker.trip",
          ],
        })

        await writeOrchestratorArtifacts({ sessionId, plan: msgPlan, features })
        await writeOrchestratorArtifacts({ sessionId, plan: msgPlan, features })
        await writeOrchestratorArtifacts({ sessionId, plan: msgPlan, features })

        const events = await EvidenceReader.readEvents(sessionId, { cursor: 0 })
        const stopRows = events.events.filter(
          (item) => item.type === "orchestrator.planned" && item.data?.["messageId"] === messageId && item.data?.["stopReason"] === "max_rerun_exceeded",
        )
        const degradedRows = events.events.filter(
          (item) =>
            item.type === "orchestrator.degraded" &&
            item.data?.["messageId"] === messageId &&
            item.data?.["stage"] === "adaptive_ttc" &&
            String(item.data?.["reason"] ?? "").includes("adaptive.ttc.max_rerun.stop"),
        )

        expect(stopRows.length).toBeLessThanOrEqual(1)
        expect(degradedRows.length).toBeLessThanOrEqual(1)
      },
    })
  })
})
