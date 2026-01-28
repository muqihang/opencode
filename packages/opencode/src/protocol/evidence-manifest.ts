import z from "zod"
import { IsoDateTimeUtc, Sha256 } from "./shared"

const Entry = z
  .object({
    path: z.string().min(1),
    sha256: Sha256,
    kind: z.string().min(1),
    size: z.number().int().nonnegative().optional(),
    createdAtUtc: IsoDateTimeUtc.optional(),
  })
  .strict()

export const EvidenceManifest = z
  .object({
    specVersion: z.literal("evidence-manifest/1.0"),
    packId: z.string().min(1),
    generatedAtUtc: IsoDateTimeUtc,
    entries: z.array(Entry),
  })
  .strict()

export type EvidenceManifest = z.infer<typeof EvidenceManifest>
