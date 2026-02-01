import { describe, expect, test } from "bun:test"
import type { ActivityItem } from "./types"
import { groupActivitiesByMessageId, latencyTier, shouldUpdateVisualHeadline, summarizeTurn } from "./selectors"

function item(overrides: Partial<ActivityItem>): ActivityItem {
  return {
    id: overrides.id ?? "id",
    category: overrides.category ?? "tool",
    status: overrides.status ?? "done",
    title: overrides.title ?? "t",
    summary: overrides.summary ?? "s",
    tsStart: overrides.tsStart ?? "2026-02-01T00:00:00.000Z",
    tsEnd: overrides.tsEnd,
    events: overrides.events ?? [],
    traceId: overrides.traceId,
    messageId: overrides.messageId,
  }
}

describe("chronology.selectors", () => {
  test("groupActivitiesByMessageId buckets by messageId", () => {
    const list = [
      item({ id: "a", messageId: "m1" }),
      item({ id: "b", messageId: "m1" }),
      item({ id: "c", messageId: "m2" }),
      item({ id: "d" }),
    ]

    const groups = groupActivitiesByMessageId(list)
    expect(groups.get("m1")?.map((x) => x.id)).toEqual(["a", "b"])
    expect(groups.get("m2")?.map((x) => x.id)).toEqual(["c"])
    expect(groups.has("")).toBe(false)
  })

  test("summarizeTurn returns counts + status", () => {
    const list = [
      item({ category: "tool", status: "done", tsStart: "2026-02-01T00:00:00.000Z" }),
      item({ category: "workbench", status: "done", tsStart: "2026-02-01T00:00:01.000Z" }),
    ]

    const s = summarizeTurn(list)
    expect(s.tool).toBe(1)
    expect(s.workbench).toBe(1)
    expect(s.routing).toBe(0)
    expect(s.cache).toBe(0)
    expect(s.other).toBe(0)
    expect(s.running).toBe(0)
    expect(s.failed).toBe(0)
    expect(s.status).toBe("done")
    expect(s.last?.category).toBe("workbench")
  })

  test("summarizeTurn marks needs_attention when any item failed/needs_attention", () => {
    const list = [
      item({ category: "tool", status: "done" }),
      item({ category: "tool", status: "failed" }),
    ]

    const s = summarizeTurn(list)
    expect(s.failed).toBe(1)
    expect(s.status).toBe("needs_attention")
  })

  test("shouldUpdateVisualHeadline enforces minimum dwell, with critical exceptions", () => {
    const prev = { kind: "tool", status: "running" } as const
    const done = { kind: "tool", status: "done" } as const
    const other = { kind: "routing", status: "running" } as const
    const attention = { kind: "tool", status: "needs_attention" } as const

    expect(shouldUpdateVisualHeadline(prev, done, 0)).toBe(true)
    expect(shouldUpdateVisualHeadline(prev, attention, 0)).toBe(true)
    expect(shouldUpdateVisualHeadline(prev, other, 100)).toBe(false)
    expect(shouldUpdateVisualHeadline(prev, other, 900)).toBe(true)
  })

  test("latencyTier splits elapsed time into tiers", () => {
    expect(latencyTier(0)).toBe("fresh")
    expect(latencyTier(2500)).toBe("long")
    expect(latencyTier(12000)).toBe("very_long")
  })
})
