type Entry = {
  path: string
  kind?: string
}

export type EvidenceChainResult =
  | { ok: true }
  | { ok: false; missing: string[]; errorZh: string }

const norm = (value: string) => value.replace(/\\/g, "/").replace(/\/+/g, "/")

export const verifyEvidenceChain = (input: { entries: Entry[]; existing: string[] }): EvidenceChainResult => {
  const have = new Set(input.existing.map((p) => norm(p)))
  const miss = input.entries
    .map((e) => norm(e.path))
    .filter((p) => p.length > 0)
    .filter((p) => !have.has(p))
    .toSorted()

  if (miss.length === 0) return { ok: true }

  const lines = [
    `证据断链：manifest 声明了 ${miss.length} 个条目，但本地缺失以下 artifact（请先补齐或重新生成 Evidence Pack）`,
    ...miss.map((p) => `- ${p}`),
  ]
  const errorZh = lines.join("\n")
  return { ok: false, missing: miss, errorZh }
}

