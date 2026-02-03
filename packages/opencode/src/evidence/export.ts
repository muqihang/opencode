import fs from "fs/promises"
import path from "path"
import z from "zod"
import { EvidenceManifest } from "@/protocol/evidence-manifest"
import { Instance } from "@/project/instance"
import { Filesystem } from "@/util/filesystem"
import { EvidenceWriter } from "@/evidence/writer"

const ExportInput = z
  .object({
    sessionId: z.string().min(1),
    outDir: z.string().min(1),
  })
  .strict()

const ALLOWLIST_KINDS = new Set([
  "evidence-pack",
  "evidence-view",
  "evidence-manifest",
  "event-log",
  "execpolicy-eval",
  "worktree-patch",
  "compaction-capsule-assisted",
  "compaction-capsule-assisted-view",
  "compaction-capsule-assisted-verify",
])

const EVIDENCE_FILES = new Set(["pack.json", "pack.md", "manifest.json", "events.jsonl", "micro-pack.json"])

function normalizeRel(p: string) {
  const normalized = p.replace(/\\/g, "/")
  if (/^[a-zA-Z]:/.test(normalized)) {
    throw new Error("Absolute paths are not allowed")
  }
  if (normalized.split("/").some((part) => part === "..")) {
    throw new Error("Path traversal is not allowed")
  }
  if (path.posix.isAbsolute(normalized)) {
    throw new Error("Absolute paths are not allowed")
  }
  return normalized
}

async function rejectSymlinkChain(target: string) {
  const resolved = path.resolve(target)
  const root = path.parse(resolved).root
  const parts = resolved.slice(root.length).split(path.sep).filter(Boolean)
  let current = root
  for (const part of parts) {
    current = path.join(current, part)
    const stat = await fs.lstat(current)
    if (stat.isSymbolicLink()) {
      throw new Error("Symlink targets are not allowed")
    }
  }
}

async function sha256File(filePath: string) {
  const hasher = new Bun.CryptoHasher("sha256")
  const data = await Bun.file(filePath).arrayBuffer()
  hasher.update(Buffer.from(data))
  return hasher.digest("hex")
}

async function copyChecked(options: {
  base: string
  sourcePath: string
  destinationPath: string
  expectedSha?: string
}) {
  const existing = await fs.lstat(options.destinationPath).catch(() => null)
  if (existing?.isSymbolicLink()) {
    throw new Error("Symlink targets are not allowed")
  }
  if (!Filesystem.contains(options.base, options.sourcePath)) {
    throw new Error("Source path outside repository")
  }
  await rejectSymlinkChain(options.sourcePath)

  if (options.expectedSha) {
    const actualHash = await sha256File(options.sourcePath)
    if (actualHash !== options.expectedSha) {
      throw new Error(`SHA256 mismatch for ${options.sourcePath}`)
    }
  }

  await fs.mkdir(path.dirname(options.destinationPath), { recursive: true })
  await rejectSymlinkChain(path.dirname(options.destinationPath))
  await fs.copyFile(options.sourcePath, options.destinationPath)
}

function evidenceEntryPath(sessionId: string, filename: string) {
  return `.opencode/evidence/${sessionId}/${filename}`
}

async function writeExportEvent(
  writer: Awaited<ReturnType<typeof EvidenceWriter.open>>,
  sessionId: string,
  input: { type: string; summary: string; data?: Record<string, unknown> },
) {
  try {
    await writer.event({
      specVersion: "event/1.0",
      ts: new Date().toISOString(),
      sessionId,
      severity: input.type.endsWith("failed") ? "error" : "info",
      actor: "evidence:export",
      type: input.type,
      summary: input.summary,
      data: input.data,
      redaction: { applied: true, policyVersion: "v1" },
    })
  } catch {
    // best-effort: ignore export event failures
  }
}

