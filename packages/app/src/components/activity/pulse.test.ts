import { describe, expect, test } from "bun:test"
import { getPulseMode } from "./pulse"
import type { ActivityItem } from "@/lib/chronology/types"

describe("getPulseMode", () => {
  const baseItem: ActivityItem = {
    id: "test",
    category: "other",
    status: "running",
    title: "Test Activity",
    summary: "",
    tsStart: new Date().toISOString(),
    events: [],
  }

  test("returns 'none' when no items are running", () => {
    const items = [{ ...baseItem, status: "done" } as ActivityItem]
    expect(getPulseMode(items, Date.now())).toBe("none")
  })

  test("returns 'breathing' for routing activity", () => {
    const now = Date.now()
    const items = [{ ...baseItem, category: "routing", status: "running", tsStart: new Date(now).toISOString() } as ActivityItem]
    expect(getPulseMode(items, now)).toBe("breathing")
  })

  test("returns 'flicker' for tool activity", () => {
    const now = Date.now()
    const items = [{ ...baseItem, category: "tool", status: "running", tsStart: new Date(now).toISOString() } as ActivityItem]
    expect(getPulseMode(items, now)).toBe("flicker")
  })

  test("returns 'flicker' for workbench activity", () => {
    const now = Date.now()
    const items = [{ ...baseItem, category: "workbench", status: "running", tsStart: new Date(now).toISOString() } as ActivityItem]
    expect(getPulseMode(items, now)).toBe("flicker")
  })

  test("returns 'arrhythmia' when running longer than 20s", () => {
    const now = Date.now()
    const startTime = new Date(now - 21000).toISOString() // 21 seconds ago
    const items = [{ ...baseItem, category: "tool", status: "running", tsStart: startTime } as ActivityItem]
    expect(getPulseMode(items, now)).toBe("arrhythmia")
  })

  test("priority: arrhythmia > breathing/flicker", () => {
    // Even if it's routing, if it's stuck, it should arrhythmia
    const now = Date.now()
    const startTime = new Date(now - 21000).toISOString()
    const items = [{ ...baseItem, category: "routing", status: "running", tsStart: startTime } as ActivityItem]
    expect(getPulseMode(items, now)).toBe("arrhythmia")
  })

  test("handles empty list", () => {
    expect(getPulseMode([], Date.now())).toBe("none")
  })
})
