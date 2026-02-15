import fs from "fs/promises"
import path from "path"
import z from "zod"
import { Instance } from "@/project/instance"
import { Filesystem } from "@/util/filesystem"
import { Identifier } from "@/id/id"
import { EvidencePack } from "@/protocol/evidence-pack"
import type { EvidencePack as EvidencePackType } from "@/protocol/evidence-pack"
import {
  EvidenceManifest,
  appendManifestEntry,
  latestManifestEntries,
  upgradeManifestEntries,
  validateManifestEntries,
} from "@/protocol/evidence-manifest"
import { EventV1 } from "@/protocol/event"
import { EvidenceMicroPack } from "@/protocol/evidence-micro-pack"
import { renderEvidencePackViewMarkdown } from "@/evidence/pack-view"
import { stableJson } from "@/util/stable-json"
import { TurnTraceContext } from "@/util/turn-trace"
import {
  isA2TenantNamespaceEnabled,
  resolveTenantScope,
} from "@/util/tenant-context"
import { resolveMirrorPath, resolveStorageLayering } from "@/evidence/storage-layering"

const OpenInput = z
  .object({
    sessionId: z.string().min(1),
    tenantId: z.string().min(1).optional(),
    orgId: z.string().min(1).optional(),
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

const PointerInput = z.union([
  z.string().min(1),
  z
    .object({
      kind: z.string().min(1),
      ref: z.string().min(1),
      label: z.string().min(1).optional(),
    })
    .strict(),
])

const CapsuleInput = z
  .object({
    pointers: z.array(PointerInput),
    openQuestions: z.array(z.string().min(1)),
  })
  .strict()

const TaskInput = z
  .object({
    title: z.string().min(1),
    intent: z.string().min(1),
    successCriteria: z.array(z.string().min(1)),
    constraints: z.array(z.string().min(1)).optional(),
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

function normalizePath(value: string) {
  return value.replace(/\\/g, "/")
}

function toRelativePath(raw: string) {
  if (!path.isAbsolute(raw)) return raw
  const root = path.parse(raw).root || "/"
  return path.relative(root, raw)
}

function pointerPath(sessionPrefix: string, entryPath: string) {
  if (entryPath.startsWith(".opencode/") || entryPath.startsWith(".opencode\\")) {
    return entryPath
  }
  const normalized = normalizePath(entryPath)
  return `${sessionPrefix}${normalized}`
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
  const manifest = EvidenceManifest.parse(data)
  const checked = validateManifestEntries(manifest.entries)
  if (checked.state === "legacy") return manifest
  return {
    ...manifest,
    entries: checked.entries,
  }
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
    const scope = resolveTenantScope({ tenantId: input.tenantId, orgId: input.orgId })
    const namespaced = isA2TenantNamespaceEnabled()
    const base = Instance.worktree === "/" ? Instance.directory : Instance.worktree
    const layering = resolveStorageLayering({
      base,
      sessionId,
      tenantId: scope.tenantId,
      orgId: scope.orgId,
      namespaced,
    })
    const root = path.join(base, ".opencode")
    const evidence = layering.primary.evidenceDir
    const artifacts = layering.primary.artifactDir
    const evidencePrefix = layering.primary.evidencePrefix
    const artifactPrefix = layering.primary.artifactPrefix
    const eventsPath = path.join(evidence, "events.jsonl")
    const manifestPath = path.join(evidence, "manifest.json")
    const packPath = path.join(evidence, "pack.json")
    const packViewPath = path.join(evidence, "pack.md")

    await fs.mkdir(root, { recursive: true })
    await fs.mkdir(evidence, { recursive: true })
    await fs.mkdir(artifacts, { recursive: true })

    const packId = `EP-${sessionId}`
    const manifestData = await readManifest(manifestPath, packId)
    const seed = validateManifestEntries(manifestData.entries)
    const entries = seed.state === "legacy" ? upgradeManifestEntries(seed.entries) : [...seed.entries]
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

    async function writeDual(file: string, data: string | Uint8Array) {
      const result = await writeAtomic(file, data)
      const mirror = layering.mirror
      if (!mirror) return result

      const relative = normalizePath(path.relative(base, file))
      const mirrorPath = resolveMirrorPath({
        sourcePath: relative,
        primary: layering.primary,
        mirror,
      })
      if (!mirrorPath) return result

      await writeAtomic(mirrorPath, data)
      return result
    }

    async function appendDual(file: string, line: string) {
      await fs.mkdir(path.dirname(file), { recursive: true })
      await fs.appendFile(file, line)

      const mirror = layering.mirror
      if (!mirror) return

      const relative = normalizePath(path.relative(base, file))
      const mirrorPath = resolveMirrorPath({
        sourcePath: relative,
        primary: layering.primary,
        mirror,
      })
      if (!mirrorPath) return

      await fs.mkdir(path.dirname(mirrorPath), { recursive: true })
      await fs.appendFile(mirrorPath, line)
    }

    async function writeManifest(packId: string) {
      const checked = validateManifestEntries(entries)
      const chain = checked.state === "legacy" ? upgradeManifestEntries(checked.entries) : checked.entries
      if (chain !== entries) {
        entries.splice(0, entries.length, ...chain)
      }
      const manifest = EvidenceManifest.parse({
        specVersion: "evidence-manifest/1.0",
        packId,
        generatedAtUtc: new Date().toISOString(),
        entries: [...entries],
      })
      await writeDual(manifestPath, stableJson(manifest))
      return manifest
    }

    async function append(entry: z.infer<typeof Entry>, packId: string) {
      const next = appendManifestEntry({
        entries,
        entry: {
          path: entry.path,
          sha256: entry.sha256,
          kind: entry.kind,
          size: entry.size,
        },
      })
      entries.splice(0, entries.length, ...next)
      return writeManifest(packId)
    }

    async function event(inputEvent: z.infer<typeof EventV1>) {
      try {
        const context = TurnTraceContext.get()
        const data = inputEvent.data ?? {}
        const hasMessageId = Object.prototype.hasOwnProperty.call(data, "messageId")
        const eventData = EventV1.parse({
          ...inputEvent,
          tenantId: inputEvent.tenantId ?? scope.tenantId,
          orgId: inputEvent.orgId ?? scope.orgId,
          traceId: inputEvent.traceId ?? context?.traceId,
          data: context?.messageId && !hasMessageId ? { ...data, messageId: context.messageId } : inputEvent.data,
        })
        events.push(eventData)
        await appendDual(eventsPath, JSON.stringify(eventData) + "\n")
        const text = await Bun.file(eventsPath).text()
        const hash = sha(text)
        const size = Buffer.byteLength(text, "utf-8")
        await append(
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
          tenantId: scope.tenantId,
          orgId: scope.orgId,
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
        await appendDual(eventsPath, JSON.stringify(violation) + "\n")
        const text = await Bun.file(eventsPath).text()
        const hash = sha(text)
        const size = Buffer.byteLength(text, "utf-8")
        await append(
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
        const result = await writeDual(target, data.data)
        const manifestPath = data.manifestPath
          ? safeManifestPath(data.manifestPath)
          : path.relative(base, target)
        const entry = Entry.parse({
          path: manifestPath,
          sha256: result.hash,
          kind: data.kind,
          size: result.size,
        })
        await append(entry, packId)
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
        const failureWrite = await writeDual(failurePath, failureData)
        const failureEntry = Entry.parse({
          path: path.relative(base, failurePath),
          sha256: failureWrite.hash,
          kind: "evidence-error",
          size: failureWrite.size,
        })
        await append(failureEntry, packId)
        await event({
          specVersion: "event/1.0",
          ts: new Date().toISOString(),
          sessionId,
          tenantId: scope.tenantId,
          orgId: scope.orgId,
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

    async function findUp(dir: string, name: string, depth: number): Promise<string | undefined> {
      const file = path.join(dir, name)
      const stat = await fs.stat(file).catch(() => null)
      if (stat?.isFile()) return file
      if (depth <= 0) return undefined
      const parent = path.dirname(dir)
      if (parent === dir) return undefined
      return findUp(parent, name, depth - 1)
    }

    async function attachUpstreamLock() {
      const has = entries.some((entry) => entry.kind === "upstream-lock")
      if (has) return

      const found = await findUp(base, "UPSTREAM.lock.json", 6)
      if (!found) return

      const bytes = await Bun.file(found).bytes()
      const entry = await artifact({
        kind: "upstream-lock",
        path: "environment/upstream.lock.json",
        data: bytes,
      })
      await event({
        specVersion: "event/1.0",
        ts: new Date().toISOString(),
        sessionId,
        tenantId: scope.tenantId,
        orgId: scope.orgId,
        severity: "info",
        actor: "evidence:writer",
        type: "evidence.upstream_lock_attached",
        summary: "upstream lockfile attached",
        data: { artifact: entry.path },
        redaction: { applied: true, policyVersion: "v1" },
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
      await attachUpstreamLock()
      const eventsFromDisk = await readEventsFromDisk()
      const current = latestManifestEntries(entries)
      const artifactEntries = current.filter((entry) =>
        entry.path.replace(/\\/g, "/").startsWith(artifactPrefix),
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
      const packWrite = await writeDual(packPath, packText)
      await append(
        Entry.parse({
          path: path.relative(base, packPath),
          sha256: packWrite.hash,
          kind: "evidence-pack",
          size: packWrite.size,
        }),
        packId,
      )
      const pointers = current
        .filter((entry) =>
          ["event-log", "stdout", "stderr", "execpolicy-eval", "worktree-patch"].includes(
            entry.kind,
          ),
        )
        .map((entry) => ({
          kind: entry.kind,
          path: pointerPath(artifactPrefix, entry.path),
          sha256: entry.sha256,
        }))
      const packView = renderEvidencePackViewMarkdown({
        sessionId,
        packId,
        backend: execution.backend ?? "soft",
        enforcement: execution.enforcement ?? "soft",
        pointers,
      })
      const packViewWrite = await writeDual(packViewPath, packView)
      await append(
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
          latestManifestEntries(entries).map((entry) => ({
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
      const microWrite = await writeDual(microPath, microText)
      await append(
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

    async function reconcile() {
      const tracked = new Map(entries.map((entry) => [normalizePath(entry.path), entry.sha256]))
      const rootEvidence = [eventsPath, manifestPath, packPath, packViewPath, path.join(evidence, "micro-pack.json")]
      const all = new Set(tracked.keys())

      for (const file of rootEvidence) {
        const exists = await Bun.file(file).exists()
        if (!exists) continue
        all.add(normalizePath(path.relative(base, file)))
      }

      const rows = [] as Array<{
        path: string
        primaryPath: string
        mirrorPath?: string
        expectedSha256?: string
        primarySha256?: string
        mirrorSha256?: string
        status: "match" | "mismatch" | "missing_primary" | "missing_mirror" | "mirror_disabled" | "unmapped"
        match: boolean
      }>

      for (const rel of [...all].sort()) {
        const primaryPath = path.join(base, ...rel.split("/"))
        const mirrorPath = layering.mirror
          ? resolveMirrorPath({
              sourcePath: rel,
              primary: layering.primary,
              mirror: layering.mirror,
            })
          : undefined
        const expectedSha256 = tracked.get(rel)

        const primaryExists = await Bun.file(primaryPath).exists()
        const mirrorExists = mirrorPath ? await Bun.file(mirrorPath).exists() : false
        const primarySha256 = primaryExists ? sha(await Bun.file(primaryPath).bytes()) : undefined
        const mirrorSha256 = mirrorExists && mirrorPath ? sha(await Bun.file(mirrorPath).bytes()) : undefined

        if (!layering.mirror) {
          rows.push({
            path: rel,
            primaryPath,
            expectedSha256,
            primarySha256,
            status: "mirror_disabled",
            match: true,
          })
          continue
        }

        if (!mirrorPath) {
          rows.push({
            path: rel,
            primaryPath,
            expectedSha256,
            primarySha256,
            status: "unmapped",
            match: true,
          })
          continue
        }

        if (!primaryExists) {
          rows.push({
            path: rel,
            primaryPath,
            mirrorPath,
            expectedSha256,
            mirrorSha256,
            status: "missing_primary",
            match: false,
          })
          continue
        }

        if (!mirrorExists) {
          rows.push({
            path: rel,
            primaryPath,
            mirrorPath,
            expectedSha256,
            primarySha256,
            status: "missing_mirror",
            match: false,
          })
          continue
        }

        const expectedMismatch = expectedSha256 && expectedSha256 !== primarySha256
        if (expectedMismatch) {
          rows.push({
            path: rel,
            primaryPath,
            mirrorPath,
            expectedSha256,
            primarySha256,
            mirrorSha256,
            status: "mismatch",
            match: false,
          })
          continue
        }

        const matched = primarySha256 === mirrorSha256
        rows.push({
          path: rel,
          primaryPath,
          mirrorPath,
          expectedSha256,
          primarySha256,
          mirrorSha256,
          status: matched ? "match" : "mismatch",
          match: matched,
        })
      }

      const report = {
        specVersion: "storage-dual-write-reconcile/1.0",
        generatedAtUtc: new Date().toISOString(),
        sessionId,
        mode: layering.mode,
        primary: layering.primary.layer,
        mirror: layering.mirror?.layer,
        switch: layering.migration,
        summary: {
          total: rows.length,
          matched: rows.filter((row) => row.match).length,
          mismatched: rows.filter((row) => !row.match).length,
        },
        results: rows,
      }

      if (layering.reconcile.enabled) {
        await writeDual(layering.reconcile.reportPath, stableJson(report))
      }

      return report
    }

    return {
      event,
      artifact,
      capsule: (inputCapsule: z.infer<typeof CapsuleInput>) => {
        const next = CapsuleInput.parse(inputCapsule)
        capsule = { ...capsule, pointers: next.pointers, openQuestions: next.openQuestions }
        return capsule
      },
      task: (inputTask: z.infer<typeof TaskInput>) => {
        const next = TaskInput.parse(inputTask)
        task = next
        return task
      },
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
      reconcile,
    }
  },
}
