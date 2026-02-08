import {
  ClaimGraph,
  ClaimGateDecision,
  type ClaimGateReason,
  type ClaimGateDecision as ClaimGateDecisionType,
  type ClaimGateSummary,
  type ClaimGraphRisk,
} from "@/protocol/claim-graph"
import { type VerificationClaim, type VerificationReport, VerificationReport as VerificationReportSchema } from "@/protocol/verification-report"

const highRiskCodes = new Set(["redaction_high", "unsupported_high_risk"])
const highRiskTokens = ["高风险", "敏感", "pii", "secret", "credential", "token", "ssn", "泄露"]

const reason = (code: string, message: string): ClaimGateReason => ({ code, message })

const isHighRiskText = (text: string) => {
  const lower = text.toLowerCase()
  return highRiskTokens.some((token) => lower.includes(token))
}

const hasReportHighRisk = (report: VerificationReport) => {
  const codeHit = report.reasons.some((item) => highRiskCodes.has(item.code))
  if (codeHit) return true
  return report.reasons.some((item) => isHighRiskText(item.message))
}

const claimRisk = (input: { claim: VerificationClaim; reportHighRisk: boolean }): ClaimGraphRisk => {
  if (input.claim.status === "unknown") return "unknown"
  if (input.claim.status !== "unsupported") return "low"
  const claimReasons = input.claim.reasons ?? []
  const high = claimReasons.some((item) => isHighRiskText(item)) || input.reportHighRisk
  if (high) return "high"
  return "low"
}

const emptySummary = (): ClaimGateSummary => ({
  totalClaims: 0,
  supported: 0,
  unsupported: 0,
  unknown: 0,
  unsupportedHighRisk: 0,
})

const mergeHint = (hint: string, reasons: ClaimGateReason[]) => {
  const list = [hint, ...reasons.map((item) => item.message)].map((item) => item.trim()).filter(Boolean)
  const unique = Array.from(new Set(list))
  return unique.join("；")
}

export const buildClaimGraph = (report: VerificationReport) => {
  const reportHighRisk = hasReportHighRisk(report)
  return ClaimGraph.parse({
    specVersion: "claim-graph/1.0",
    policyVersion: "v1",
    claims: report.claims.map((claim) => ({
      id: claim.id,
      status: claim.status,
      risk: claimRisk({ claim, reportHighRisk }),
      reasons: claim.reasons ?? [],
    })),
    edges: [],
  })
}

export const evaluateClaimGraphGate = (graph: ClaimGraph) => {
  const summary = graph.claims.reduce<ClaimGateSummary>(
    (acc, claim) => ({
      totalClaims: acc.totalClaims + 1,
      supported: acc.supported + Number(claim.status === "supported"),
      unsupported: acc.unsupported + Number(claim.status === "unsupported"),
      unknown: acc.unknown + Number(claim.status === "unknown"),
      unsupportedHighRisk: acc.unsupportedHighRisk + Number(claim.status === "unsupported" && claim.risk === "high"),
    }),
    emptySummary(),
  )

  if (summary.unsupportedHighRisk > 0) {
    return ClaimGateDecision.parse({
      specVersion: "claim-gate/1.0",
      policyVersion: "v1",
      verdict: "block",
      reasons: [reason("unsupported_high_risk", "存在高风险 unsupported claim，必须阻断")],
      summary,
    })
  }

  if (summary.unsupported > 0 || summary.unknown > 0) {
    const reasons = [
      ...(summary.unsupported > 0
        ? [reason("unsupported_unknown_first", "存在 unsupported claim，按 unknown-first 语义降级")]
        : []),
      ...(summary.unknown > 0 ? [reason("claim_unknown", "存在 unknown claim，按 unknown-first 语义降级")] : []),
    ]
    return ClaimGateDecision.parse({
      specVersion: "claim-gate/1.0",
      policyVersion: "v1",
      verdict: "degrade",
      reasons,
      summary,
    })
  }

  return ClaimGateDecision.parse({
    specVersion: "claim-gate/1.0",
    policyVersion: "v1",
    verdict: "pass",
    reasons: [],
    summary,
  })
}

export const unknownFirstClaimGate = (message = "claim graph 不可用，按 unknown-first 回退降级") =>
  ClaimGateDecision.parse({
    specVersion: "claim-gate/1.0",
    policyVersion: "v1",
    verdict: "degrade",
    reasons: [reason("claim_graph_unknown", message)],
    summary: emptySummary(),
  })

type BaseResult = {
  ok: boolean
  degraded: boolean
  hint: string
}

type GateResult = BaseResult & {
  claimGate: ClaimGateDecisionType
}

export const applyClaimGateResult = (input: { result: BaseResult; gate: ClaimGateDecisionType }): GateResult => {
  const hint = mergeHint(input.result.hint, input.gate.reasons)
  if (input.gate.verdict === "block") {
    return {
      ok: false,
      degraded: input.result.degraded,
      hint,
      claimGate: input.gate,
    }
  }

  if (input.gate.verdict === "degrade") {
    return {
      ok: input.result.ok,
      degraded: true,
      hint,
      claimGate: input.gate,
    }
  }

  return {
    ok: input.result.ok,
    degraded: input.result.degraded,
    hint,
    claimGate: input.gate,
  }
}

export const gateVerificationResult = (input: { result: BaseResult; report: unknown }): GateResult => {
  const parsed = VerificationReportSchema.safeParse(input.report)
  if (!parsed.success) {
    const gate = unknownFirstClaimGate()
    return applyClaimGateResult({ result: input.result, gate })
  }
  const gate = evaluateClaimGraphGate(buildClaimGraph(parsed.data))
  return applyClaimGateResult({ result: input.result, gate })
}
