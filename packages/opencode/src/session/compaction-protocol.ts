import z from "zod"
import { IsoDateTimeUtc, NonNegativeInt, Sha256 } from "@/protocol/shared"

const Threshold = z
  .object({
    specVersion: z.literal("compaction-thresholds/1.0"),
    soft: z.number().min(0).max(1),
    hard: z.number().min(0).max(1),
    emergency: z.number().min(0).max(1),
  })
  .strict()

export const CompactionTriggerLevel = z.enum(["soft", "hard", "emergency"])
export type CompactionTriggerLevel = z.infer<typeof CompactionTriggerLevel>

export const CompactionTrigger = z
  .object({
    specVersion: z.literal("compaction-trigger/1.0"),
    level: CompactionTriggerLevel,
    thresholds: Threshold,
    tokens: z
      .object({
        count: NonNegativeInt,
        usable: NonNegativeInt,
        ratio: z.number().min(0),
      })
      .strict(),
    limit: z
      .object({
        context: NonNegativeInt,
        input: NonNegativeInt.optional(),
        output: NonNegativeInt,
      })
      .strict(),
  })
  .strict()

export type CompactionTrigger = z.infer<typeof CompactionTrigger>

const Value = z.union([z.string(), z.number(), z.boolean(), z.null()])

const Fact = z
  .object({
    status: z.enum(["known", "unknown"]),
    value: Value.optional(),
  })
  .strict()

export const CompactionFacts = z
  .object({
    specVersion: z.literal("compaction-facts/1.0"),
    sessionId: z.string().min(1),
    compactionId: z.string().min(1),
    generatedAtUtc: IsoDateTimeUtc,
    facts: z.record(z.string().min(1), Fact),
  })
  .strict()

export type CompactionFacts = z.infer<typeof CompactionFacts>

export const CompactionInput = z
  .object({
    specVersion: z.literal("compaction-input/1.0"),
    sessionId: z.string().min(1),
    compactionId: z.string().min(1),
    probe_correlation_id: z.string().min(1),
    parentId: z.string().min(1),
    generatedAtUtc: IsoDateTimeUtc,
    trigger: CompactionTrigger.optional(),
    messageIds: z.array(z.string().min(1)),
    totals: z
      .object({
        messages: NonNegativeInt,
        textBytes: NonNegativeInt,
      })
      .strict(),
  })
  .strict()

export type CompactionInput = z.infer<typeof CompactionInput>

const Pointer = z
  .object({
    path: z.string().min(1),
    sha256: Sha256,
    kind: z.string().min(1),
  })
  .strict()

const Delta = z
  .object({
    added: z.array(z.string().min(1)),
    removed: z.array(z.string().min(1)),
    changed: z.array(z.string().min(1)),
  })
  .strict()

export const CompactionQuality = z
  .object({
    semantic_coverage: z.number().min(0).max(1),
    consistency_score: z.number().min(0).max(1),
    anchor_consistency_score: z.number().min(0).max(1),
    known_facts: NonNegativeInt,
    unknown_facts: NonNegativeInt,
    contradiction_count: NonNegativeInt,
    contradiction_rate: z.number().min(0).max(1),
    active_files_count: NonNegativeInt,
    next_steps_count: NonNegativeInt,
    reason_codes: z.array(z.string().regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/)),
  })
  .strict()

export type CompactionQuality = z.infer<typeof CompactionQuality>

export const CompactionViewSource = z.enum(["deterministic", "llm"])
export type CompactionViewSource = z.infer<typeof CompactionViewSource>

export const CompactionAssistedStatus = z.enum(["success", "degraded", "failed", "disabled"])
export type CompactionAssistedStatus = z.infer<typeof CompactionAssistedStatus>

export const CompactionReport = z
  .object({
    specVersion: z.literal("compaction-report/1.0"),
    sessionId: z.string().min(1),
    compactionId: z.string().min(1),
    probe_correlation_id: z.string().min(1),
    generatedAtUtc: IsoDateTimeUtc,
    previous: z
      .object({
        compactionId: z.string().min(1).optional(),
        contextPackId: z.string().min(1).optional(),
      })
      .strict(),
    delta: Delta,
    quality: CompactionQuality,
    reference_check: z
      .object({
        mode_resolved: z.enum(["strict", "normal", "unknown"]),
        confidence: z.number().min(0).max(1),
        reason_codes: z.array(z.string().regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/)),
      })
      .strict()
      .optional(),
    ui_view_source: CompactionViewSource,
    assisted_status: CompactionAssistedStatus,
    assisted_reason_code: z.string().min(1).nullable(),
    assisted_timeout_ms: NonNegativeInt,
    summary_format_version: z.string().min(1),
    artifacts: z
      .object({
        capsule: Pointer,
        facts: Pointer,
        input: Pointer,
        report: Pointer,
        errors: Pointer.array(),
      })
      .strict(),
  })
  .strict()

export type CompactionReport = z.infer<typeof CompactionReport>
