export type RawHit = {
  source: "rg" | "lsp" | "tree"
  scoreBps: number
  path: string
  lineStart: number
  lineEnd: number
  text: string
}

const sha256Text = (text: string): string => {
  const hash = new Bun.CryptoHasher("sha256")
  hash.update(text)
  return hash.digest("hex")
}

const normalizeText = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase()

const sourceRank = (source: RawHit["source"]) => {
  if (source === "lsp") return 0
  if (source === "rg") return 1
  return 2
}

const compareHits = (left: RawHit, right: RawHit) => {
  if (left.scoreBps !== right.scoreBps) return right.scoreBps - left.scoreBps
  const rank = sourceRank(left.source) - sourceRank(right.source)
  if (rank !== 0) return rank
  const path = left.path.localeCompare(right.path)
  if (path !== 0) return path
  if (left.lineStart !== right.lineStart) return left.lineStart - right.lineStart
  if (left.lineEnd !== right.lineEnd) return left.lineEnd - right.lineEnd
  return left.text.localeCompare(right.text)
}

const better = (left: RawHit, right: RawHit) => compareHits(left, right) < 0

const overlaps = (left: RawHit, right: RawHit) => left.lineStart <= right.lineEnd && right.lineStart <= left.lineEnd

export const dedupeHits = (items: RawHit[]) => {
  const byHash = new Map<string, RawHit>()
  for (const item of items) {
    const hash = sha256Text(normalizeText(item.text))
    const existing = byHash.get(hash)
    if (!existing) {
      byHash.set(hash, item)
      continue
    }
    if (better(item, existing)) byHash.set(hash, item)
  }

  const byPath = new Map<string, RawHit[]>()
  for (const item of byHash.values()) {
    const list = byPath.get(item.path)
    if (!list) {
      byPath.set(item.path, [item])
      continue
    }
    list.push(item)
  }

  const pruned: RawHit[] = []
  for (const list of byPath.values()) {
    const sorted = list.toSorted((left, right) => {
      if (left.lineStart !== right.lineStart) return left.lineStart - right.lineStart
      if (left.lineEnd !== right.lineEnd) return left.lineEnd - right.lineEnd
      return compareHits(left, right)
    })
    const kept: RawHit[] = []
    for (const item of sorted) {
      const last = kept.at(-1)
      if (!last) {
        kept.push(item)
        continue
      }
      if (!overlaps(last, item)) {
        kept.push(item)
        continue
      }
      if (better(item, last)) kept[kept.length - 1] = item
    }
    pruned.push(...kept)
  }

  return pruned.toSorted(compareHits)
}
