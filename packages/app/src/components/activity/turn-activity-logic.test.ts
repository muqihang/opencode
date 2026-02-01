import { describe, expect, test } from "bun:test"
import type { ActivityItem } from "@/lib/chronology/types"
import { clock, sliceTimeline, turnElapsedMs } from "./turn-activity-logic"

function item(id: string): ActivityItem {
  return {
    id,
    category: "tool",
    status: "done",
    title: id,
    summary: id,
    tsStart: "2026-02-01T00:00:00.000Z",
    tsEnd: "2026-02-01T00:00:00.000Z",
    events: [],
    traceId: undefined,
    messageId: "m",
  }
}

describe("turn-activity-logic", () => {
  test("sliceTimeline keeps head + tail with a gap marker when long", () => {
    const items = Array.from({ length: 10 }, (_, i) => item(String(i)))
    const sliced = sliceTimeline(items, { head: 5, tail: 2 })

    const ids = sliced
      .map((x) => (x.type === "item" ? x.item.id : `gap:${x.hidden}`))
      .join("|")

    expect(ids).toBe("0|1|2|3|4|gap:3|8|9")
  })

  test("sliceTimeline returns all items when short", () => {
    const items = Array.from({ length: 6 }, (_, i) => item(String(i)))
    const sliced = sliceTimeline(items, { head: 5, tail: 2 })
    expect(sliced.filter((x) => x.type === "gap")).toHaveLength(0)
    expect(sliced.map((x) => (x.type === "item" ? x.item.id : ""))).toEqual(["0", "1", "2", "3", "4", "5"])
  })

  test("clock formats mm:ss", () => {
    expect(clock(0)).toBe("00:00")
    expect(clock(65000)).toBe("01:05")
  })

  test("turnElapsedMs uses earliest start and latest end (or now when running)", () => {
    const done = [
      {
        ...item("a"),
        tsStart: "2026-02-01T00:00:00.000Z",
        tsEnd: "2026-02-01T00:00:02.000Z",
        status: "done" as const,
      },
    ]
    expect(turnElapsedMs(done, Date.parse("2026-02-01T00:00:10.000Z"))).toBe(2000)

    const running = [
      {
        ...item("a"),
        tsStart: "2026-02-01T00:00:00.000Z",
        status: "running" as const,
        tsEnd: undefined,
      },
    ]
    expect(turnElapsedMs(running, Date.parse("2026-02-01T00:00:05.000Z"))).toBe(5000)
  })

  test("selectHeadlineItem picks needs_attention > running > last", () => {
    const { selectHeadlineItem } = require("./turn-activity-logic")
    
    const i1 = { ...item("1"), status: "done" } as const
    const i2 = { ...item("2"), status: "running" } as const
    const i3 = { ...item("3"), status: "needs_attention" } as const
    
    // Priority: needs_attention
    expect(selectHeadlineItem([i1, i2, i3])?.id).toBe("3")
    
    // Priority: running
    expect(selectHeadlineItem([i1, i2])?.id).toBe("2")
    
    // Priority: last
    expect(selectHeadlineItem([i1])?.id).toBe("1")
    
    // Empty
    expect(selectHeadlineItem([])).toBeUndefined()
  })
})
