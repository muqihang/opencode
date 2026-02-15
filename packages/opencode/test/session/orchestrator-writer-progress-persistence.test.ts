import { describe, expect, test } from "bun:test"
import path from "path"
import { EvidenceReader } from "../../src/evidence/reader"
import { Instance } from "../../src/project/instance"
import { OrchestratorFeatures } from "../../src/protocol/orchestrator-features"
import { OrchestratorPlan } from "../../src/protocol/orchestrator-plan"
import { tmpdir } from "../fixture/fixture"

const loadWriter = async (tag: string) =>
  import(`../../src/session/orchestrator/writer.ts?${tag}`) as Promise<{
    writeOrchestratorArtifacts: (input: {
      sessionId: string
      plan: unknown
      features: unknown
    }) => Promise<void>
  }>

const plan = (input: {
  sessionId: string
  messageId: string
  planId: string
  reasons: string[]
}) =>
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
        model: "small" as const,
        budget: { timeoutMs: 8_000 },
      },
      {
        id: "evidence_critic",
        model: "small" as const,
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

const plannedRows = async (input: { sessionId: string; messageId: string }) => {
  const events = await EvidenceReader.readEvents(input.sessionId, { cursor: 0 })
  return events.events.filter((item) => item.type === "orchestrator.planned" && item.data?.["messageId"] === input.messageId)
}

const degradedRows = async (input: { sessionId: string; messageId: string }) => {
  const events = await EvidenceReader.readEvents(input.sessionId, { cursor: 0 })
  return events.events.filter(
    (item) =>
      item.type === "orchestrator.degraded" &&
      item.data?.["messageId"] === input.messageId &&
      item.data?.["stage"] === "adaptive_ttc" &&
      String(item.data?.["reason"] ?? "").includes("adaptive.ttc.max_rerun.stop"),
  )
}

describe("orchestrator writer progress persistence", () => {
  test("persists cycle/stop/degraded monotonic state across restart", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const sessionId = "s-writer-progress-persist"
        const cycleMessage = "m-cycle"
        const stopMessage = "m-stop"

        const writerA = await loadWriter(`a-${Date.now()}`)
        await writerA.writeOrchestratorArtifacts({
          sessionId,
          plan: plan({
            sessionId,
            messageId: cycleMessage,
            planId: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
            reasons: ["adaptive.ttc.default_2"],
          }),
          features,
        })

        const cycleFirstRows = await plannedRows({ sessionId, messageId: cycleMessage })
        const cycleFirst = Number(cycleFirstRows.at(-1)?.data?.["cycle"] ?? 0)
        expect(cycleFirst).toBeGreaterThan(0)

        const writerB = await loadWriter(`b-${Date.now()}`)
        await writerB.writeOrchestratorArtifacts({
          sessionId,
          plan: plan({
            sessionId,
            messageId: cycleMessage,
            planId: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
            reasons: ["adaptive.ttc.default_2"],
          }),
          features,
        })

        const cycleSecondRows = await plannedRows({ sessionId, messageId: cycleMessage })
        const cycleSecond = Number(cycleSecondRows.at(-1)?.data?.["cycle"] ?? 0)
        expect(cycleSecond).toBeGreaterThan(cycleFirst)

        const cycleSeq = cycleSecondRows
          .map((item) => Number(item.data?.["cycle"] ?? 0))
          .filter((item) => item > 0)
        expect(cycleSeq.every((item, idx, all) => idx === 0 || item >= all[idx - 1])).toBe(true)

        await writerB.writeOrchestratorArtifacts({
          sessionId,
          plan: plan({
            sessionId,
            messageId: stopMessage,
            planId: "01ARZ3NDEKTSV4RRFFQ69G5FA2",
            reasons: ["adaptive.ttc.max_rerun.stop", "adaptive.ttc.breaker.active"],
          }),
          features,
        })

        const writerC = await loadWriter(`c-${Date.now()}`)
        await writerC.writeOrchestratorArtifacts({
          sessionId,
          plan: plan({
            sessionId,
            messageId: stopMessage,
            planId: "01ARZ3NDEKTSV4RRFFQ69G5FA2",
            reasons: ["adaptive.ttc.max_rerun.stop", "adaptive.ttc.breaker.active"],
          }),
          features,
        })

        const stopRows = (await plannedRows({ sessionId, messageId: stopMessage })).filter(
          (item) => item.data?.["stopReason"] === "max_rerun_exceeded",
        )
        expect(stopRows.length).toBe(1)

        const progressFile = path.join(fixture.path, ".opencode", "context", sessionId, "orchestrator-progress.json")
        const progressText = await Bun.file(progressFile).text()
        const progress = JSON.parse(progressText) as {
          messages?: Record<string, { cycle?: number }>
        }
        const savedCycle = Number(progress.messages?.[cycleMessage]?.cycle ?? 0)
        expect(savedCycle).toBeGreaterThanOrEqual(cycleSecond)

        const degraded = await degradedRows({ sessionId, messageId: stopMessage })
        expect(degraded.length).toBe(1)
      },
    })
  })
})
