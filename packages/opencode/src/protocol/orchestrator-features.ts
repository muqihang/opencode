import z from "zod"
import { PositiveInt } from "./shared"
import { OrchestratorUxMode } from "./orchestrator-plan"

const Features = z
  .object({
    uxMode: OrchestratorUxMode,
    intentBytes: PositiveInt,
    intentTokensEstimate: PositiveInt,
    hasFileParts: z.boolean(),
    hasWriteIntent: z.boolean(),
    hasExecIntent: z.boolean(),
    hasVerificationIntent: z.boolean(),
    parentSessionId: z.string().min(1).optional(),
  })
  .strict()

export const OrchestratorFeatures = z
  .object({
    specVersion: z.literal("orchestrator-features/1.0"),
    features: Features,
  })
  .strict()

export type OrchestratorFeatures = z.infer<typeof OrchestratorFeatures>
