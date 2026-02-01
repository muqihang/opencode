import { describe, expect, test } from "bun:test"
import { synthesize } from "./engine"
import type { EventV1 } from "./types"

describe("chronology.engine", () => {
  test("groups tool.started and tool.completed into one activity", () => {
    const events: EventV1[] = [
      {
        specVersion: "event/1.0",
        ts: "2026-01-31T00:00:00.000Z",
        sessionId: "ses_test",
        severity: "info",
        actor: "tool:bash",
        type: "tool.started",
        summary: "started",
        redaction: { applied: true, policyVersion: "v1" },
      },
      {
        specVersion: "event/1.0",
        ts: "2026-01-31T00:00:01.000Z",
        sessionId: "ses_test",
        severity: "info",
        actor: "tool:bash",
        type: "tool.completed",
        summary: "completed",
        redaction: { applied: true, policyVersion: "v1" },
      },
    ]

    const items = synthesize(events)
    expect(items).toHaveLength(1)
    expect(items[0]?.status).toBe("done")
    expect(items[0]?.category).toBe("tool")
  })

  test("keeps tool.started without completion as running", () => {
    const events: EventV1[] = [
      {
        specVersion: "event/1.0",
        ts: "2026-01-31T00:00:00.000Z",
        sessionId: "ses_test",
        severity: "info",
        actor: "tool:bash",
        type: "tool.started",
        summary: "started",
        redaction: { applied: true, policyVersion: "v1" },
      },
    ]

    const items = synthesize(events)
    expect(items).toHaveLength(1)
    expect(items[0]?.status).toBe("running")
  })

  test("propagates traceId + messageId onto ActivityItem", () => {
    const events: EventV1[] = [
      {
        specVersion: "event/1.0",
        ts: "2026-02-01T00:00:00.000Z",
        sessionId: "ses_test",
        traceId: "0123456789abcdef0123456789abcdef",
        severity: "info",
        actor: "tool:bash",
        type: "tool.started",
        summary: "started",
        data: { messageId: "message_123" },
        redaction: { applied: true, policyVersion: "v1" },
      },
    ]
    const items = synthesize(events)
    expect(items[0]?.traceId).toBe("0123456789abcdef0123456789abcdef")
    expect(items[0]?.messageId).toBe("message_123")
  })
})