function classifyEntry(entry: { path: string; sessionId: string }) {
  const normalized = normalizeRel(entry.path)
  const parts = normalized.split("/")
  if (parts[0] === ".opencode" && parts[1] === "evidence" && parts[2] === entry.sessionId) {
    const filename = parts[parts.length - 1]
    if (EVIDENCE_FILES.has(filename)) {
      return { kind: "evidence", rel: filename }
    }
  }
  if (parts[0] === ".opencode" && parts[1] === "artifacts" && parts[2] === entry.sessionId) {
    const rel = parts.slice(3).join("/")
    if (rel.startsWith("policy/") || rel.startsWith("worktree/")) {
      return { kind: "artifact", rel }
    }
    if (
      rel.startsWith("compaction/") &&
      (rel.endsWith("/capsule.assisted.md") || rel.endsWith("/capsule.assisted.json") || rel.endsWith("/capsule.assisted.verify.json"))
    ) {
      return { kind: "artifact", rel }
    }
    return null
  }
  if (parts[0] === "policy" || parts[0] === "worktree") {
    return { kind: "artifact", rel: normalized }
  }
  return null
}

export async function exportEvidence(input: z.infer<typeof ExportInput>) {
  const data = ExportInput.parse(input)
  const writer = await EvidenceWriter.open({ sessionId: data.sessionId })

  const base = Instance.worktree === "/" ? Instance.directory : Instance.worktree
  const evidenceDir = path.join(base, ".opencode", "evidence", data.sessionId)
  const manifestPath = path.join(evidenceDir, "manifest.json")
  const outDir = path.resolve(base, data.outDir)

  await writeExportEvent(writer, data.sessionId, {
    type: "evidence.export_started",
    summary: "evidence export started",
    data: { outDir },
  })

  try {
    const manifestData = JSON.parse(await Bun.file(manifestPath).text()) as unknown
    const manifest = EvidenceManifest.parse(manifestData)

    await fs.mkdir(outDir, { recursive: true })
    await rejectSymlinkChain(outDir)

    const exportedEvidence = new Set<string>()

    let exported = 0
    for (const entry of manifest.entries) {
      if (!ALLOWLIST_KINDS.has(entry.kind)) continue
      const normalized = normalizeRel(entry.path)
      const classification = classifyEntry({ path: normalized, sessionId: data.sessionId })
      if (!classification) continue

      let sourcePath: string
      let destinationPath: string
      if (classification.kind === "evidence") {
        sourcePath = path.join(evidenceDir, classification.rel)
        destinationPath = path.join(outDir, classification.rel)
        exportedEvidence.add(classification.rel)
      } else {
        sourcePath = path.join(base, ".opencode", "artifacts", data.sessionId, classification.rel)
        destinationPath = path.join(outDir, "artifacts", classification.rel)
      }

      await copyChecked({
        base,
        sourcePath,
        destinationPath,
        expectedSha: entry.sha256,
      })
      exported += 1
    }

    if (!exportedEvidence.has("manifest.json")) {
      const sourcePath = path.join(evidenceDir, "manifest.json")
      const destinationPath = path.join(outDir, "manifest.json")
      await copyChecked({
        base,
        sourcePath,
        destinationPath,
      })
      exported += 1
    }

    await writeExportEvent(writer, data.sessionId, {
      type: "evidence.export_completed",
      summary: "evidence export completed",
      data: { exported },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    let errorArtifactPath: string | undefined
    try {
      const errorArtifact = await writer.artifact({
        kind: "evidence-error",
        path: `errors/export-failed-${Date.now()}.json`,
        data: JSON.stringify({ error: message }),
      })
      errorArtifactPath = errorArtifact.path
    } catch {
      // best-effort: ignore artifact failures
    }
    await writeExportEvent(writer, data.sessionId, {
      type: "evidence.export_failed",
      summary: "evidence export failed",
      data: { error: message, error_artifact: errorArtifactPath },
    })
    throw error
  }
}
