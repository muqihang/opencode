import { describe, expect, test } from "bun:test"
import { CapsuleHandoff, CapsuleSession } from "../../src/session/capsule-protocol"

describe("capsule-protocol", () => {
  test("parses minimal capsule session", () => {
    const parsed = CapsuleSession.parse({
      specVersion: "capsule-session/1.0",
      sessionId: "s1",
      generatedAtUtc: "2026-02-03T00:00:00.000Z",
      goal: { status: "unknown" },
      decisions: [],
      openQuestions: [],
      workingSet: { pointers: [] },
      notes: [],
    })
    expect(parsed.specVersion).toBe("capsule-session/1.0")
  })

  test("parses minimal capsule handoff", () => {
    const parsed = CapsuleHandoff.parse({
      specVersion: "capsule-handoff/1.0",
      childSessionId: "child_s1",
      generatedAtUtc: "2026-02-03T00:00:00.000Z",
      goal: { status: "unknown" },
      decisions: [],
      openQuestions: [],
      workingSet: { pointers: [] },
      notes: [],
    })
    expect(parsed.specVersion).toBe("capsule-handoff/1.0")
  })
})
