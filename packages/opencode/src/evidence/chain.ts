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

const pointerRef = (pointer: Pointer) => {
  if (typeof pointer === "string") return pointer
  return pointer.ref
}

const pointerSha = (pointer: Pointer) => {
  if (typeof pointer === "string") return ""
  return pointer.sha256 ?? ""
}

const lower = (value: string) => value.trim().toLowerCase()

export const verifyEvidenceChain = (input: {
  entries: Entry[]
  existing: string[]
  pointers?: Pointer[]
  hashes?: Record<string, string>
  headerZh?: string
}): EvidenceChainResult => {
  const have = new Set(input.existing.map((p) => norm(p)))
  const entrySha = new Map(
    input.entries
      .map((item) => {
        if (!item.sha256) return undefined
        const rel = norm(item.path)
        return [rel, lower(item.sha256)] as const
      })
      .filter((item): item is readonly [string, string] => Boolean(item)),
  )
  const hashSha = new Map(
    Object.entries(input.hashes ?? {}).map(([key, value]) => [norm(key), lower(value)] as const),
  )

  const miss = input.entries
    .map((item) => norm(item.path))
    .filter((p) => p.length > 0)
    .filter((p) => !have.has(p))
  const pointerMiss = (input.pointers ?? [])
    .map((item) => norm(pointerRef(item)))
    .filter((p) => p.length > 0)
    .filter((p) => !have.has(p))

  const contaminated = (input.pointers ?? [])
    .map((item) => {
      const ref = norm(pointerRef(item))
      const expected = lower(pointerSha(item))
      if (!ref || !expected) return ""
      const actual = hashSha.get(ref) ?? entrySha.get(ref) ?? ""
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
