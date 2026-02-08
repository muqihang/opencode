import { describe, expect, test } from "bun:test"
import { formatWorkerHint, mergeWorkerTurn, readWorkerLifecycle, type WorkerTurn } from "./worker-status"

describe("worker status", () => {
  test("reads lifecycle event with canonical keys", () => {
    const event = readWorkerLifecycle({
      type: "orchestrator.worker.lifecycle",
      properties: {
        sessionID: "ses_1",
        messageID: "msg_1",
        workerID: "worker_1",
        phase: "running",
      },
    })
    expect(event).toEqual({
      sessionID: "ses_1",
      messageID: "msg_1",
      workerID: "worker_1",
      phase: "running",
    })
  })

  test("reads lifecycle event with legacy keys", () => {
    const event = readWorkerLifecycle({
      type: "orchestrator.worker.lifecycle",
      properties: {
        sessionId: "ses_2",
        messageId: "msg_2",
        workerId: "worker_2",
        phase: "completed",
      },
    })
    expect(event).toEqual({
      sessionID: "ses_2",
      messageID: "msg_2",
      workerID: "worker_2",
      phase: "completed",
    })
  })

  test("ignores unrelated event", () => {
    const event = readWorkerLifecycle({
      type: "message.updated",
      properties: {},
    })
    expect(event).toBeUndefined()
  })

  test("ignores lifecycle events without concrete message id", () => {
    const event = readWorkerLifecycle({
      type: "orchestrator.worker.lifecycle",
      properties: {
        sessionID: "ses_1",
        messageID: "unknown",
        workerID: "worker_1",
        phase: "running",
      },
    })
    expect(event).toBeUndefined()
  })

  test("aggregates running when a worker is active", () => {
    const turn = mergeWorkerTurn(undefined, {
      sessionID: "ses_1",
      messageID: "msg_1",
      workerID: "worker_1",
      phase: "planned",
    })
    expect(turn.triggered).toBe(true)
    expect(turn.phase).toBe("running")
  })

  test("aggregates degraded after running worker ends with degraded", () => {
    const step1 = mergeWorkerTurn(undefined, {
      sessionID: "ses_1",
      messageID: "msg_1",
      workerID: "worker_1",
      phase: "running",
    })
    const step2 = mergeWorkerTurn(step1, {
      sessionID: "ses_1",
      messageID: "msg_1",
      workerID: "worker_1",
      phase: "degraded",
    })
    expect(step2.phase).toBe("degraded")
  })

  test("aggregates completed when all workers are done", () => {
    const step1 = mergeWorkerTurn(undefined, {
      sessionID: "ses_1",
      messageID: "msg_1",
      workerID: "worker_1",
      phase: "completed",
    })
    const step2 = mergeWorkerTurn(step1, {
      sessionID: "ses_1",
      messageID: "msg_1",
      workerID: "worker_2",
      phase: "skipped",
    })
    expect(step2.phase).toBe("completed")
  })

  test("stays running while any worker is still running", () => {
    const base: WorkerTurn = {
      triggered: true,
      phase: "completed",
      workers: {
        worker_1: "completed",
      },
    }
    const turn = mergeWorkerTurn(base, {
      sessionID: "ses_1",
      messageID: "msg_1",
      workerID: "worker_2",
      phase: "running",
    })
    expect(turn.phase).toBe("running")
  })

  test("formats hint for each visible phase", () => {
    expect(formatWorkerHint({ triggered: true, phase: "running", workers: {} })).toContain("协助过程")
    expect(formatWorkerHint({ triggered: true, phase: "running", workers: {} })).toContain("进行中")
    expect(formatWorkerHint({ triggered: true, phase: "completed", workers: {} })).toContain("协助过程")
    expect(formatWorkerHint({ triggered: true, phase: "completed", workers: {} })).toContain("已完成")
    expect(formatWorkerHint({ triggered: true, phase: "degraded", workers: {} })).toContain("协助过程")
    expect(formatWorkerHint({ triggered: true, phase: "degraded", workers: {} })).toContain("已降级")
  })

  test("formats role level progress with user friendly labels", () => {
    const turn = mergeWorkerTurn(undefined, {
      sessionID: "ses_1",
      messageID: "msg_1",
      workerID: "retrieval_planner",
      phase: "running",
    })
    const text = formatWorkerHint(turn)
    expect(text).toContain("检索规划")
    expect(text).toContain("进行中")
  })

  test("formats no hint when turn has no worker events", () => {
    expect(formatWorkerHint(undefined)).toBeUndefined()
    expect(formatWorkerHint({ triggered: false, phase: "completed", workers: {} })).toBeUndefined()
  })
})
