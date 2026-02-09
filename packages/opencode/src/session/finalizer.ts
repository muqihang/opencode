import fs from "fs/promises"
import path from "path"
import z from "zod"
import { EvidenceWriter } from "@/evidence/writer"
import { mergeChildEvidencePacks } from "@/evidence/macro-merge"
import { Instance } from "@/project/instance"
import { WorkdirWriteQueue } from "@/workdir/write-queue"
import { WorktreeMerge } from "@/worktree/merge"
import { WorktreeChangeSet } from "@/worktree/changeset"
import { resolveWorkdirMode, resolveWorkdirPath } from "@/workdir/resolve"
import { stableJson } from "@/util/stable-json"
import { ContextLedger } from "@/session/context-ledger"
import { artifactCandidates, resolveTenantScope } from "@/util/tenant-context"

type Writer = Awaited<ReturnType<typeof EvidenceWriter.open>>

const FinalizeInput = z
  .object({
    parentSessionId: z.string().min(1),
    childSessionId: z.string().min(1),
  })
  .strict()

type FinalizeResult =
  | {
      status: "ok"
      appliedFiles: string[]
      markerPath: string
    }
  | {
      status: "conflict"
      conflictArtifacts: string[]
      markerPath: string
    }
  | {
      status: "skipped"
      reason: "already_finalized"
      markerPath: string
    }
  | {
      status: "no_changes"
      markerPath: string
    }
  | {
      status: "error"
      error: string
    }

function baseDir() {
  return Instance.worktree === "/" ? Instance.directory : Instance.worktree
}

function markerRelativePath(childSessionId: string) {
  return path.posix.join("worktree", "merged", `${childSessionId}.json`)
}

async function exists(filepath: string) {
  const stat = await fs.stat(filepath).catch(() => undefined)
  return Boolean(stat)
}

function artifactPaths(input: { base: string; sessionId: string; rel: string }) {
  const scope = resolveTenantScope()
  return artifactCandidates({
    base: input.base,
    sessionId: input.sessionId,
    tenantId: scope.tenantId,
    orgId: scope.orgId,
  }).map((root) => path.join(root, input.rel))
}

async function firstExisting(paths: string[]) {
  for (const candidate of paths) {
    if (await exists(candidate)) return candidate
  }
  return undefined
}

async function readChangeSetFiles(changeSetPath: string) {
  const text = await fs.readFile(changeSetPath, "utf-8")
  const changeSet = WorktreeChangeSet.parse(JSON.parse(text))
  return [
    ...changeSet.files.added,
    ...changeSet.files.modified,
    ...changeSet.files.deleted,
  ].map((entry) => entry.path)
}

function sha256Bytes(bytes: Uint8Array) {
  const hash = new Bun.CryptoHasher("sha256")
  hash.update(Buffer.from(bytes))
  return hash.digest("hex")
}

const present = <T>(value: T | undefined): value is T => value !== undefined

async function pointerFromFile(input: { kind: string; base: string; file: string }) {
  const rel = path.relative(input.base, input.file).replace(/\\/g, "/")
  const bytes = await Bun.file(input.file).bytes()
  return { kind: input.kind, path: rel, sha256: sha256Bytes(bytes) }
}

async function pointerFromRel(input: { kind: string; base: string; rel: string }) {
  const file = path.join(input.base, input.rel)
  return pointerFromFile({ kind: input.kind, base: input.base, file })
}

async function emitHandoffCapsule(input: {
  parentSessionId: string
  childSessionId: string
  writer: Writer
  base: string
  status: "ok" | "conflict" | "no_changes"
  appliedFiles: string[]
  conflictArtifacts: string[]
  aliasArtifactPath?: string
  patchPath?: string
  changeSetPath?: string
}) {
  const now = new Date().toISOString()
  const pointers = await Promise.all(
    [
      input.aliasArtifactPath
        ? pointerFromRel({ kind: "evidence.macro_merge_alias", base: input.base, rel: input.aliasArtifactPath })
        : undefined,
      input.patchPath ? pointerFromFile({ kind: "worktree.patch", base: input.base, file: input.patchPath }) : undefined,
      input.changeSetPath
        ? pointerFromFile({ kind: "worktree.changeset", base: input.base, file: input.changeSetPath })
        : undefined,
    ].filter(present),
  )

  const ordered = [...pointers].sort((a, b) => {
    const kind = a.kind.localeCompare(b.kind)
    if (kind !== 0) return kind
    return a.path.localeCompare(b.path)
  })

  const capsule = await input.writer.artifact({
    kind: "capsule-handoff",
    path: path.posix.join("handoff", input.childSessionId, "capsule.handoff.json"),
    data: stableJson({
      specVersion: "capsule-handoff/1.0",
      childSessionId: input.childSessionId,
      generatedAtUtc: now,
      appliedFiles: input.status === "ok" ? input.appliedFiles : undefined,
      conflictArtifacts: input.status === "conflict" ? input.conflictArtifacts : undefined,
      goal: { status: "unknown" },
      decisions: [],
      openQuestions: [],
      workingSet: { pointers: ordered },
      notes: [],
    }),
  })

  await input.writer.event({
    specVersion: "event/1.0",
    ts: now,
    sessionId: input.parentSessionId,
    severity: "info",
    actor: "worktree:finalizer",
    type: "handoff.generated",
    summary: "handoff capsule generated",
    data: {
      childSessionId: input.childSessionId,
      capsulePath: capsule.path,
      capsuleSha256: capsule.sha256,
      appliedFiles: input.status === "ok" ? input.appliedFiles : undefined,
      conflictArtifacts: input.status === "conflict" ? input.conflictArtifacts : undefined,
      pointers: ordered.map((p) => ({ kind: p.kind, path: p.path, sha256: p.sha256 })),
    },
    redaction: { applied: true, policyVersion: "v1" },
  })

  const prev = await ContextLedger.read(input.parentSessionId)
  const handoffs = prev.handoffs ?? []
  const next = [...handoffs, { childSessionId: input.childSessionId, capsulePath: capsule.path, capsuleSha256: capsule.sha256, importedAtUtc: now }].slice(-10)
  await ContextLedger.update({ sessionId: input.parentSessionId, patch: { handoffs: next } })
}

