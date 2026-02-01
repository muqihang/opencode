import { describe, expect, test } from "bun:test"
import { matchMessageId } from "./activity-card"
import type { ActivityItem } from "@/lib/chronology/types"

describe("activity-card", () => {
  const baseItem: ActivityItem = {
    id: "test",
    category: "other",
    status: "done",
    title: "Test",
    summary: "",
    tsStart: new Date().toISOString(),
    events: [],
  }

  test("returns false when highlight is missing", () => {
    expect(matchMessageId(undefined, { ...baseItem, messageId: "message_1" })).toBe(false)
  })

  test("returns false when item has no messageId", () => {
    expect(matchMessageId("message_1", baseItem)).toBe(false)
  })

  test("returns true when ids match", () => {
    expect(matchMessageId("message_1", { ...baseItem, messageId: "message_1" })).toBe(true)
  })
})
