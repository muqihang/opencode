import z from "zod"
import { IsoDateTimeUtc, Sha256 } from "@/protocol/shared"

const Status = z.enum(["success", "degraded", "failed"])

export const CapsuleAssistedAnchor = z
  .object({
    path: z.string().min(1),
    sha256: Sha256,
    kind: z.enum(["file", "diff", "issue"]).default("file"),
    anchor: z.string().min(1).optional(),
  })
  .strict()

export type CapsuleAssistedAnchor = z.infer<typeof CapsuleAssistedAnchor>

export const CapsuleAssistedItem = z
  .object({
    type: z.enum(["decision", "question"]),
    status: z.enum(["known", "unknown"]),
    text: z.string().min(1),
    unknownReasonZh: z.string().min(1).optional(),
    evidenceIndices: z.array(z.number().int().nonnegative()),
  })
  .strict()

export type CapsuleAssistedItem = z.infer<typeof CapsuleAssistedItem>

export const CapsuleAssistedBudget = z
  .object({
    maxBytes: z.number().int().positive(),
    maxItems: z.number().int().positive(),
    maxAnchors: z.number().int().positive(),
  })
  .strict()

export type CapsuleAssistedBudget = z.infer<typeof CapsuleAssistedBudget>

export const CapsuleAssistedVersions = z
  .object({
    promptVersion: z.string().min(1),
    refVersion: z.string().min(1),
    verifierVersion: z.string().min(1),
  })
  .strict()

export type CapsuleAssistedVersions = z.infer<typeof CapsuleAssistedVersions>

export const CapsuleAssistedCoverage = z
  .object({
    known: z.number().int().nonnegative(),
    unknown: z.number().int().nonnegative(),
    anchors: z.number().int().nonnegative(),
  })
  .strict()

export type CapsuleAssistedCoverage = z.infer<typeof CapsuleAssistedCoverage>

export const CapsuleAssisted = z
  .object({
    specVersion: z.literal("capsule-assisted/1.0"),
    sessionId: z.string().min(1),
    compactionId: z.string().min(1),
    generatedAtUtc: IsoDateTimeUtc,
    model: z
      .object({
        providerID: z.string().min(1),
        modelID: z.string().min(1),
      })
      .strict(),

    status: Status,
    degradedReasonZh: z.string().min(1).optional(),

    budget: CapsuleAssistedBudget,
    versions: CapsuleAssistedVersions,

    anchors: z.array(CapsuleAssistedAnchor),
    items: z.array(CapsuleAssistedItem),

    coverage: CapsuleAssistedCoverage,
  })
  .strict()

export type CapsuleAssisted = z.infer<typeof CapsuleAssisted>

export const CapsuleAssistedInput = z
  .object({
    specVersion: z.literal("capsule-assisted-input/1.0"),
    sessionId: z.string().min(1),
    compactionId: z.string().min(1),
    generatedAtUtc: IsoDateTimeUtc,
    model: z
      .object({
        providerID: z.string().min(1),
        modelID: z.string().min(1),
      })
      .strict(),

    versions: CapsuleAssistedVersions,
    budget: CapsuleAssistedBudget,

    anchors: z.array(CapsuleAssistedAnchor),
    hintText: z.string().min(1),
  })
  .strict()

export type CapsuleAssistedInput = z.infer<typeof CapsuleAssistedInput>

export const CapsuleAssistedVerifyFailure = z
  .object({
    code: z.string().min(1),
    messageZh: z.string().min(1),
    evidencePath: z.string().min(1).optional(),
  })
  .strict()

export type CapsuleAssistedVerifyFailure = z.infer<typeof CapsuleAssistedVerifyFailure>

export const CapsuleAssistedVerify = z
  .object({
    specVersion: z.literal("capsule-assisted-verify/1.0"),
    sessionId: z.string().min(1),
    compactionId: z.string().min(1),
    verifiedAtUtc: IsoDateTimeUtc,
    ok: z.boolean(),
    status: Status,
    failures: z.array(CapsuleAssistedVerifyFailure),
    coverage: CapsuleAssistedCoverage,
    versions: CapsuleAssistedVersions,
  })
  .strict()

export type CapsuleAssistedVerify = z.infer<typeof CapsuleAssistedVerify>
