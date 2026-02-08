import z from "zod"
import { PositiveInt } from "./shared"

export const DualPassFallback = z.enum(["draft", "unknown-first"])
export type DualPassFallback = z.infer<typeof DualPassFallback>

export const DualPassDraft = z
  .object({
    specVersion: z.literal("dual-pass/1.0"),
    stage: z.literal("draft"),
    text: z.string().min(1),
  })
  .strict()

export type DualPassDraft = z.infer<typeof DualPassDraft>

export const DualPassCriticVerdict = z.enum(["accept", "revise", "degrade"])
export type DualPassCriticVerdict = z.infer<typeof DualPassCriticVerdict>

export const DualPassCritic = z
  .object({
    specVersion: z.literal("dual-pass/1.0"),
    stage: z.literal("critic"),
    verdict: DualPassCriticVerdict,
    text: z.string().min(1).optional(),
    reason: z.string().min(1).optional(),
    fallback: DualPassFallback.optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.verdict !== "degrade") return
    if (input.reason) {
      if (!input.fallback) {
        ctx.addIssue({
          code: "custom",
          message: "fallback is required when verdict=degrade",
          path: ["fallback"],
        })
      }
      return
    }

    ctx.addIssue({
      code: "custom",
      message: "reason is required when verdict=degrade",
      path: ["reason"],
    })
    if (input.fallback) return
    ctx.addIssue({
      code: "custom",
      message: "fallback is required when verdict=degrade",
      path: ["fallback"],
    })
  })

export type DualPassCritic = z.infer<typeof DualPassCritic>

const DualPassFinalStage = z
  .object({
    specVersion: z.literal("dual-pass/1.0"),
    stage: z.literal("final"),
    text: z.string().min(1),
  })
  .strict()

const DualPassDegradeStage = z
  .object({
    specVersion: z.literal("dual-pass/1.0"),
    stage: z.literal("degrade"),
    text: z.string().min(1),
    degrade: z
      .object({
        from: z.literal("critic"),
        reason: z.string().min(1),
        fallback: DualPassFallback,
      })
      .strict(),
  })
  .strict()

export const DualPassFinal = z.discriminatedUnion("stage", [DualPassFinalStage, DualPassDegradeStage])

export type DualPassFinal = z.infer<typeof DualPassFinal>

export const DualPassPolicy = z
  .object({
    enabled: z.boolean(),
    criticTimeoutMs: PositiveInt,
    unknownFirst: z.string().min(1),
  })
  .strict()

export type DualPassPolicy = z.infer<typeof DualPassPolicy>
