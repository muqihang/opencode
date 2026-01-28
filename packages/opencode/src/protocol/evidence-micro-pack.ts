import z from "zod"
import { IsoDateTimeUtc, Sha256 } from "./shared"
import { EventV1 } from "./event"

const Artifact = z
  .object({
    path: z.string().min(1),
    sha256: Sha256.optional(),
    kind: z.string().min(1),
    size: z.number().int().nonnegative().optional(),
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

const Check = z
  .object({
    id: z.string().min(1),
    command: z.string().min(1),
    status: z.enum(["pass", "fail", "skip"]),
    artifact: z.string().min(1).optional(),
  })
  .strict()

export const EvidenceMicroPack = z
  .object({
    specVersion: z.literal("evidence-micro-pack/1.0"),
    packId: z.string().min(1),
    sessionId: z.string().min(1),
    parentSessionId: z.string().min(1).optional(),
    generatedAtUtc: IsoDateTimeUtc,
    artifacts: z.array(Artifact),
    claims: z.array(Claim),
    checks: z.array(Check),
    events: z.array(EventV1),
  })
  .strict()

export type EvidenceMicroPack = z.infer<typeof EvidenceMicroPack>
