import { describe, expect, test } from "bun:test"
import { LifecyclePayload, LifecyclePhase, OrchestratorEvent } from "../../src/session/orchestrator/event"

const base = {
  sessionID: "session-1",
  messageID: "message-1",
  planID: "plan-1",
  workerID: "evidence_critic",
  phase: "planned",
  attempt: 1,
} as const

describe("orchestrator event contract", () => {
  test("phase accepts planned/running/completed/degraded/skipped", () => {
    const phases = ["planned", "running", "completed", "degraded", "skipped"] as const
    for (const phase of phases) {
      expect(LifecyclePhase.parse(phase)).toBe(phase)
    }
  })

  test("phase rejects unknown value", () => {
    expect(() => LifecyclePhase.parse("unknown")).toThrow()
  })

  test("payload includes required lifecycle fields", () => {
    expect(LifecyclePayload.parse(base)).toMatchObject(base)
    expect(OrchestratorEvent.WorkerLifecycle.type).toBe("orchestrator.worker.lifecycle")
    expect(OrchestratorEvent.WorkerLifecycle.properties.parse(base)).toMatchObject(base)
  })

  test("rejects attempt below 1", () => {
    expect(() => LifecyclePayload.parse({ ...base, attempt: 0 })).toThrow()
  })

  test("rejects negative latencyMs", () => {
    expect(() => LifecyclePayload.parse({ ...base, latencyMs: -1 })).toThrow()
  })

  test("rejects invalid cache.status", () => {
    expect(() =>
      LifecyclePayload.parse({
        ...base,
        cache: {
          status: "bad",
          tier: "memory",
        },
      }),
    ).toThrow()
  })

  test("rejects invalid cache.tier", () => {
    expect(() =>
      LifecyclePayload.parse({
        ...base,
        cache: {
          status: "hit",
          tier: "bad",
        },
      }),
    ).toThrow()
  })

  test("rejects missing required field", () => {
    expect(() =>
      LifecyclePayload.parse({
        messageID: base.messageID,
        planID: base.planID,
        workerID: base.workerID,
        phase: base.phase,
        attempt: base.attempt,
      }),
    ).toThrow()
  })

  test("payload accepts route observability fields", () => {
    const parsed = LifecyclePayload.parse({
      ...base,
      fromModel: "openai/gpt-5",
      toModel: "openai/gpt-5-nano",
      gateReason: "timeout_degraded",
    })
    expect(parsed.fromModel).toBe("openai/gpt-5")
    expect(parsed.toModel).toBe("openai/gpt-5-nano")
    expect(parsed.gateReason).toBe("timeout_degraded")
  })
})
