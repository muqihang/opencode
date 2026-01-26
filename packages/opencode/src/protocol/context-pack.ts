import z from "zod"
import { IsoDateTimeUtc, NonNegativeInt, PositiveInt, Sha256, Ulid } from "./shared"

export const ContextPackTokenEstimateMethod = z.enum(["provider", "tiktoken", "approx"])
export type ContextPackTokenEstimateMethod = z.infer<typeof ContextPackTokenEstimateMethod>

export const ContextPackLedgerMode = z.enum(["full", "delta"])
export type ContextPackLedgerMode = z.infer<typeof ContextPackLedgerMode>

export const ContextPackSegmentKind = z.enum([
  "capsule",
  "system",
  "tools",
  "files",
  "history_summary",
  "routing_capsule",
  "evidence_pointers",
])
export type ContextPackSegmentKind = z.infer<typeof ContextPackSegmentKind>

export const ContextPackSegmentPriority = z.enum(["p0", "p1", "p2"])
export type ContextPackSegmentPriority = z.infer<typeof ContextPackSegmentPriority>

export const ContextPackSourceKind = z.enum(["artifact", "file", "evidence"])
export type ContextPackSourceKind = z.infer<typeof ContextPackSourceKind>

const Source = z
  .object({
    kind: ContextPackSourceKind,
    ref: z.string().min(1),
    sha256: Sha256.optional(),
  })
  .strict()

const Segment = z
  .object({
    id: z.string().min(1),
    kind: ContextPackSegmentKind,
    priority: ContextPackSegmentPriority,
    tokenEstimate: NonNegativeInt,
    sources: Source.array(),
    preview: z.string().min(1).optional(),
  })
  .strict()

export const ContextPack = z
  .object({
    specVersion: z.literal("context-pack/1.0"),
    contextPackId: Ulid,
    sessionId: z.string().min(1),
    messageId: z.string().min(1),
    createdAtUtc: IsoDateTimeUtc,
    model: z
      .object({
        providerId: z.string().min(1),
        modelId: z.string().min(1),
      })
      .strict(),
    window: z
      .object({
        maxTokens: PositiveInt,
        budgetTokens: PositiveInt,
      })
      .strict()
      .superRefine((w, ctx) => {
        if (w.budgetTokens > w.maxTokens) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "window.budgetTokens must be <= window.maxTokens",
            path: ["budgetTokens"],
          })
        }
      }),
    tokenEstimate: z
      .object({
        method: ContextPackTokenEstimateMethod,
        version: z.string().min(1),
      })
      .strict(),
    versions: z
      .object({
        systemTemplate: z.string().min(1),
        toolsTemplate: z.string().min(1),
        capsuleSchema: z.string().min(1),
        stableJson: z.string().min(1),
      })
      .strict(),
    ledger: z
      .object({
        previousContextPackId: Ulid.optional(),
        mode: ContextPackLedgerMode,
        notes: z.string().min(1).optional(),
      })
      .strict(),
    segments: Segment.array(),
    totals: z
      .object({
        segments: NonNegativeInt,
        tokenEstimate: NonNegativeInt,
      })
      .strict(),
  })
  .strict()
  .superRefine((pack, ctx) => {
    if (pack.totals.segments !== pack.segments.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "totals.segments must equal segments.length",
        path: ["totals", "segments"],
      })
    }
  })

export type ContextPack = z.infer<typeof ContextPack>
