import z from "zod"

export const ClaimGraphStatus = z.enum(["supported", "unsupported", "unknown"])
export type ClaimGraphStatus = z.infer<typeof ClaimGraphStatus>

export const ClaimGraphRisk = z.enum(["low", "high", "unknown"])
export type ClaimGraphRisk = z.infer<typeof ClaimGraphRisk>

const ClaimNode = z
  .object({
    id: z.string().min(1),
    status: ClaimGraphStatus,
    risk: ClaimGraphRisk,
    reasons: z.array(z.string().min(1)),
  })
  .strict()

const ClaimEdge = z
  .object({
    from: z.string().min(1),
    to: z.string().min(1),
    kind: z.enum(["depends_on", "supports"]),
  })
  .strict()

export const ClaimGraph = z
  .object({
    specVersion: z.literal("claim-graph/1.0"),
    policyVersion: z.string().min(1),
    claims: z.array(ClaimNode),
    edges: z.array(ClaimEdge),
  })
  .strict()

export type ClaimGraph = z.infer<typeof ClaimGraph>
export type ClaimNode = z.infer<typeof ClaimNode>
export type ClaimEdge = z.infer<typeof ClaimEdge>

const ClaimGateReason = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
  })
  .strict()

const ClaimGateSummary = z
  .object({
    totalClaims: z.number().int().nonnegative(),
    supported: z.number().int().nonnegative(),
    unsupported: z.number().int().nonnegative(),
    unknown: z.number().int().nonnegative(),
    unsupportedHighRisk: z.number().int().nonnegative(),
  })
  .strict()

export const ClaimGateVerdict = z.enum(["pass", "degrade", "block"])
export type ClaimGateVerdict = z.infer<typeof ClaimGateVerdict>

export const ClaimGateDecision = z
  .object({
    specVersion: z.literal("claim-gate/1.0"),
    policyVersion: z.string().min(1),
    verdict: ClaimGateVerdict,
    reasons: z.array(ClaimGateReason),
    summary: ClaimGateSummary,
  })
  .strict()

export type ClaimGateDecision = z.infer<typeof ClaimGateDecision>
export type ClaimGateReason = z.infer<typeof ClaimGateReason>
export type ClaimGateSummary = z.infer<typeof ClaimGateSummary>
