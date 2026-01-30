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

async function readChangeSetFiles(changeSetPath: string) {
  const text = await fs.readFile(changeSetPath, "utf-8")
  const changeSet = WorktreeChangeSet.parse(JSON.parse(text))
  return [
    ...changeSet.files.added,
    ...changeSet.files.modified,
    ...changeSet.files.deleted,
  ].map((entry) => entry.path)
}

export async function finalizeChildSession(
  input: z.infer<typeof FinalizeInput>,
): Promise<FinalizeResult> {
  const data = FinalizeInput.parse(input)
  const base = baseDir()
  const writer = await EvidenceWriter.open({ sessionId: data.parentSessionId })

  const markerRel = markerRelativePath(data.childSessionId)
  const markerAbs = path.join(base, ".opencode", "artifacts", data.parentSessionId, markerRel)

  if (await exists(markerAbs)) {
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

    const patchPath = path.join(
      base,
      ".opencode",
      "artifacts",
      data.childSessionId,
      "worktree",
      "changes.patch",
    )
    const changeSetPath = path.join(
      base,
      ".opencode",
      "artifacts",
      data.childSessionId,
      "worktree",
      "changes.json",
    )

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
