import fs from "fs/promises"
import path from "path"
import z from "zod"
import { fileURLToPath } from "url"
import { Config } from "@/config/config"
import { Instance } from "@/project/instance"
import { Filesystem } from "@/util/filesystem"

const ScriptEntry = z
  .object({
    id: z.string().min(1),
    path: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  })
  .strict()

const ScriptManifest = z.array(ScriptEntry)

const manifestPath = fileURLToPath(new URL("./scripts.manifest.json", import.meta.url))
const manifestBase = path.dirname(manifestPath)

function sha(input: string) {
  const hash = new Bun.CryptoHasher("sha256")
  hash.update(input)
  return hash.digest("hex")
}

function isTraversal(rel: string) {
  if (path.isAbsolute(rel)) return true
  const parts = rel.split(path.sep)
  return parts.includes("..")
}

async function hasSymlink(base: string, target: string) {
  const rel = path.relative(base, target)
  const parts = rel.split(path.sep).filter(Boolean)
  let current = base
  for (const part of parts) {
    current = path.join(current, part)
    const stat = await fs.lstat(current).catch(() => null)
    if (!stat) continue
    if (stat.isSymbolicLink()) return true
  }
  return false
}

async function safePath(base: string, rel: string) {
  if (isTraversal(rel)) {
    throw new Error("Path traversal is not allowed")
  }
  const target = path.resolve(base, rel)
  if (!Filesystem.contains(base, target)) {
    throw new Error("Path is outside base directory")
  }
  const symlink = await hasSymlink(base, target)
  if (symlink) {
    throw new Error("Symlink targets are not allowed")
  }
  return target
}

async function readManifest() {
  const text = await Bun.file(manifestPath).text()
  const data = JSON.parse(text) as unknown
  return ScriptManifest.parse(data)
}

async function shaFile(target: string) {
  const text = await Bun.file(target).text()
  return sha(text)
}

function projectBase() {
  const root = Instance.worktree === "/" ? Instance.directory : Instance.worktree
  return path.join(root, ".opencode", "scripts")
}

export const ScriptRegistry = {
  async manifest() {
    return readManifest()
  },
  async resolve({ scriptId }: { scriptId: string }) {
    if (scriptId.startsWith("project:")) {
      const config = await Config.get()
      if (!config.python?.allowProjectScripts) {
        throw new Error("allowProjectScripts is disabled")
      }
      const name = scriptId.slice("project:".length)
      if (!name) {
        throw new Error("Project script id is required")
      }
      if (name.includes("/") || name.includes("\\")) {
        throw new Error("Project script id must not include path separators")
      }
      const base = projectBase()
      const target = await safePath(base, `${name}.py`)
      const digest = await shaFile(target)
      return {
        id: scriptId,
        path: target,
        sha256: digest,
      }
    }

    const manifest = await readManifest()
    const entry = manifest.find((item) => item.id === scriptId)
    if (!entry) {
      throw new Error(`Script not found: ${scriptId}`)
    }
    const target = await safePath(manifestBase, entry.path)
    const digest = await shaFile(target)
    if (digest !== entry.sha256) {
      throw new Error(`Script sha256 mismatch for ${entry.id}`)
    }
    return {
      id: entry.id,
      path: target,
      sha256: digest,
    }
  },
}
