import path from "path"
import { Instance } from "@/project/instance"

type WorkbenchPointer = {
  path: string
  sha256: string
  anchor?: {
    page?: number
    lineStart?: number
    lineEnd?: number
    paragraphIndex?: number
    chunkIndex?: number
  }
}

export type WorkbenchHit = {
  pointer: WorkbenchPointer
  score_bps: number
  source: "workbench"
  origin: { inputId: string; kind: string }
}

const baseDir = () => (Instance.worktree === "/" ? Instance.directory : Instance.worktree)

const sha256File = async (file: string) => {
  const bytes = await Bun.file(file)
    .arrayBuffer()
    .catch(() => undefined)
  if (!bytes) return ""
  const hash = new Bun.CryptoHasher("sha256")
  hash.update(Buffer.from(bytes))
  return hash.digest("hex")
}

const readJson = async (file: string) => {
  const text = await Bun.file(file)
    .text()
    .catch(() => "")
  if (!text) return
  return JSON.parse(text) as unknown
}

const readLines = async (file: string) => {
  const text = await Bun.file(file)
    .text()
    .catch(() => "")
  if (!text) return [] as string[]
  return text.split(/\r?\n/)
}

const firstPageAnchor = async (root: string, file: string) => {
  const doc = await readJson(file)
  if (!doc || typeof doc !== "object") return
  const pages = Array.isArray((doc as any).pages) ? (doc as any).pages : []
  const entry = pages.find((item: any) => typeof item?.page_number === "number")
  if (!entry) return
  const page = entry.page_number as number
  const rel = entry.text_path
  if (typeof rel !== "string") return
  const textPath = path.join(root, rel)
  const lines = await readLines(textPath)
  const count = lines.length > 0 ? lines.length : 1
  return { page, lineStart: 1, lineEnd: count }
}

const firstParagraphAnchor = async (file: string) => {
  const doc = await readJson(file)
  if (!doc || typeof doc !== "object") return
  const count = (doc as any).paragraphCount
  if (typeof count !== "number" || count <= 0) return
  return { paragraphIndex: 0 }
}

const firstChunkAnchor = async (file: string) => {
  const doc = await readJson(file)
  if (!Array.isArray(doc)) return
  const entry = doc.find((item) => item && typeof item === "object")
  if (!entry) return
  const index = (entry as any).chunk_index ?? (entry as any).chunkIndex
  if (typeof index !== "number") return
  return { chunkIndex: index }
}

export const runWorkbenchRetrieval = async (input: {
  sessionId: string
  inputId: string
  derivedRoot: string
  retrievalId: string
}): Promise<WorkbenchHit[]> => {
  const root = input.derivedRoot
  const base = baseDir()
  const items = [
    { kind: "pdf", file: path.join(root, "pdf.pages.json") },
    { kind: "docx", file: path.join(root, "docx.structure.json") },
    { kind: "chunks", file: path.join(root, "chunks.json") },
    { kind: "archive", file: path.join(root, "unpacked/filelist.json") },
  ]

  const hits: WorkbenchHit[] = []
  for (const item of items) {
    const exists = await Bun.file(item.file).exists()
    if (!exists) continue
    const sha256 = await sha256File(item.file)
    const rel = path.relative(base, item.file)
    const anchor = await (async () => {
      if (item.kind === "pdf") return firstPageAnchor(root, item.file)
      if (item.kind === "docx") return firstParagraphAnchor(item.file)
      if (item.kind === "chunks") return firstChunkAnchor(item.file)
      return
    })()
    hits.push({
      pointer: { path: rel, sha256, anchor },
      score_bps: 8000,
      source: "workbench",
      origin: { inputId: input.inputId, kind: item.kind },
    })
  }

  return hits.toSorted((a, b) => a.pointer.path.localeCompare(b.pointer.path))
}
