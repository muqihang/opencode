import z from "zod"
import { IsoDateTimeUtc, Sha256 } from "@/protocol/shared"

const Json = z.union([z.string(), z.number(), z.boolean(), z.null()])

export const CapsuleValue = z
  .discriminatedUnion("status", [
    z
      .object({
        status: z.literal("known"),
        value: Json.optional(),
      })
      .strict(),
    z
      .object({
        status: z.literal("unknown"),
        value: Json.optional(),
      })
      .strict(),
  ])
  .readonly()

export type CapsuleValue = z.infer<typeof CapsuleValue>

export const Pointer = z
  .object({
    path: z.string().min(1),
    sha256: Sha256,
    kind: z.string().min(1),
    anchor: z.string().min(1).optional(),
  })
  .strict()

export type Pointer = z.infer<typeof Pointer>

const WorkingSet = z
  .object({
    pointers: z.array(Pointer),
  })
  .strict()

export const CapsuleSession = z
  .object({
    specVersion: z.literal("capsule-session/1.0"),
    sessionId: z.string().min(1),
    generatedAtUtc: IsoDateTimeUtc,
    goal: CapsuleValue,
    decisions: z.array(CapsuleValue),
    openQuestions: z.array(CapsuleValue),
    workingSet: WorkingSet,
    notes: z.array(CapsuleValue),
  })
  .strict()

export type CapsuleSession = z.infer<typeof CapsuleSession>

export const CapsuleHandoff = z
  .object({
    specVersion: z.literal("capsule-handoff/1.0"),
    childSessionId: z.string().min(1),
    generatedAtUtc: IsoDateTimeUtc,
    goal: CapsuleValue,
    decisions: z.array(CapsuleValue),
    openQuestions: z.array(CapsuleValue),
    workingSet: WorkingSet,
    notes: z.array(CapsuleValue),
  })
  .strict()

export type CapsuleHandoff = z.infer<typeof CapsuleHandoff>
