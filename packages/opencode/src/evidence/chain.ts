import { extractCitationPointersFromEvents } from "@/evidence/events"

type Entry = {
  path: string
  kind?: string
  sha256?: string
}

type Pointer =
  | string
  | {
      kind?: string
      ref: string
      sha256?: string
    }

export type EvidenceChainResult =
  | { ok: true }
  | { ok: false; missing: string[]; contaminated: string[]; errorZh: string }

const norm = (value: string) => value.replace(/\\/g, "/").replace(/\/+/g, "/")

const canonical = (value: string) => {
  const normalized = norm(value)
  const parts = normalized.split("/").filter(Boolean)
  if (parts[0] !== ".opencode") return normalized
  if (parts[1] !== "artifacts" && parts[1] !== "evidence") return normalized
  if (parts.length >= 6) {
    const head = [parts[0], parts[1], parts[4]]
    const tail = parts.slice(5)
    return `/${[...head, ...tail].join("/")}`.replace(/^\//, "")
  }
  if (parts.length >= 4) {
    return normalized
  }
  return normalized
}

const pointerRef = (pointer: Pointer) => {
  if (typeof pointer === "string") return pointer
  return pointer.ref
}

const pointerSha = (pointer: Pointer) => {
  if (typeof pointer === "string") return ""
  return pointer.sha256 ?? ""
}

const lower = (value: string) => value.trim().toLowerCase()

const hasPath = (raw: Set<string>, canonicalSet: Set<string>, value: string) => {
  const normalized = norm(value)
  if (raw.has(normalized)) return true
  return canonicalSet.has(canonical(normalized))
}

const mapSha = (input: Array<readonly [string, string]>) => {
  const raw = new Map<string, string>()
  const canon = new Map<string, string>()
  for (const [key, value] of input) {
    raw.set(key, value)
    const alias = canonical(key)
    if (!canon.has(alias)) {
      canon.set(alias, value)
    }
  }
  return { raw, canon }
}

const readSha = (input: { raw: Map<string, string>; canon: Map<string, string> }, key: string) => {
  const normalized = norm(key)
  const direct = input.raw.get(normalized)
  if (direct) return direct
  return input.canon.get(canonical(normalized)) ?? ""
}

export const verifyEvidenceChain = (input: {
  entries: Entry[]
  existing: string[]
  pointers?: Pointer[]
  events?: unknown[]
  hashes?: Record<string, string>
  headerZh?: string
}): EvidenceChainResult => {
  const existingRaw = new Set(input.existing.map((p) => norm(p)))
  const existingCanonical = new Set(input.existing.map((p) => canonical(p)))

  const fromEvents = extractCitationPointersFromEvents(input.events ?? []).map((item) => ({
    kind: "artifact",
    ref: item.ref,
    sha256: item.sha256,
  }))
  const pointers = [...(input.pointers ?? []), ...fromEvents]

  const entrySha = mapSha(
    input.entries
      .map((item) => {
        if (!item.sha256) return undefined
        const rel = norm(item.path)
        return [rel, lower(item.sha256)] as const
      })
      .filter((item): item is readonly [string, string] => Boolean(item)),
  )

  const hashSha = mapSha(
    Object.entries(input.hashes ?? {}).map(([key, value]) => [norm(key), lower(value)] as const),
  )

  const miss = input.entries
    .map((item) => norm(item.path))
    .filter((p) => p.length > 0)
    .filter((p) => !hasPath(existingRaw, existingCanonical, p))

  const pointerMiss = pointers
    .map((item) => norm(pointerRef(item)))
    .filter((p) => p.length > 0)
    .filter((p) => !hasPath(existingRaw, existingCanonical, p))

  const contaminated = pointers
    .map((item) => {
      const ref = norm(pointerRef(item))
      const expected = lower(pointerSha(item))
      if (!ref || !expected) return ""
      const actual = readSha(hashSha, ref) || readSha(entrySha, ref)
      if (!actual) return ""
      if (actual === expected) return ""
      return ref
    })
    .filter(Boolean)

  const missing = [...new Set([...miss, ...pointerMiss])].toSorted()
  const polluted = [...new Set(contaminated)].toSorted()

  if (missing.length === 0 && polluted.length === 0) return { ok: true }

  const lead = input.headerZh
    ? `${input.headerZh}（缺失 ${missing.length} 个文件，污染 ${polluted.length} 个 pointer）`
    : `证据断链：manifest/pointer 存在缺失或污染（请先补齐 artifact 或冷启动重建缓存）`
  const missingHead =
    missing.length > 0 ? [`缺失文件（${missing.length}）：`, ...missing.map((p) => `- ${p}`)] : []
  const pollutedHead =
    polluted.length > 0 ? [`污染 pointer（${polluted.length}）：`, ...polluted.map((p) => `- ${p}`)] : []
  const lines = [lead, ...missingHead, ...pollutedHead]
  const errorZh = lines.join("\n")
  return { ok: false, missing, contaminated: polluted, errorZh }
}
