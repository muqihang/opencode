import z from "zod"
import { Sha256 } from "./shared"
import { EventV1 } from "./event"

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

const Task = z
  .object({
    title: z.string().min(1),
    intent: z.string().min(1),
    successCriteria: z.array(z.string().min(1)),
    constraints: z.array(z.string().min(1)).optional(),
  })
  .strict()

const Execution = z
  .object({
    kind: z.string().min(1),
    id: z.string().min(1),
    backend: z.string().min(1).optional(),
    enforcement: z.string().min(1).optional(),
  })
  .strict()

const Environment = z
  .object({
    execution: Execution,
    os: z.string().min(1).optional(),
    runtime: z.record(z.string(), z.string()).optional(),
    repo: z.record(z.string(), z.string()).optional(),
  })
  .strict()

const Claim = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
    statement: z.string().min(1),
    evidence: z.array(z.string().min(1)),
    verification: z.array(z.string().min(1)).optional(),
    confidence: z.number().min(0).max(1).optional(),
  })
  .strict()

const Artifact = z
  .object({
    id: z.string().min(1),
    kind: z.string().min(1),
    path: z.string().min(1),
    sha256: Sha256.optional(),
  })
  .strict()

const Check = z
  .object({
    id: z.string().min(1),
    command: z.string().min(1),
    status: z.enum(["pass", "fail", "skip"]),
    artifact: z.string().min(1).optional(),
  })
  .strict()

const Capsule = z
  .object({
    handoff: z.string().min(1),
    pointers: z.array(Pointer),
    openQuestions: z.array(z.string().min(1)),
  })
  .strict()

const Risk = z
  .object({
    summary: z.string().min(1),
    evidence: z.array(z.string().min(1)).optional(),
  })
  .strict()

const Rollback = z
  .object({
    strategy: z.string().min(1),
    steps: z.array(z.string().min(1)),
  })
  .strict()

export const EvidencePack = z
  .object({
    specVersion: z.literal("evidence-pack/1.0"),
    packId: z.string().min(1),
    task: Task,
    environment: Environment,
    claims: z.array(Claim),
    artifacts: z.array(Artifact),
    checks: z.array(Check),
    events: z.array(EventV1),
    capsule: Capsule,
    risks: z.array(Risk),
    rollback: Rollback,
  })
  .strict()

export type EvidencePack = z.infer<typeof EvidencePack>
