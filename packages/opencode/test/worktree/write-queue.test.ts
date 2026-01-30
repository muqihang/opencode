import { describe, expect, test } from "bun:test"
import { WorkdirWriteQueue } from "../../src/workdir/write-queue"

describe("workdir.write-queue", () => {
  test("serializes shared writes and emits events", async () => {
    const events: Array<{ type: string; sessionId: string; data?: Record<string, unknown> }> = []
    const writer = {
      event: async (input: { type: string; sessionId: string; data?: Record<string, unknown> }) => {
        events.push(input)
      },
    }

    const order: string[] = []
    const run1 = WorkdirWriteQueue.run({
      sessionId: "s1",
      targetDir: "/repo",
      reason: "merge",
      intentFiles: ["a.txt"],
      writer,
      work: async () => {
        order.push("start1")
        await new Promise((resolve) => setTimeout(resolve, 50))
        order.push("end1")
      },
    })
    const run2 = WorkdirWriteQueue.run({
      sessionId: "s2",
      targetDir: "/repo",
      reason: "merge",
      intentFiles: ["b.txt"],
      writer,
      work: async () => {
        order.push("start2")
        order.push("end2")
      },
    })

    await Promise.all([run1, run2])

    expect(order).toEqual(["start1", "end1", "start2", "end2"])
    const queued = events.filter((event) => event.type === "workdir.write_queued")
    const started = events.filter((event) => event.type === "workdir.write_started")
    const completed = events.filter((event) => event.type === "workdir.write_completed")
    expect(queued.length).toBe(2)
    expect(started.length).toBe(2)
    expect(completed.length).toBe(2)
    const firstStart = started[0]!
    const secondStart = started[1]!
    expect(firstStart.sessionId).toBe("s1")
    expect(secondStart.sessionId).toBe("s2")
  })
})
