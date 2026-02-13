import z from "zod"

const PositiveInt = z.number().int().positive()

export const EvidenceBundlePointerV2 = z
  .object({
    path: z.string().min(1),
    sha256: z.string().min(1),
    anchor: z.record(z.string(), z.number()).optional(),
  })
  .strict()

export type EvidenceBundlePointerV2 = z.infer<typeof EvidenceBundlePointerV2>

export const EvidenceBundleOriginV2 = z
  .object({
    path: z.string().min(1).optional(),
    lineStart: PositiveInt.optional(),
    lineEnd: PositiveInt.optional(),
    inputId: z.string().min(1).optional(),
    kind: z.string().min(1).optional(),
  })
  .strict()

export type EvidenceBundleOriginV2 = z.infer<typeof EvidenceBundleOriginV2>

export const EvidenceBundleSourceV2 = z.enum(["lsp", "rg", "workbench", "tree"])
export type EvidenceBundleSourceV2 = z.infer<typeof EvidenceBundleSourceV2>

export const EvidenceBundleHitV2 = z
  .object({
    id: z.string().min(1),
    pointer: EvidenceBundlePointerV2,
    origin: EvidenceBundleOriginV2,
    snippet: z.string(),
    source: EvidenceBundleSourceV2,
    score_bps: z.number().int().nonnegative(),
    densityScore: z.number().min(0).max(1),
  })
  .strict()

export type EvidenceBundleHitV2 = z.infer<typeof EvidenceBundleHitV2>

export const EvidenceBundleRerankFallbackV2 = z
  .object({
    condition: z.literal("density_missing_or_invalid"),
    triggered: z.boolean(),
    reason: z.string().min(1),
  })
  .strict()

export type EvidenceBundleRerankFallbackV2 = z.infer<typeof EvidenceBundleRerankFallbackV2>

export const EvidenceBundleRerankV2 = z
  .object({
    mode: z.enum(["density_first", "score_only"]),
    fallback: EvidenceBundleRerankFallbackV2,
  })
  .strict()

export type EvidenceBundleRerankV2 = z.infer<typeof EvidenceBundleRerankV2>

export const EvidenceBundleSummaryV2 = z
  .object({
    total: z.number().int().nonnegative(),
    code: z.number().int().nonnegative(),
    workbench: z.number().int().nonnegative(),
  })
  .strict()

export type EvidenceBundleSummaryV2 = z.infer<typeof EvidenceBundleSummaryV2>

export const EvidenceBundleV2 = z
  .object({
    specVersion: z.literal("evidence-bundle/2.0"),
    retrievalId: z.string().min(1),
    summary: EvidenceBundleSummaryV2,
    hits: z.array(EvidenceBundleHitV2),
    topEvidence: z.array(z.string().min(1)),
    dedupe: z
      .object({
        method: z.string().min(1),
        report: z.string().min(1),
      })
      .strict(),
    rerank: EvidenceBundleRerankV2,
  })
  .strict()

export type EvidenceBundleV2 = z.infer<typeof EvidenceBundleV2>

export const EvidenceBundleCompatV2 = z
  .object({
    v1TopK: z.number().int().nonnegative(),
    v2TopEvidence: z.number().int().nonnegative(),
    v1Total: z.number().int().nonnegative(),
    v2Total: z.number().int().nonnegative(),
    densityMean: z.number().min(0).max(1),
    densityPass: z.number().int().nonnegative(),
    densityThreshold: z.number().min(0).max(1),
  })
  .strict()

export type EvidenceBundleCompatV2 = z.infer<typeof EvidenceBundleCompatV2>
