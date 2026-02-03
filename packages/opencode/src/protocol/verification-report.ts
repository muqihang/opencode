import z from "zod"
import { Sha256 } from "./shared"

export const VerificationMode = z.enum(["strict", "balanced", "loose"])
export type VerificationMode = z.infer<typeof VerificationMode>

const Pointer = z
  .object({
    path: z.string().min(1),
    sha256: Sha256.optional(),
    anchor: z.record(z.string(), z.unknown()).optional(),
    kind: z.string().min(1).optional(),
  })
  .strict()

const EvidenceItem = z
  .object({
    pointer: Pointer,
    status: z.string().min(1).optional(),
    tool: z.string().min(1).optional(),
    reasons: z.array(z.string().min(1)).optional(),
  })
  .strict()

const ClaimItem = z
  .object({
    id: z.string().min(1),
    text: z.string().min(1).optional(),
    status: z.enum(["supported", "unsupported", "unknown"]),
    evidence: z.array(EvidenceItem),
    reasons: z.array(z.string().min(1)).optional(),
  })
  .strict()

const Reason = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
  })
  .strict()

const Summary = z
  .object({
    totalClaims: z.number().int().nonnegative(),
    supported: z.number().int().nonnegative(),
    unsupported: z.number().int().nonnegative(),
    unknown: z.number().int().nonnegative(),
  })
  .strict()

const Retrieval = z
  .object({
    attempted: z.boolean(),
    pointers: z.array(Pointer),
    artifacts: z.array(z.string().min(1)),
  })
  .strict()

export const VerificationReport = z
  .object({
    specVersion: z.literal("verification-report/1.0"),
    verificationId: z.string().uuid(),
    mode: VerificationMode,
    contextPackId: z.string().min(1),
    ok: z.boolean(),
    degraded: z.boolean(),
    incomplete: z.boolean(),
    summary: Summary,
    reasons: z.array(Reason),
    claims: z.array(ClaimItem),
    retrieval: Retrieval.optional(),
  })
  .strict()

export type VerificationReport = z.infer<typeof VerificationReport>
export type VerificationClaim = z.infer<typeof ClaimItem>
export type VerificationReason = z.infer<typeof Reason>
export type VerificationEvidence = z.infer<typeof EvidenceItem>
export type VerificationPointer = z.infer<typeof Pointer>
