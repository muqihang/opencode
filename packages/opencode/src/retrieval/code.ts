import path from "path"
import { EvidenceWriter } from "@/evidence/writer"
import { Ripgrep } from "@/file/ripgrep"
import { LSP } from "@/lsp"
import { defer } from "@/util/defer"
import { dedupeHits } from "./dedupe"

type Query = {
  role: "precision" | "recall"
  q: string
  lang: string
  kind: string
}

type CodePointer = {
  path: string
  sha256: string
  anchor?: { lineStart: number; lineEnd: number }
}

type CodeHit = {
  pointer: CodePointer
  score_bps: number
  source: "rg" | "lsp" | "tree"
  origin: { path: string; lineStart: number; lineEnd: number }
}

type CodeResult = {
  hits: CodeHit[]
}

export const CodeRetrievalStats = {
  runs: 0,
}

const lineCount = (text: string) => {
  const parts = text.split(/\r?\n/)
  const last = parts.at(-1) ?? ""
  const count = last === "" ? parts.length - 1 : parts.length
  if (count > 0) return count
  return 1
}

const readLines = async (file: string) => {
  const text = await Bun.file(file)
    .text()
    .catch(() => "")
  if (!text) return [] as string[]
  return text.split(/\r?\n/)
}

const fileFromUri = (uri: string) => {
  const url = new URL(uri)
  if (url.protocol !== "file:") return ""
  return path.normalize(url.pathname)
}

const internalPath = (value: string) =>
  value === ".opencode" || value.startsWith(".opencode/") || value === ".git" || value.startsWith(".git/")

const listFiles = async (root: string, limit: number) => {
  const items: string[] = []
  for await (const item of Ripgrep.files({ cwd: root })) {
    if (internalPath(item)) continue
    items.push(item)
    if (items.length >= limit) break
  }
  return items
}

export const runCodeRetrieval = async (input: {
  sessionId: string
  retrievalId: string
  root: string
  queries: Query[]
  budget: { maxHits: number; topK: number; maxWallClockMs: number }
  abort: AbortSignal
}): Promise<CodeResult> => {
  CodeRetrievalStats.runs += 1
  const timer = setTimeout(() => {
    // noop
  }, input.budget.maxWallClockMs)
  using _ = defer(() => clearTimeout(timer))

  const writer = await EvidenceWriter.open({ sessionId: input.sessionId })
  const hits: Array<{
    source: "rg" | "lsp" | "tree"
    scoreBps: number
    path: string
    lineStart: number
    lineEnd: number
    text: string
  }> = []

  const limit = input.budget.maxHits

  for (const query of input.queries) {
    if (input.abort.aborted) break
    const rows = await Ripgrep.search({
      cwd: input.root,
      pattern: query.q,
      limit,
    })
    for (const row of rows) {
      const raw = row.lines.text ?? ""
      const rel = row.path.text
      if (internalPath(rel)) continue
      const snippet = raw.trim().length ? raw.trimEnd() : row.path.text
      const count = lineCount(snippet)
      const start = row.line_number
      const end = start + count - 1
      hits.push({
        source: "rg",
        scoreBps: 8500,
        path: rel,
        lineStart: start,
        lineEnd: end,
        text: snippet,
      })
      if (hits.length >= limit) break
    }
    if (hits.length >= limit) break
  }

  const files = await listFiles(input.root, limit)
  for (const file of files) {
    if (hits.length >= limit) break
    hits.push({
      source: "tree",
      scoreBps: 7000,
      path: file,
      lineStart: 1,
      lineEnd: 1,
      text: file,
    })
  }

  const sample = files[0]
  const lspDisabled = process.env["OPENCODE_DISABLE_LSP"] === "1"
  const lspReady = !lspDisabled && sample ? await LSP.hasClients(path.join(input.root, sample)) : false
  if (lspReady) {
    for (const query of input.queries) {
      if (input.abort.aborted) break
      const rows = await LSP.workspaceSymbol(query.q)
      for (const row of rows) {
        if (hits.length >= limit) break
        const file = fileFromUri(row.location.uri)
        if (!file) continue
        const rel = path.relative(input.root, file)
        if (internalPath(rel)) continue
        const lines = await readLines(file)
        const start = row.location.range.start.line + 1
        const end = row.location.range.end.line + 1
        const slice = lines.slice(Math.max(0, start - 1), Math.max(0, end)).join("\n")
        const snippet = slice.trim().length ? slice : row.name
        hits.push({
          source: "lsp",
          scoreBps: 9000,
          path: rel,
          lineStart: start,
          lineEnd: end,
          text: snippet,
        })
      }
      if (hits.length >= limit) break
    }
  }

  const deduped = dedupeHits(hits).slice(0, input.budget.topK)
  const results = await Promise.all(
    deduped.map(async (item, index) => {
      const entry = await writer.artifact({
        kind: "retrieval-snippet",
        path: `retrieval/${input.retrievalId}/snippets/${String(index + 1).padStart(4, "0")}.txt`,
        data: item.text,
      })
      const count = lineCount(item.text)
      return {
        pointer: {
          path: entry.path,
          sha256: entry.sha256,
          anchor: { lineStart: 1, lineEnd: count },
        },
        score_bps: item.scoreBps,
        source: item.source,
        origin: { path: item.path, lineStart: item.lineStart, lineEnd: item.lineEnd },
      }
    }),
  )

  return { hits: results }
}
