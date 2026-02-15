import z from "zod"
import { IsoDateTimeUtc, Sha256 } from "./shared"

const Root = "0".repeat(64)

const Entry = z
  .object({
    path: z.string().min(1),
    sha256: Sha256,
    kind: z.string().min(1),
    size: z.number().int().nonnegative().optional(),
    createdAtUtc: IsoDateTimeUtc.optional(),
    sequence: z.number().int().positive().optional(),
    prevHash: Sha256.optional(),
    entryHash: Sha256.optional(),
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
export type EvidenceManifestEntry = z.infer<typeof Entry>

type ChainState = "legacy" | "chain" | "mixed"

const normalizePath = (value: string) => value.replace(/\\/g, "/")

const stableEntryString = (input: {
  path: string
  sha256: string
  kind: string
  size?: number
  createdAtUtc?: string
  sequence: number
  prevHash: string
}) =>
  [
    normalizePath(input.path),
    input.sha256.toLowerCase(),
    input.kind,
    input.size === undefined ? "" : String(input.size),
    input.createdAtUtc ?? "",
    String(input.sequence),
    input.prevHash.toLowerCase(),
  ].join("\n")

const digestEntry = (input: {
  path: string
  sha256: string
  kind: string
  size?: number
  createdAtUtc?: string
  sequence: number
  prevHash: string
}) => {
  const hash = new Bun.CryptoHasher("sha256")
  hash.update(stableEntryString(input))
  return hash.digest("hex")
}

const chainState = (entries: EvidenceManifestEntry[]): ChainState => {
  if (entries.length === 0) return "legacy"
  const has = entries.map((entry) =>
    entry.sequence !== undefined || entry.prevHash !== undefined || entry.entryHash !== undefined,
  )
  if (has.every((flag) => flag === false)) return "legacy"
  const full = entries.every(
    (entry) => entry.sequence !== undefined && entry.prevHash !== undefined && entry.entryHash !== undefined,
  )
  if (full) return "chain"
  return "mixed"
}

const withHash = (input: {
  path: string
  sha256: string
  kind: string
  size?: number
  createdAtUtc?: string
  sequence: number
  prevHash: string
}) => {
  const head = Entry.parse({
    path: input.path,
    sha256: input.sha256,
    kind: input.kind,
    size: input.size,
    createdAtUtc: input.createdAtUtc,
    sequence: input.sequence,
    prevHash: input.prevHash,
  })
  const entryHash = digestEntry({
    path: head.path,
    sha256: head.sha256,
    kind: head.kind,
    size: head.size,
    createdAtUtc: head.createdAtUtc,
    sequence: head.sequence!,
    prevHash: head.prevHash!,
  })
  return Entry.parse({
    ...head,
    entryHash,
  })
}

export const upgradeManifestEntries = (entries: EvidenceManifestEntry[]) => {
  const out = [] as EvidenceManifestEntry[]
  const base = [...entries]
  for (const entry of base) {
    const prev = out.at(-1)
    const next = withHash({
      path: entry.path,
      sha256: entry.sha256,
      kind: entry.kind,
      size: entry.size,
      createdAtUtc: entry.createdAtUtc,
      sequence: (prev?.sequence ?? 0) + 1,
      prevHash: prev?.entryHash ?? Root,
    })
    out.push(next)
  }
  return out
}

export const validateManifestEntries = (entries: EvidenceManifestEntry[]) => {
  const state = chainState(entries)
  if (state === "legacy") return { state, entries }
  if (state === "mixed") {
    throw new Error("evidence manifest chain invalid: mixed legacy and chained entries")
  }

  const ordered = [...entries].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
  const seq = new Set<number>()
  let prevHash = Root
  let expected = 1

  for (const entry of ordered) {
    const sequence = entry.sequence ?? 0
    const seen = seq.has(sequence)
    if (seen) {
      throw new Error(`evidence manifest chain invalid: duplicate sequence ${sequence}`)
    }
    seq.add(sequence)
    if (sequence !== expected) {
      throw new Error(`evidence manifest chain invalid: expected sequence ${expected}, got ${sequence}`)
    }
    if (entry.prevHash !== prevHash) {
      throw new Error(`evidence manifest chain invalid: prevHash mismatch at sequence ${sequence}`)
    }

    const computed = digestEntry({
      path: entry.path,
      sha256: entry.sha256,
      kind: entry.kind,
      size: entry.size,
      createdAtUtc: entry.createdAtUtc,
      sequence,
      prevHash: entry.prevHash!,
    })
    if (entry.entryHash !== computed) {
      throw new Error(`evidence manifest chain invalid: entryHash mismatch at sequence ${sequence}`)
    }

    prevHash = entry.entryHash
    expected += 1
  }

  return {
    state,
    entries: ordered,
  }
}

export const appendManifestEntry = (input: {
  entries: EvidenceManifestEntry[]
  entry: {
    path: string
    sha256: string
    kind: string
    size?: number
    createdAtUtc?: string
  }
}) => {
  const parsed = validateManifestEntries(input.entries)
  const chain = parsed.state === "legacy" ? upgradeManifestEntries(parsed.entries) : parsed.entries
  const prev = chain.at(-1)
  const next = withHash({
    path: input.entry.path,
    sha256: input.entry.sha256,
    kind: input.entry.kind,
    size: input.entry.size,
    createdAtUtc: input.entry.createdAtUtc,
    sequence: (prev?.sequence ?? 0) + 1,
    prevHash: prev?.entryHash ?? Root,
  })
  return [...chain, next]
}

export const latestManifestEntries = (entries: EvidenceManifestEntry[]) => {
  const parsed = validateManifestEntries(entries)
  const ordered = parsed.state === "legacy" ? parsed.entries : parsed.entries
  const map = new Map<string, EvidenceManifestEntry>()
  for (const entry of ordered) {
    map.set(normalizePath(entry.path), entry)
  }
  return [...map.values()].sort((a, b) => a.path.localeCompare(b.path))
}
