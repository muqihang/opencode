import fs from "fs/promises"
import path from "path"
import z from "zod"
import { Instance } from "@/project/instance"
import { Filesystem } from "@/util/filesystem"
import { Identifier } from "@/id/id"
import { stableJson } from "@/util/stable-json"
import { Lock } from "@/util/lock"

const CacheCategory = z.enum(["text", "archive", "pdf"])

type CacheCategory = z.infer<typeof CacheCategory>

type ToolName = "tar" | "unzip" | "pdftotext"

type ToolFingerprint = {
  tar?: { present: boolean }
  unzip?: { present: boolean }
  pdftotext?: { present: boolean }
}

const CacheArtifact = z
  .object({
    path: z.string().min(1),
    sha256: z.string().min(1),
    kind: z.string().min(1),
  })
  .strict()

const CacheMeta = z
  .object({
    specVersion: z.literal("file-workbench-cache/1.0"),
    category: CacheCategory,
    inputId: z.string().min(1),
    createdAtUtc: z.string().min(1),
    toolFingerprint: z
      .object({
        tar: z.object({ present: z.boolean() }).optional(),
        unzip: z.object({ present: z.boolean() }).optional(),
        pdftotext: z.object({ present: z.boolean() }).optional(),
      })
      .strict()
      .optional(),
    artifacts: z.array(CacheArtifact),
  })
  .strict()

function baseDir() {
  return Instance.worktree === "/" ? Instance.directory : Instance.worktree
}

function cacheRoot() {
  return path.join(baseDir(), ".opencode", "cache", "file-workbench")
}

function normalizeRel(rel: string) {
  return rel.replaceAll("\\", "/")
}

function isTraversal(rel: string) {
  if (path.isAbsolute(rel)) return true
  const parts = rel.split(/[/\\]/)
  return parts.includes("..")
}

async function safePath(base: string, rel: string) {
  if (isTraversal(rel)) throw new Error("Path traversal is not allowed")
  const target = path.resolve(base, rel)
  if (!Filesystem.contains(base, target)) throw new Error("Path is outside base directory")
  return target
}

async function sha256File(file: string) {
  const bytes = await Bun.file(file).bytes()
  const hash = new Bun.CryptoHasher("sha256")
  hash.update(Buffer.from(bytes))
  return hash.digest("hex")
}

async function writeAtomic(file: string, data: string | Uint8Array) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${Identifier.ascending("tool")}.tmp`
  await Bun.write(tmp, data)
  await fs.rename(tmp, file)
}

async function readMeta(metaPath: string) {
  const text = await Bun.file(metaPath).text().catch(() => "")
  if (!text) return
  return CacheMeta.safeParse(JSON.parse(text) as unknown)
}

function sameTool(meta: ToolFingerprint | undefined, current: ToolFingerprint, name: ToolName) {
  const cached = meta?.[name]?.present
  if (cached === undefined) return false
  const now = current[name]?.present
  if (now === undefined) return false
  return cached === now
}

function canReuse(meta: z.infer<typeof CacheMeta>, category: CacheCategory) {
  if (category === "text") return true
  const current = WorkbenchCache.toolFingerprint()
  if (category === "pdf") return sameTool(meta.toolFingerprint, current, "pdftotext")
  if (category === "archive") {
    const tarOk = sameTool(meta.toolFingerprint, current, "tar")
    if (!tarOk) return false
    return sameTool(meta.toolFingerprint, current, "unzip")
  }
  return false
}

export const WorkbenchCache = {
  async readCategory(input: { inputId: string; category: CacheCategory }) {
    const dir = path.join(cacheRoot(), input.inputId, input.category)
    const metaPath = path.join(dir, "cache.json")
    await using lock = await Lock.read(`file-workbench-cache:${input.inputId}:${input.category}`)
    void lock
    const parsed = await readMeta(metaPath)
    if (!parsed?.success) return
    return { dir, meta: parsed.data }
  },

  async readArtifact(input: { dir: string; rel: string }) {
    const target = await safePath(input.dir, input.rel)
    return Bun.file(target).bytes()
  },

  toolFingerprint(): ToolFingerprint {
    return {
      tar: { present: Boolean(Bun.which("tar")) },
      unzip: { present: Boolean(Bun.which("unzip")) },
      pdftotext: { present: Boolean(Bun.which("pdftotext")) },
    }
  },

  canReuse(input: { meta: z.infer<typeof CacheMeta>; category: CacheCategory }) {
    return canReuse(input.meta, input.category)
  },

  async writeCategoryFromSessionDerived(input: {
    sessionId: string
    inputId: string
    category: CacheCategory
    artifacts: Array<{ rel: string; kind: string }>
  }) {
    const base = baseDir()
    const sessionDerived = path.join(base, ".opencode", "artifacts", input.sessionId, "derived", input.inputId)
    const categoryDir = path.join(cacheRoot(), input.inputId, input.category)
    await using lock = await Lock.write(`file-workbench-cache:${input.inputId}:${input.category}`)
    void lock

    const stored: Array<z.infer<typeof CacheArtifact>> = []
    for (const item of input.artifacts) {
      const rel = normalizeRel(item.rel)
      const src = await safePath(sessionDerived, rel)
      const bytes = await Bun.file(src).bytes()
      const dest = await safePath(categoryDir, rel)
      await writeAtomic(dest, bytes)
      stored.push({ path: rel, sha256: await sha256File(dest), kind: item.kind })
    }
    stored.sort((a, b) => a.path.localeCompare(b.path))
    const meta = CacheMeta.parse({
      specVersion: "file-workbench-cache/1.0",
      category: input.category,
      inputId: input.inputId,
      createdAtUtc: new Date().toISOString(),
      toolFingerprint: WorkbenchCache.toolFingerprint(),
      artifacts: stored,
    })
    await writeAtomic(path.join(categoryDir, "cache.json"), stableJson(meta))
  },
}
