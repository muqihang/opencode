import { describe, expect, test } from "bun:test"
import { verifyEvidenceChain } from "../../src/evidence/chain"
import { buildTurnGateEventData, replayTurnGateEvent } from "../../src/evidence/events"
import { EventV1 } from "../../src/protocol/event"

const baseEvent = (data: Record<string, unknown>) =>
  EventV1.parse({
    specVersion: "event/1.0",
    ts: "2026-02-08T00:00:00.000Z",
    sessionId: "session-a1",
    severity: "warn",
    actor: "orchestrator:processor",
    type: "turn.gate",
    summary: "turn gate degraded",
    data,
    redaction: { applied: true, policyVersion: "v1" },
  })

describe("dual pass citation integrity", () => {
  test("evidence chain reads citation pointers from turn gate events", () => {
    const clean = "a".repeat(64)
    const broken = "b".repeat(64)
    const good = ".opencode/artifacts/s1/verification/verification.report.json"
    const missing = ".opencode/artifacts/s1/verification/missing.report.json"

    const event = baseEvent(
      buildTurnGateEventData({
        messageId: "m-1",
        mode: "strict",
        claimGate: {
          status: "degrade",
          action: "unknown_first",
          reasons: ["citations_required"],
        },
        dualPass: {
          enabled: true,
          attempted: true,
          fallback: true,
          reason: "citations_required",
        },
        citations: [
          { ref: good, sha256: clean },
          { ref: missing, sha256: broken },
        ],
      }),
    )

    const result = verifyEvidenceChain({
      entries: [{ path: good, kind: "verification-report", sha256: clean }],
      existing: [good],
      hashes: { [good]: clean },
      events: [event],
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.missing).toContain(missing)
  })

  test("evidence chain detects citation sha contamination from turn gate events", () => {
    const expected = "c".repeat(64)
    const wrong = "d".repeat(64)
    const report = ".opencode/artifacts/s2/verification/verification.report.json"

    const event = baseEvent(
      buildTurnGateEventData({
        messageId: "m-2",
        mode: "balanced",
        claimGate: {
          status: "degrade",
          action: "unknown_first",
          reasons: ["citations_required"],
        },
        dualPass: {
          enabled: true,
          attempted: true,
          fallback: true,
          reason: "critic_timeout",
        },
        citations: [{ ref: report, sha256: wrong }],
      }),
    )

    const result = verifyEvidenceChain({
      entries: [{ path: report, kind: "verification-report", sha256: expected }],
      existing: [report],
      hashes: { [report]: expected },
      events: [event],
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.contaminated).toContain(report)
  })

  test("turn gate replay exposes claim decision and dual pass fallback", () => {
    const report = ".opencode/artifacts/s3/verification/verification.report.json"
    const event = baseEvent(
      buildTurnGateEventData({
        messageId: "m-3",
        mode: "strict",
        claimGate: {
          status: "degrade",
          action: "unknown_first",
          reasons: ["citations_required", "high_risk"],
        },
        dualPass: {
          enabled: true,
          attempted: true,
          fallback: true,
          reason: "second_pass_failed",
        },
        citations: [{ ref: report }],
      }),
    )

    const replay = replayTurnGateEvent(event)
    expect(replay).toBeDefined()
    expect(replay?.claimGate.status).toBe("degrade")
    expect(replay?.dualPass.fallback).toBe(true)
    expect(replay?.citations.map((item) => item.ref)).toContain(report)
  })
})
