import fs from "fs/promises"
import path from "path"
import z from "zod"
import { Instance } from "@/project/instance"
import { Filesystem } from "@/util/filesystem"
import { Identifier } from "@/id/id"
import { EvidencePack } from "@/protocol/evidence-pack"
import type { EvidencePack as EvidencePackType } from "@/protocol/evidence-pack"
import { EvidenceManifest } from "@/protocol/evidence-manifest"
import { EventV1 } from "@/protocol/event"
import { EvidenceMicroPack } from "@/protocol/evidence-micro-pack"
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
    manifestPath: z.string().min(1).optional(),
    data: z.union([z.string(), z.instanceof(Uint8Array)]),
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
    environment: z
      .object({
        os: z
          .object({
            platform: z.string().min(1),
            arch: z.string().min(1),
            release: z.string().min(1).optional(),
          })
          .strict()
          .optional(),
        runtime: z
          .object({
            node: z.string().min(1).optional(),
            bun: z.string().min(1).optional(),
          })
          .strict()
          .optional(),
        repo: z
          .object({
            root: z.string().min(1).optional(),
            worktree: z.string().min(1).optional(),
            commit: z.string().min(1),
            dirty: z.boolean(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

const MicroPackInput = z
  .object({
    parentSessionId: z.string().min(1).optional(),
  })
  .strict()

const ClaimInput = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
    statement: z.string().min(1),
    evidence: z.array(z.string().min(1)),
    verification: z.array(z.string().min(1)).optional(),
    confidence: z.number().min(0).max(1).optional(),
  })
  .strict()

const CheckInput = z
  .object({
    id: z.string().min(1),
    command: z.string().min(1),
    status: z.enum(["pass", "fail", "skip"]),
    artifact: z.string().min(1).optional(),
  })
  .strict()

const RiskInput = z
  .object({
    summary: z.string().min(1),
    evidence: z.array(z.string().min(1)).optional(),
  })
  .strict()

const RollbackInput = z
  .object({
    strategy: z.string().min(1),
    steps: z.array(z.string().min(1)),
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

function sha(input: string | Uint8Array) {
  const hash = new Bun.CryptoHasher("sha256")
  if (typeof input === "string") {
    hash.update(input)
    return hash.digest("hex")
  }
  hash.update(Buffer.from(input))
  return hash.digest("hex")
}

function toRelativePath(raw: string) {
  if (!path.isAbsolute(raw)) return raw
  const root = path.parse(raw).root || "/"
  return path.relative(root, raw)
}

function pointerPath(sessionId: string, entryPath: string) {
  if (entryPath.startsWith(".opencode/") || entryPath.startsWith(".opencode\\")) {
    return entryPath
  }
  const normalized = entryPath.replace(/\\/g, "/")
  return `.opencode/artifacts/${sessionId}/${normalized}`
}

function isTraversal(rel: string) {
  if (path.isAbsolute(rel)) return true
  const parts = rel.split(path.sep)
  return parts.includes("..")
}

function safeManifestPath(rel: string) {
  if (isTraversal(rel)) {
    throw new Error("Manifest path traversal is not allowed")
  }
  if (path.isAbsolute(rel)) {
    throw new Error("Manifest path must be relative")
  }
  return rel
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

async function writeAtomic(file: string, data: string | Uint8Array) {
  const dir = path.dirname(file)
  await fs.mkdir(dir, { recursive: true })
  const tmp = `${file}.${Identifier.ascending("tool")}.tmp`
  await Bun.write(tmp, data)
  const hash = sha(data)
  const size = typeof data === "string" ? Buffer.byteLength(data, "utf-8") : data.byteLength
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

type Claim = EvidencePackType["claims"][number]
type Check = EvidencePackType["checks"][number]
type Risk = EvidencePackType["risks"][number]
type Rollback = EvidencePackType["rollback"]
type Capsule = EvidencePackType["capsule"]

function sortClaims(items: Claim[]) {
  return [...items].sort((a, b) => a.id.localeCompare(b.id))
}

function sortChecks(items: Check[]) {
  return [...items].sort((a, b) => a.id.localeCompare(b.id))
}

function sortRisks(items: Risk[]) {
  return [...items].sort((a, b) => {
    const summary = a.summary.localeCompare(b.summary)
    if (summary !== 0) return summary
    const left = (a.evidence ?? []).join("|")
    const right = (b.evidence ?? []).join("|")
    return left.localeCompare(right)
  })
}

function sortArtifacts<T extends { sha256?: string; path: string }>(items: T[]) {
  return [...items].sort((a, b) => {
    const shaA = a.sha256 ?? ""
    const shaB = b.sha256 ?? ""
    if (shaA !== shaB) return shaA.localeCompare(shaB)
    return a.path.localeCompare(b.path)
  })
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
    let claims: Claim[] = []
    let checks: Check[] = []
    let risks: Risk[] = []
    let rollback: Rollback = { strategy: "none", steps: [] }
    let capsule: Capsule = { handoff: "", pointers: [], openQuestions: [] }
    let task: EvidencePackType["task"] = {
      title: "User request",
      intent: "P0 sandbox",
      successCriteria: ["evidence written"],
    }
    let environment: EvidencePackType["environment"] | undefined = undefined

    const existingPackText = await Bun.file(packPath).text().catch(() => "")
    if (existingPackText) {
      const parsed = EvidencePack.parse(JSON.parse(existingPackText))
      claims = [...parsed.claims]
      checks = [...parsed.checks]
      risks = [...parsed.risks]
      rollback = parsed.rollback
      capsule = parsed.capsule
      task = parsed.task
      environment = parsed.environment
    }

    async function writeManifest(packId: string) {
      const sortedEntries = [...entries].sort((a, b) => a.path.localeCompare(b.path))
      const manifest = EvidenceManifest.parse({
        specVersion: "evidence-manifest/1.0",
        packId,
        generatedAtUtc: new Date().toISOString(),
        entries: sortedEntries,
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
      try {
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
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const rawInput = (() => {
          try {
            return JSON.stringify(inputEvent)
          } catch {
            return String(inputEvent)
          }
        })()
        const errorEntry = await artifact({
          kind: "protocol-violation",
          path: `errors/protocol-violation-${Identifier.ascending("tool")}.json`,
          data: stableJson({ error: message, input: rawInput }),
        })
        const violation = EventV1.parse({
          specVersion: "event/1.0",
          ts: new Date().toISOString(),
          sessionId,
          severity: "error",
          actor: "evidence:writer",
          type: "protocol.violation",
          summary: "invalid event rejected",
          data: {
            error: message,
            artifact: errorEntry.path,
          },
          redaction: { applied: true, policyVersion: "v1" },
        })
        events.push(violation)
        await fs.mkdir(path.dirname(eventsPath), { recursive: true })
        await fs.appendFile(eventsPath, JSON.stringify(violation) + "\n")
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
        throw error instanceof Error ? error : new Error(String(error))
      }
    }

    async function artifact(inputArtifact: z.infer<typeof ArtifactInput>) {
      const data = ArtifactInput.parse(inputArtifact)
      const name = data.path ?? `${Identifier.ascending("tool")}.txt`
      const requestedPath = toRelativePath(name)
      try {
        const target = await safePath(artifacts, name)
        const result = await writeAtomic(target, data.data)
        const manifestPath = data.manifestPath
          ? safeManifestPath(data.manifestPath)
          : path.relative(base, target)
        const entry = Entry.parse({
          path: manifestPath,
          sha256: result.hash,
          kind: data.kind,
          size: result.size,
        })
        await upsert(entry, packId)
        return entry
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const failurePath = path.join(
          artifacts,
          `errors/write-failed-${Identifier.ascending("tool")}.json`,
        )
        const failureData = stableJson({
          error: message,
          kind: data.kind,
          requested_path: requestedPath,
        })
        const failureWrite = await writeAtomic(failurePath, failureData)
        const failureEntry = Entry.parse({
          path: path.relative(base, failurePath),
          sha256: failureWrite.hash,
          kind: "evidence-error",
          size: failureWrite.size,
        })
        await upsert(failureEntry, packId)
        await event({
          specVersion: "event/1.0",
          ts: new Date().toISOString(),
          sessionId,
          severity: "error",
          actor: "evidence:writer",
          type: "evidence.write_failed",
          summary: "artifact rejected",
          data: {
            kind: data.kind,
            requested_path: requestedPath,
            error_artifact: failureEntry.path,
          },
          redaction: { applied: true, policyVersion: "v1" },
        })
        throw error instanceof Error ? error : new Error(String(error))
      }
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
      const execution =
        data.execution ??
        environment?.execution ?? {
          kind: "sandbox",
          id: `sandbox:${sessionId}`,
        }
      const eventsFromDisk = await readEventsFromDisk()
      const artifactEntries = entries.filter((entry) =>
        entry.path.replace(/\\/g, "/").startsWith(`.opencode/artifacts/${sessionId}/`),
      )
      const artifacts = sortArtifacts(
        artifactEntries.map((entry) => ({
          id: `artifact:${entry.sha256}`,
          kind: entry.kind,
          path: entry.path,
          sha256: entry.sha256,
        })),
      )

      const pack = EvidencePack.parse({
        specVersion: "evidence-pack/1.0",
        packId,
        task,
        environment: {
          execution: {
            kind: execution.kind,
            id: execution.id,
            backend: execution.backend ?? environment?.execution.backend,
            enforcement: execution.enforcement ?? environment?.execution.enforcement,
          },
          os: data.environment?.os ?? environment?.os,
          runtime: data.environment?.runtime ?? environment?.runtime,
          repo: data.environment?.repo ?? environment?.repo,
        },
        claims: sortClaims(claims),
        artifacts,
        checks: sortChecks(checks),
        events: eventsFromDisk,
        capsule: {
          handoff: data.handoff,
          pointers: capsule.pointers,
          openQuestions: capsule.openQuestions,
        },
        risks: sortRisks(risks),
        rollback,
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
        .filter((entry) =>
          ["event-log", "stdout", "stderr", "execpolicy-eval", "worktree-patch"].includes(
            entry.kind,
          ),
        )
        .map((entry) => ({
          kind: entry.kind,
          path: pointerPath(sessionId, entry.path),
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

    async function microPack(input: z.infer<typeof MicroPackInput>) {
      const data = MicroPackInput.parse(input)
      const microPackId = `MP-${sessionId}`
      const eventsFromDisk = await readEventsFromDisk()
      const micro = EvidenceMicroPack.parse({
        specVersion: "evidence-micro-pack/1.0",
        packId: microPackId,
        sessionId,
        parentSessionId: data.parentSessionId,
        generatedAtUtc: new Date().toISOString(),
        artifacts: sortArtifacts(
          entries.map((entry) => ({
            path: entry.path,
            sha256: entry.sha256,
            kind: entry.kind,
            size: entry.size,
          })),
        ),
        claims: sortClaims(claims),
        checks: sortChecks(checks),
        events: eventsFromDisk,
      })
      const microPath = path.join(evidence, "micro-pack.json")
      const microText = stableJson(micro)
      const microWrite = await writeAtomic(microPath, microText)
      await upsert(
        Entry.parse({
          path: path.relative(base, microPath),
          sha256: microWrite.hash,
          kind: "evidence-micro-pack",
          size: microWrite.size,
        }),
        packId,
      )
      return micro
    }

    async function manifest() {
      return writeManifest(packId)
    }

    return {
      event,
      artifact,
      claim: async (inputClaim: z.infer<typeof ClaimInput>) => {
        const claim = ClaimInput.parse(inputClaim)
        const index = claims.findIndex((item) => item.id === claim.id)
        if (index >= 0) {
          claims[index] = claim
        } else {
          claims.push(claim)
        }
        return claim
      },
      check: async (inputCheck: z.infer<typeof CheckInput>) => {
        const check = CheckInput.parse(inputCheck)
        const index = checks.findIndex((item) => item.id === check.id)
        if (index >= 0) {
          checks[index] = check
        } else {
          checks.push(check)
        }
        return check
      },
      risk: async (inputRisk: z.infer<typeof RiskInput>) => {
        const risk = RiskInput.parse(inputRisk)
        const index = risks.findIndex((item) => item.summary === risk.summary)
        if (index >= 0) {
          risks[index] = risk
        } else {
          risks.push(risk)
        }
        return risk
      },
      rollback: async (inputRollback: z.infer<typeof RollbackInput>) => {
        const next = RollbackInput.parse(inputRollback)
        rollback = next
        return rollback
      },
      pack,
      microPack,
      manifest,
    }
  },
}
