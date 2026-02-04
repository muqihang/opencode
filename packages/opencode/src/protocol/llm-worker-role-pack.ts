import z from "zod"
import { PositiveInt } from "./shared"

const Pointer = z.union([
  z.string().min(1),
  z
    .object({
      kind: z.string().min(1),
      ref: z.string().min(1),
      label: z.string().min(1).optional(),
    })
    .strict(),
])

const Policy = z
  .object({
    mode: z.enum(["strict", "balanced", "loose"]),
    unknown: z.enum(["allow", "deny"]),
  })
  .strict()

const Budget = z
  .object({
    timeoutMs: PositiveInt,
    maxOutputTokens: PositiveInt,
    maxToolCalls: PositiveInt,
  })
  .strict()

const WorkingSet = z
  .object({
    pointers: z.array(Pointer),
  })
  .strict()

export const LlmWorkerRolePack = z
  .object({
    specVersion: z.literal("llm-worker-role-pack/1.0"),
    planPointer: z.string().min(1),
    policy: Policy,
    budget: Budget,
    workingSet: WorkingSet,
  })
  .strict()

export type LlmWorkerRolePack = z.infer<typeof LlmWorkerRolePack>