export async function finalizeChildSession(
  input: z.infer<typeof FinalizeInput>,
): Promise<FinalizeResult> {
  const data = FinalizeInput.parse(input)
  const base = baseDir()
  const writer = await EvidenceWriter.open({ sessionId: data.parentSessionId })

  const markerRel = markerRelativePath(data.childSessionId)
  const markerAbs = await firstExisting(
    artifactPaths({
      base,
      sessionId: data.parentSessionId,
      rel: markerRel,
    }),
  )

  if (markerAbs) {
    await writer.event({
      specVersion: "event/1.0",
      ts: new Date().toISOString(),
      sessionId: data.parentSessionId,
      severity: "info",
      actor: "worktree:finalizer",
      type: "worktree.merge_skipped",
      summary: "merge skipped",
      data: {
        childSessionId: data.childSessionId,
        reason: "already_finalized",
        marker: path.relative(base, markerAbs),
      },
      redaction: { applied: true, policyVersion: "v1" },
    })
    return { status: "skipped", reason: "already_finalized", markerPath: path.relative(base, markerAbs) }
  }

  const markerPayload = {
    specVersion: "worktree-merge-marker/1.0",
    parentSessionId: data.parentSessionId,
    childSessionId: data.childSessionId,
    mergedAt: new Date().toISOString(),
  }

  try {
    const childWriter = await EvidenceWriter.open({ sessionId: data.childSessionId })
    await childWriter.pack({ handoff: "child finalized" })

    const patchCandidates = artifactPaths({
      base,
      sessionId: data.childSessionId,
      rel: path.posix.join("worktree", "changes.patch"),
    })
    const changeSetCandidates = artifactPaths({
      base,
      sessionId: data.childSessionId,
      rel: path.posix.join("worktree", "changes.json"),
    })
    const patchPath = (await firstExisting(patchCandidates)) ?? patchCandidates[0]!
    const changeSetPath = (await firstExisting(changeSetCandidates)) ?? changeSetCandidates[0]!

    const hasPatch = await exists(patchPath)
    const hasChangeSet = await exists(changeSetPath)
    if (!hasPatch || !hasChangeSet) {
      const merged = await mergeChildEvidencePacks({
        parentSessionId: data.parentSessionId,
        childSessionIds: [data.childSessionId],
      })
      await writer.event({
        specVersion: "event/1.0",
        ts: new Date().toISOString(),
        sessionId: data.parentSessionId,
        severity: "info",
        actor: "worktree:finalizer",
        type: "worktree.merge_skipped",
        summary: "merge skipped (no changes)",
        data: {
          childSessionId: data.childSessionId,
          reason: "no_changes",
        },
        redaction: { applied: true, policyVersion: "v1" },
      })
      await writer.event({
        specVersion: "event/1.0",
        ts: new Date().toISOString(),
        sessionId: data.parentSessionId,
        severity: "info",
        actor: "evidence:macro-merge",
        type: "evidence.macro_pack_merged",
        summary: "macro pack merged",
        data: {
          merge_policy: "macro-merge/1.0",
          childSessionIds: [data.childSessionId],
          aliasArtifactPath: merged.aliasArtifactPath,
        },
        redaction: { applied: true, policyVersion: "v1" },
      })
      const marker = await writer.artifact({
        kind: "worktree-merge-marker",
        path: markerRel,
        data: stableJson({ ...markerPayload, status: "no_changes" }),
      })
      await emitHandoffCapsule({
        parentSessionId: data.parentSessionId,
        childSessionId: data.childSessionId,
        writer,
        base,
        status: "no_changes",
        appliedFiles: [],
        conflictArtifacts: [],
        aliasArtifactPath: merged.aliasArtifactPath,
        patchPath: hasPatch ? patchPath : undefined,
        changeSetPath: hasChangeSet ? changeSetPath : undefined,
      })
      return { status: "no_changes", markerPath: marker.path }
    }

    const intentFiles = await readChangeSetFiles(changeSetPath)
    const mode = await resolveWorkdirMode({ kind: "primary" })
    const targetDir = await resolveWorkdirPath({ sessionId: data.parentSessionId, mode })

    let applyResult: Awaited<ReturnType<typeof WorktreeMerge.applyChangeSet>> | undefined
    await WorkdirWriteQueue.run({
      sessionId: data.parentSessionId,
      targetDir,
      reason: "child_finalizer",
      intentFiles,
      writer,
      work: async () => {
        applyResult = await WorktreeMerge.applyChangeSet({
          parentSessionId: data.parentSessionId,
          childSessionId: data.childSessionId,
          targetDir,
          changeSetPath,
          patchPath,
        })
      },
    })
    if (!applyResult) {
      throw new Error("worktree merge did not return a result")
    }
    const result = applyResult

    if (result.status !== "ok") {
      await writer.risk({
        summary: `worktree merge conflict: ${data.childSessionId}`,
        evidence: result.conflictArtifacts,
      })
      await writer.event({
        specVersion: "event/1.0",
        ts: new Date().toISOString(),
        sessionId: data.parentSessionId,
        severity: "error",
        actor: "worktree:finalizer",
        type: "worktree.merge_conflict",
        summary: "merge conflict",
        data: {
          childSessionId: data.childSessionId,
          conflictArtifacts: result.conflictArtifacts,
        },
        redaction: { applied: true, policyVersion: "v1" },
      })
      await writer.pack({ handoff: "merge conflict" })
    } else {
      await writer.event({
        specVersion: "event/1.0",
        ts: new Date().toISOString(),
        sessionId: data.parentSessionId,
        severity: "info",
        actor: "worktree:finalizer",
        type: "worktree.merge_completed",
        summary: "merge completed",
        data: {
          childSessionId: data.childSessionId,
          appliedFiles: result.appliedFiles,
        },
        redaction: { applied: true, policyVersion: "v1" },
      })
    }

    const merged = await mergeChildEvidencePacks({
      parentSessionId: data.parentSessionId,
      childSessionIds: [data.childSessionId],
    })
    await writer.event({
      specVersion: "event/1.0",
      ts: new Date().toISOString(),
      sessionId: data.parentSessionId,
      severity: "info",
      actor: "evidence:macro-merge",
      type: "evidence.macro_pack_merged",
      summary: "macro pack merged",
      data: {
        merge_policy: "macro-merge/1.0",
        childSessionIds: [data.childSessionId],
        aliasArtifactPath: merged.aliasArtifactPath,
      },
      redaction: { applied: true, policyVersion: "v1" },
    })

    const marker = await writer.artifact({
      kind: "worktree-merge-marker",
      path: markerRel,
      data: stableJson({
        ...markerPayload,
        status: result.status,
        appliedFiles: result.status === "ok" ? result.appliedFiles : undefined,
        conflictArtifacts: result.status === "ok" ? undefined : result.conflictArtifacts,
      }),
    })

    await emitHandoffCapsule({
      parentSessionId: data.parentSessionId,
      childSessionId: data.childSessionId,
      writer,
      base,
      status: result.status === "ok" ? "ok" : "conflict",
      appliedFiles: result.status === "ok" ? result.appliedFiles : [],
      conflictArtifacts: result.status === "ok" ? [] : result.conflictArtifacts,
      aliasArtifactPath: merged.aliasArtifactPath,
      patchPath,
      changeSetPath,
    })

    if (result.status === "ok") {
      return { status: "ok", appliedFiles: result.appliedFiles, markerPath: marker.path }
    }
    return { status: "conflict", conflictArtifacts: result.conflictArtifacts, markerPath: marker.path }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const artifact = await writer.artifact({
      kind: "worktree-merge-error",
      path: `worktree/merge-error-${data.childSessionId}.json`,
      data: stableJson({ error: message }),
    })
    await writer.event({
      specVersion: "event/1.0",
      ts: new Date().toISOString(),
      sessionId: data.parentSessionId,
      severity: "error",
      actor: "worktree:finalizer",
      type: "worktree.merge_error",
      summary: "merge error",
      data: {
        childSessionId: data.childSessionId,
        error: message,
        artifact: artifact.path,
      },
      redaction: { applied: true, policyVersion: "v1" },
    })
    await writer.risk({
      summary: `worktree merge error: ${data.childSessionId}`,
      evidence: [artifact.path],
    })
    await writer.pack({ handoff: "merge error" })
    return { status: "error", error: message }
  }
}
