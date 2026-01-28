import z from "zod"
import { IsoDateTimeUtc } from "./shared"

// Protocol: event/1.0 (JSONL-friendly)
//
// Events are designed to be:
// - safe to render in a CLI/UI timeline (summary should be redacted)
// - structured for auditing (data can point to artifacts via refs/sha256)
// - stable enough for contract tests (strict + versioned)

export const EventSeverity = z.enum(["debug", "info", "warn", "error"])
export type EventSeverity = z.infer<typeof EventSeverity>

export const EventActor = z
  .string()
  .min(1)
  .regex(/^[a-z][a-z0-9_-]*:[^\s]+$/i, "Expected actor like 'tool:bash' or 'worker:worker_a_repo'")
export type EventActor = z.infer<typeof EventActor>

export const EventType = z
  .string()
  .min(1)
  .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/i, "Expected dotted event type like 'routing.started'")
export type EventType = z.infer<typeof EventType>

export const TraceId = z.string().regex(/^[0-9a-f]{32}$/i, "Expected 16-byte hex traceId (32 chars)")
export const SpanId = z.string().regex(/^[0-9a-f]{16}$/i, "Expected 8-byte hex spanId (16 chars)")

export const EventRedaction = z
  .object({
    applied: z.boolean(),
    policyVersion: z.string().min(1),
  })
  .strict()
export type EventRedaction = z.infer<typeof EventRedaction>

export const EventV1 = z
  .object({
    specVersion: z.literal("event/1.0"),
    ts: IsoDateTimeUtc,
    sessionId: z.string().min(1),
    traceId: TraceId.optional(),
    spanId: SpanId.optional(),
    severity: EventSeverity,
    actor: EventActor,
    type: EventType,
    summary: z.string().min(1),
    data: z.record(z.string(), z.unknown()).optional(),
    redaction: EventRedaction,
  })
  .strict()

export type EventV1 = z.infer<typeof EventV1>

