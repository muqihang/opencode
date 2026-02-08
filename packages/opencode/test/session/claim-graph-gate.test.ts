import { describe, expect, test } from "bun:test"
import type { VerificationClaim, VerificationReason, VerificationReport } from "../../src/protocol/verification-report"
import { ClaimGraph } from "../../src/protocol/claim-graph"
import { buildClaimGraph, evaluateClaimGraphGate } from "../../src/verification/claim-graph"

const makeSummary = (claims: VerificationClaim[]) => ({
  totalClaims: claims.length,
  supported: claims.filter((claim) => claim.status === "supported").length,
  unsupported: claims.filter((claim) => claim.status === "unsupported").length,
  unknown: claims.filter((claim) => claim.status === "unknown").length,
})

const makeReport = (claims: VerificationClaim[], reasons: VerificationReason[] = []): VerificationReport => ({
  specVersion: "verification-report/1.0",
  verificationId: "00000000-0000-4000-8000-000000000000",
  mode: "strict",
  contextPackId: "ctx-claim-graph",
  ok: true,
  degraded: false,
  incomplete: false,
  summary: makeSummary(claims),
  reasons,
  claims,
})

describe("claim graph gate", () => {
  test("builds a valid claim graph from verification report", () => {
    const report = makeReport([{ id: "c1", status: "supported", evidence: [] }])
    const graph = buildClaimGraph(report)

    expect(ClaimGraph.parse(graph).specVersion).toBe("claim-graph/1.0")
    expect(graph.claims[0]?.status).toBe("supported")
  })

  test("degrades unknown-first when unsupported claims are non-high-risk", () => {
    const report = makeReport([
      { id: "c1", status: "unsupported", evidence: [], reasons: ["证据文件缺失"] },
      { id: "c2", status: "unknown", evidence: [] },
    ])

    const gate = evaluateClaimGraphGate(buildClaimGraph(report))

    expect(gate.verdict).toBe("degrade")
    expect(gate.reasons.some((item) => item.code === "unsupported_unknown_first")).toBe(true)
  })

  test("blocks when unsupported claim is high risk", () => {
    const report = makeReport([
      { id: "c1", status: "unsupported", evidence: [], reasons: ["检测到高风险敏感信息"] },
    ])

    const gate = evaluateClaimGraphGate(buildClaimGraph(report))

    expect(gate.verdict).toBe("block")
    expect(gate.summary.unsupportedHighRisk).toBe(1)
    expect(gate.reasons.some((item) => item.code === "unsupported_high_risk")).toBe(true)
  })
})
