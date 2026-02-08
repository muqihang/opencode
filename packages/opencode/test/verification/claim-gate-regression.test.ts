import { describe, expect, test } from "bun:test"
import type { VerificationClaim, VerificationReason, VerificationReport } from "../../src/protocol/verification-report"
import { gateVerificationResult } from "../../src/verification/claim-graph"

const makeSummary = (claims: VerificationClaim[]) => ({
  totalClaims: claims.length,
  supported: claims.filter((claim) => claim.status === "supported").length,
  unsupported: claims.filter((claim) => claim.status === "unsupported").length,
  unknown: claims.filter((claim) => claim.status === "unknown").length,
})

const makeReport = (claims: VerificationClaim[], reasons: VerificationReason[] = []): VerificationReport => ({
  specVersion: "verification-report/1.0",
  verificationId: "00000000-0000-4000-8000-000000000001",
  mode: "strict",
  contextPackId: "ctx-claim-gate",
  ok: true,
  degraded: false,
  incomplete: false,
  summary: makeSummary(claims),
  reasons,
  claims,
})

describe("claim gate regression", () => {
  test("unknown-first fallback degrades when report payload is invalid", () => {
    const result = gateVerificationResult({
      result: { ok: true, degraded: false, hint: "核验完成" },
      report: { specVersion: "verification-report/1.0", claims: "invalid" },
    })

    expect(result.ok).toBe(true)
    expect(result.degraded).toBe(true)
    expect(result.claimGate.verdict).toBe("degrade")
    expect(result.claimGate.reasons.some((item) => item.code === "claim_graph_unknown")).toBe(true)
  })

  test("high-risk unsupported claim is blocked by verification-side gate", () => {
    const report = makeReport([
      { id: "c-risk", status: "unsupported", evidence: [], reasons: ["该结论涉及高风险信息"] },
    ])

    const result = gateVerificationResult({
      result: { ok: true, degraded: false, hint: "核验完成" },
      report,
    })

    expect(result.ok).toBe(false)
    expect(result.claimGate.verdict).toBe("block")
    expect(result.claimGate.summary.unsupportedHighRisk).toBe(1)
  })
})
