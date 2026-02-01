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

  test("groups routing.started + routing.completed into one routing activity", () => {
    const events: EventV1[] = [
      {
        specVersion: "event/1.0",
        ts: "2026-02-01T00:00:00.000Z",
        sessionId: "ses_test",
        traceId: "t",
        severity: "info",
        actor: "routing",
        type: "routing.started",
        summary: "routing started",
        redaction: { applied: true, policyVersion: "v1" },
        data: { messageId: "message_1" },
      },
      {
        specVersion: "event/1.0",
        ts: "2026-02-01T00:00:01.000Z",
        sessionId: "ses_test",
        traceId: "t",
        severity: "info",
        actor: "routing",
        type: "routing.completed",
        summary: "routing completed",
        redaction: { applied: true, policyVersion: "v1" },
        data: { messageId: "message_1" },
      },
    ]

    const items = synthesize(events)
    expect(items).toHaveLength(1)
    expect(items[0]?.category).toBe("routing")
    expect(items[0]?.status).toBe("done")
    expect(items[0]?.tsStart).toBe(events[0]!.ts)
    expect(items[0]?.tsEnd).toBe(events[1]!.ts)
    expect(items[0]?.tsStart).not.toBe(items[0]?.tsEnd)
  })

  test("does not mis-classify sandbox/policy noise as tool or routing", () => {
    const events: EventV1[] = [
      {
        specVersion: "event/1.0",
        ts: "2026-02-01T00:00:00.000Z",
        sessionId: "ses_test",
        severity: "info",
        actor: "sandbox",
        type: "sandbox.backend_selected",
        summary: "sandbox backend selected",
        redaction: { applied: true, policyVersion: "v1" },
      },
      {
        specVersion: "event/1.0",
        ts: "2026-02-01T00:00:00.100Z",
        sessionId: "ses_test",
        severity: "info",
        actor: "policy",
        type: "policy.exec_evaluated",
        summary: "policy evaluated",
        redaction: { applied: true, policyVersion: "v1" },
      },
    ]

    const items = synthesize(events)
    expect(items).toHaveLength(2)
    expect(items[0]?.category).toBe("other")
    expect(items[1]?.category).toBe("other")
  })

  test("keeps milestone events visible (not swallowed)", () => {
    const events: EventV1[] = [
      {
        specVersion: "event/1.0",
        ts: "2026-02-01T00:00:00.000Z",
        sessionId: "ses_test",
        severity: "info",
        actor: "worktree",
        type: "worktree.merge_started",
        summary: "merge started",
        redaction: { applied: true, policyVersion: "v1" },
      },
      {
        specVersion: "event/1.0",
        ts: "2026-02-01T00:00:00.100Z",
        sessionId: "ses_test",
        severity: "info",
        actor: "evidence",
        type: "evidence.bundle_created",
        summary: "bundle created",
        redaction: { applied: true, policyVersion: "v1" },
      },
      {
        specVersion: "event/1.0",
        ts: "2026-02-01T00:00:00.200Z",
        sessionId: "ses_test",
        severity: "info",
        actor: "gate",
        type: "gate.completed",
        summary: "gate completed",
        redaction: { applied: true, policyVersion: "v1" },
      },
    ]

    const items = synthesize(events)
    expect(items).toHaveLength(3)
    expect(items[0]?.summary).toBe("merge started")
    expect(items[1]?.summary).toBe("bundle created")
    expect(items[2]?.summary).toBe("gate completed")
  })
})
