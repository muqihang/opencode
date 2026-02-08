import { describe, expect, test } from "bun:test"
import type { EventV1 } from "./types"
import { groupWorkerLifecycleByMessage, lifecycleEventV1, readWorkerLifecycle, workerBadge } from "./worker-lifecycle"

function event(input: {
  ts: string
  messageId?: string
  messageID?: string
  workerId?: string
  workerID?: string
  phase?: string
  attempt?: number
  type?: string
}): EventV1 {
  return {
    specVersion: "event/1.0",
    ts: input.ts,
    sessionId: "s",
    severity: "info",
    actor: "orchestrator:worker",
    type: input.type ?? "orchestrator.worker.lifecycle",
    summary: "worker lifecycle",
    data: {
      ...(input.messageId ? { messageId: input.messageId } : {}),
      ...(input.messageID ? { messageID: input.messageID } : {}),
      ...(input.workerId ? { workerId: input.workerId } : {}),
      ...(input.workerID ? { workerID: input.workerID } : {}),
      ...(input.phase ? { phase: input.phase } : {}),
      ...(input.attempt ? { attempt: input.attempt } : {}),
    },
    redaction: { applied: true, policyVersion: "v1" },
  }
}

describe("worker-lifecycle", () => {
  test("aggregates by message and tracks latest phase per worker attempt", () => {
    const events = [
      event({ ts: "2026-02-01T00:00:00.000Z", messageId: "m1", workerId: "a", phase: "planned", attempt: 1 }),
      event({ ts: "2026-02-01T00:00:01.000Z", messageId: "m1", workerId: "a", phase: "running", attempt: 1 }),
      event({ ts: "2026-02-01T00:00:02.000Z", messageId: "m1", workerId: "a", phase: "completed", attempt: 1 }),
      event({ ts: "2026-02-01T00:00:03.000Z", messageId: "m1", workerId: "b", phase: "planned", attempt: 1 }),
      event({ ts: "2026-02-01T00:00:04.000Z", messageId: "m1", workerId: "b", phase: "running", attempt: 1 }),
      event({ ts: "2026-02-01T00:00:05.000Z", messageId: "m1", workerId: "b", phase: "degraded", attempt: 1 }),
    ]

    const groups = groupWorkerLifecycleByMessage(events)
    const summary = groups.get("m1")

    expect(summary?.phase).toBe("degraded")
    expect(summary?.total).toBe(2)
    expect(summary?.workers).toBe(2)
    expect(summary?.counts).toEqual({
      planned: 0,
      running: 0,
      completed: 1,
      degraded: 1,
      skipped: 0,
    })
  })

  test("keeps running phase when worker has no terminal event", () => {
    const events = [
      event({ ts: "2026-02-01T00:00:00.000Z", messageId: "m2", workerId: "w", phase: "planned", attempt: 1 }),
      event({ ts: "2026-02-01T00:00:01.000Z", messageId: "m2", workerId: "w", phase: "running", attempt: 1 }),
    ]

    const summary = groupWorkerLifecycleByMessage(events).get("m2")

    expect(summary?.phase).toBe("running")
    expect(summary?.counts.running).toBe(1)
    expect(summary?.counts.completed).toBe(0)
    expect(summary?.counts.degraded).toBe(0)
  })

  test("supports messageID/workerID fields and skipped phase", () => {
    const events = [event({ ts: "2026-02-01T00:00:00.000Z", messageID: "m3", workerID: "u", phase: "skipped", attempt: 1 })]
    const summary = groupWorkerLifecycleByMessage(events).get("m3")

    expect(summary?.phase).toBe("skipped")
    expect(summary?.total).toBe(1)
    expect(summary?.counts.skipped).toBe(1)
  })

  test("ignores non lifecycle and malformed lifecycle events", () => {
    const events = [
      event({ ts: "2026-02-01T00:00:00.000Z", messageId: "m4", workerId: "a", phase: "planned" }),
      event({ ts: "2026-02-01T00:00:01.000Z", messageId: "m4", workerId: "a", phase: "unknown" }),
      event({ ts: "2026-02-01T00:00:02.000Z", messageId: "m4", workerId: "a", phase: "completed", type: "routing.completed" }),
    ]

    const summary = groupWorkerLifecycleByMessage(events).get("m4")

    expect(summary?.phase).toBe("planned")
    expect(summary?.counts).toEqual({
      planned: 1,
      running: 0,
      completed: 0,
      degraded: 0,
      skipped: 0,
    })
  })

  test("workerBadge includes required main copy and phase/count", () => {
    const summary = groupWorkerLifecycleByMessage([
      event({ ts: "2026-02-01T00:00:00.000Z", messageId: "m5", workerId: "x", phase: "running" }),
      event({ ts: "2026-02-01T00:00:01.000Z", messageId: "m5", workerId: "y", phase: "completed" }),
      event({ ts: "2026-02-01T00:00:02.000Z", messageId: "m5", workerId: "z", phase: "degraded" }),
    ]).get("m5")

    expect(summary).toBeDefined()

    const badge = workerBadge(summary!)
    expect(badge.text.includes("协助过程")).toBe(true)
    expect(badge.phase).toBe("已降级（继续回答）")
    expect(badge.counts).toContain("进行中 1")
    expect(badge.counts).toContain("已完成 1")
    expect(badge.counts).toContain("已降级 1")
  })

  test("workerBadge exposes user friendly role progress", () => {
    const summary = groupWorkerLifecycleByMessage([
      event({ ts: "2026-02-01T00:00:00.000Z", messageId: "m6", workerId: "retrieval_planner", phase: "running" }),
      event({ ts: "2026-02-01T00:00:01.000Z", messageId: "m6", workerId: "patch_planner", phase: "completed" }),
      event({ ts: "2026-02-01T00:00:02.000Z", messageId: "m6", workerId: "evidence_critic", phase: "planned" }),
    ]).get("m6")

    expect(summary).toBeDefined()
    const badge = workerBadge(summary!)
    expect(badge.roles).toContain("检索规划：进行中")
    expect(badge.roles).toContain("修改规划：已完成")
    expect(badge.roles).toContain("证据审查：已启动")
  })

  test("readWorkerLifecycle keeps safe reason code and no model routing fields", () => {
    const parsed = readWorkerLifecycle({
      type: "orchestrator.worker.lifecycle",
      properties: {
        sessionID: "s3",
        messageID: "m3",
        workerID: "w3",
        phase: "degraded",
        reason: "worker_degraded",
      },
    })

    expect(parsed).toEqual({
      sessionID: "s3",
      messageID: "m3",
      workerID: "w3",
      phase: "degraded",
      attempt: 1,
      reason: "worker_degraded",
    })
  })

  test("readWorkerLifecycle parses canonical and legacy payloads", () => {
    const canonical = readWorkerLifecycle({
      type: "orchestrator.worker.lifecycle",
      properties: {
        sessionID: "s1",
        messageID: "m1",
        workerID: "w1",
        phase: "running",
        attempt: 2,
      },
    })

    expect(canonical).toEqual({
      sessionID: "s1",
      messageID: "m1",
      workerID: "w1",
      phase: "running",
      attempt: 2,
    })

    const legacy = readWorkerLifecycle({
      type: "orchestrator.worker.lifecycle",
      properties: {
        sessionId: "s2",
        messageId: "m2",
        workerId: "w2",
        phase: "completed",
      },
    })

    expect(legacy).toEqual({
      sessionID: "s2",
      messageID: "m2",
      workerID: "w2",
      phase: "completed",
      attempt: 1,
    })
  })

  test("lifecycleEventV1 creates evidence-like event for live lifecycle updates", () => {
    const out = lifecycleEventV1(
      {
        sessionID: "s-live",
        messageID: "m-live",
        workerID: "w-live",
        phase: "degraded",
        attempt: 3,
      },
      "2026-02-02T00:00:00.000Z",
    )

    expect(out.type).toBe("orchestrator.worker.lifecycle")
    expect(out.sessionId).toBe("s-live")
    expect(out.data?.messageID).toBe("m-live")
    expect(out.data?.workerID).toBe("w-live")
    expect(out.data?.phase).toBe("degraded")
    expect(out.data?.attempt).toBe(3)
  })
})
