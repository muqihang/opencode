import fs from "fs/promises"
import path from "path"
import z from "zod"
import { Instance } from "@/project/instance"
import { Filesystem } from "@/util/filesystem"
import { Identifier } from "@/id/id"
import { EvidencePack } from "@/protocol/evidence-pack"
import { EvidenceManifest } from "@/protocol/evidence-manifest"
import { EventV1 } from "@/protocol/event"
import { renderEvidencePackViewMarkdown } from "@/evidence/pack-view"
import { stableJson } from "@/util/stable-json"

const OpenInput = z
  .object({
    sessionId: z.string().min(1),
  })
  .strict()

const ArtifactInput = z
  .object({
    kind: z.string().min(1),
    path: z.string().min(1).optional(),
    data: z.string(),
  })
  .strict()

const PackInput = z
  .object({
    handoff: z.string().min(1),
    execution: z
      .object({
        id: z.string().min(1),
        kind: z.string().min(1),
        backend: z.enum(["soft", "hard"]).optional(),
        enforcement: z.enum(["soft", "hard"]).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

const Entry = z
  .object({
    path: z.string().min(1),
    sha256: z.string().min(1),
    kind: z.string().min(1),
    size: z.number().int().nonnegative().optional(),
  })
  .strict()

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

async function writeAtomic(file: string, data: string) {
  const dir = path.dirname(file)
  await fs.mkdir(dir, { recursive: true })
  const tmp = `${file}.${Identifier.ascending("tmp")}.tmp`
  await Bun.write(tmp, data)
  const hash = sha(data)
  const size = Buffer.byteLength(data, "utf-8")
  await fs.rename(tmp, file)
  return { hash, size }
}

async function readManifest(file: string, packId: string) {
  const text = await Bun.file(file).text().catch(() => "")
  if (!text) {
    return EvidenceManifest.parse({
      specVersion: "evidence-manifest/1.0",
      packId,
      generatedAtUtc: new Date().toISOString(),
      entries: [],
    })
  }
  const data = JSON.parse(text) as unknown
  return EvidenceManifest.parse(data)
}

export const EvidenceWriter = {
  async open(input: z.infer<typeof OpenInput>) {
    OpenInput.parse(input)
    const sessionId = input.sessionId
    const base = Instance.worktree === "/" ? Instance.directory : Instance.worktree
    const root = path.join(base, ".opencode")
    const evidence = path.join(root, "evidence", sessionId)
    const artifacts = path.join(root, "artifacts", sessionId)
    const eventsPath = path.join(evidence, "events.jsonl")
    const manifestPath = path.join(evidence, "manifest.json")
    const packPath = path.join(evidence, "pack.json")
    const packViewPath = path.join(evidence, "pack.md")

    await fs.mkdir(evidence, { recursive: true })
    await fs.mkdir(artifacts, { recursive: true })

    const packId = `EP-${sessionId}`
    const manifestData = await readManifest(manifestPath, packId)
    const entries = [...manifestData.entries]
    const events: Array<z.infer<typeof EventV1>> = []

    async function writeManifest(packId: string) {
      const manifest = EvidenceManifest.parse({
        specVersion: "evidence-manifest/1.0",
        packId,
        generatedAtUtc: new Date().toISOString(),
        entries,
      })
      await writeAtomic(manifestPath, stableJson(manifest))
      return manifest
    }

    async function upsert(entry: z.infer<typeof Entry>, packId: string) {
      const hit = entries.findIndex((item) => item.path === entry.path)
      if (hit >= 0) {
        entries[hit] = entry
      } else {
        entries.push(entry)
      }
      return writeManifest(packId)
    }

    async function event(inputEvent: z.infer<typeof EventV1>) {
      const eventData = EventV1.parse(inputEvent)
      events.push(eventData)
      await fs.mkdir(path.dirname(eventsPath), { recursive: true })
      await fs.appendFile(eventsPath, JSON.stringify(eventData) + "\n")
      const text = await Bun.file(eventsPath).text()
      const hash = sha(text)
      const size = Buffer.byteLength(text, "utf-8")
      await upsert(
        Entry.parse({
          path: path.relative(base, eventsPath),
          sha256: hash,
          kind: "event-log",
          size,
        }),
        packId,
      )
    }

    async function artifact(inputArtifact: z.infer<typeof ArtifactInput>) {
      const data = ArtifactInput.parse(inputArtifact)
      const name = data.path ?? `${Identifier.ascending("artifact")}.txt`
      const target = await safePath(artifacts, name)
      const result = await writeAtomic(target, data.data)
      const entry = Entry.parse({
        path: path.relative(base, target),
        sha256: result.hash,
        kind: data.kind,
        size: result.size,
      })
      await upsert(entry, packId)
      return entry
    }

    async function readEventsFromDisk() {
      const text = await Bun.file(eventsPath).text().catch(() => "")
      if (!text) return []
      return text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const data = JSON.parse(line) as unknown
          return EventV1.parse(data)
        })
    }

    async function pack(inputPack: z.infer<typeof PackInput>) {
      const data = PackInput.parse(inputPack)
      const packId = `EP-${sessionId}`
      const execution = data.execution ?? {
        kind: "sandbox",
        id: `sandbox:${sessionId}`,
      }
      const eventsFromDisk = await readEventsFromDisk()
      const pack = EvidencePack.parse({
        specVersion: "evidence-pack/1.0",
        packId,
        task: {
          title: "User request",
          intent: "P0 sandbox",
          successCriteria: ["evidence written"],
        },
        environment: {
          execution: {
            kind: execution.kind,
            id: execution.id,
            backend: execution.backend,
            enforcement: execution.enforcement,
          },
        },
        claims: [],
        artifacts: [],
        checks: [],
        events: eventsFromDisk,
        capsule: {
          handoff: data.handoff,
          pointers: [],
          openQuestions: [],
        },
        risks: [],
        rollback: {
          strategy: "none",
          steps: [],
        },
      })
      const packText = stableJson(pack)
      const packWrite = await writeAtomic(packPath, packText)
      await upsert(
        Entry.parse({
          path: path.relative(base, packPath),
          sha256: packWrite.hash,
          kind: "evidence-pack",
          size: packWrite.size,
        }),
        packId,
      )
      const pointers = entries
        .filter((entry) => ["event-log", "stdout", "stderr"].includes(entry.kind))
        .map((entry) => ({
          kind: entry.kind,
          path: entry.path,
          sha256: entry.sha256,
        }))
      const packView = renderEvidencePackViewMarkdown({
        sessionId,
        packId,
        backend: execution.backend ?? "soft",
        enforcement: execution.enforcement ?? "soft",
        pointers,
      })
      const packViewWrite = await writeAtomic(packViewPath, packView)
      await upsert(
        Entry.parse({
          path: path.relative(base, packViewPath),
          sha256: packViewWrite.hash,
          kind: "evidence-view",
          size: packViewWrite.size,
        }),
        packId,
      )
      return pack
    }

    async function manifest() {
      return writeManifest(packId)
    }

    return {
      event,
      artifact,
      pack,
      manifest,
    }
  },
}
