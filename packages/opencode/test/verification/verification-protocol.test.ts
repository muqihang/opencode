import { describe, expect, test } from "bun:test"
import { TaskFrame } from "../../src/protocol/task-frame"
import { VerificationReport } from "../../src/protocol/verification-report"

describe("verification.protocol", () => {
  test("parses minimal task-frame", () => {
    const data = {
      specVersion: "task-frame/1.0",
      sessionId: "sess-1",
      contextPackId: "ctx-1",
    }
    expect(TaskFrame.parse(data).sessionId).toBe("sess-1")
  })

  test("parses minimal verification report", () => {
    const data = {
      specVersion: "verification-report/1.0",
      verificationId: "00000000-0000-4000-8000-000000000000",
      mode: "strict",
      contextPackId: "ctx-1",
      ok: true,
      degraded: false,
      incomplete: false,
      summary: { totalClaims: 1, supported: 1, unsupported: 0, unknown: 0 },
      reasons: [],
      claims: [
        { id: "c1", status: "supported", evidence: [] },
      ],
    }
    expect(VerificationReport.parse(data).ok).toBe(true)
  })
})
