import z from "zod"
import { PositiveInt, Sha256, Ulid } from "./shared"

export const OrchestratorMode = z.enum(["chat", "assist", "heavy", "fork"])
export type OrchestratorMode = z.infer<typeof OrchestratorMode>

export const OrchestratorUxMode = z.enum(["fast", "auto", "deep"])
export type OrchestratorUxMode = z.infer<typeof OrchestratorUxMode>

const Worker = z
  .object({
    id: z.string().min(1),
    model: z.literal("small"),
    budget: z
      .object({
        timeoutMs: PositiveInt,
      })
      .strict(),
  })
  .strict()

const EvidencePolicy = z
  .object({
    enabled: z.boolean(),
    mode: z.enum(["strict", "balanced", "loose"]),
  })
  .strict()

const ToolPolicy = z
  .object({
    allowed: z.array(z.string().min(1)),
    bounceMax: z.literal(1),
  })
  .strict()

const Reason = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
  })
  .strict()

export const OrchestratorPlan = z
  .object({
    specVersion: z.literal("orchestrator-plan/1.0"),
    orchestratorPlanId: Ulid,
    sessionId: z.string().min(1),
    messageId: z.string().min(1),
    orchestratorMode: OrchestratorMode,
    uxMode: OrchestratorUxMode,
    mainTools: z.union([z.null(), z.array(z.string().min(1))]).optional(),
    workers: z.array(Worker),
    budgets: z
      .object({
        maxWallClockMs: PositiveInt,
        workerTimeoutMs: PositiveInt,
        maxOutputTokens: PositiveInt,
        maxToolCalls: PositiveInt,
      })
      .strict(),
    evidencePolicy: EvidencePolicy.optional(),
    toolPolicy: ToolPolicy,
    reasons: z.array(Reason),
    inputsFingerprint: z
      .object({
        sha256: Sha256,
      })
      .strict(),
  })
  .strict()

export type OrchestratorPlan = z.infer<typeof OrchestratorPlan>
