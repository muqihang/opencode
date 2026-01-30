import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import z from "zod"
import { EvidenceWriter } from "@/evidence/writer"
import { Instance } from "@/project/instance"
import { WorktreeChangeSet } from "@/worktree/changeset"
import { stableJson } from "@/util/stable-json"
import { GateRunner } from "@/gate/gate"

const ApplyInput = z
  .object({
    parentSessionId: z.string().min(1),
    childSessionId: z.string().min(1),
    targetDir: z.string().min(1),
    changeSetPath: z.string().min(1),
    patchPath: z.string().min(1),
  })
  .strict()

type ApplyOk = {
  status: "ok"
  appliedFiles: string[]
}

type ApplyConflict = {
  status: "conflict" | "error"
  conflictArtifacts: string[]
}

export type ApplyResult = ApplyOk | ApplyConflict

function sha(input: ArrayBuffer | string) {
  const hash = new Bun.CryptoHasher("sha256")
  hash.update(input)
  return hash.digest("hex")
}

async function hashFile(targetDir: string, file: string) {
  const target = path.join(targetDir, file)
  const handle = Bun.file(target)
  const exists = await handle.exists()
  if (!exists) return sha("")
  const data = await handle.arrayBuffer()
  return sha(data)
}

function resolvePath(raw: string) {
  if (path.isAbsolute(raw)) return raw
  const base = Instance.worktree === "/" ? Instance.directory : Instance.worktree
  return path.resolve(base, raw)
}

export const WorktreeMerge = {
  async applyChangeSet(input: z.infer<typeof ApplyInput>): Promise<ApplyResult> {
    const data = ApplyInput.parse(input)
    const changeSetPath = resolvePath(data.changeSetPath)
    const patchPath = resolvePath(data.patchPath)

    const changeSetText = await fs.readFile(changeSetPath, "utf-8")
    const changeSet = WorktreeChangeSet.parse(JSON.parse(changeSetText))
    const patchText = await fs.readFile(patchPath, "utf-8")

    const writer = await EvidenceWriter.open({ sessionId: data.parentSessionId })
    const stamp = new Date().toISOString().replace(/[:.]/g, "-")

    const apply = await $`git apply --3way --whitespace=nowarn ${patchPath}`
      .quiet()
      .nothrow()
      .cwd(data.targetDir)
    const stdout = apply.stdout?.toString() ?? ""
    const stderr = apply.stderr?.toString() ?? ""

    await writer.artifact({
      kind: "worktree-merge-stdout",
      path: `worktree/merge/${stamp}-git-apply.stdout.txt`,
      data: stdout,
    })
    await writer.artifact({
      kind: "worktree-merge-stderr",
      path: `worktree/merge/${stamp}-git-apply.stderr.txt`,
      data: stderr,
    })

    const entries = [
      ...changeSet.files.added,
      ...changeSet.files.modified,
      ...changeSet.files.deleted,
    ]
    const mismatches: string[] = []
    for (const entry of entries) {
      const actual = await hashFile(data.targetDir, entry.path)
      if (actual !== entry.sha256) {
        mismatches.push(entry.path)
      }
    }

    if (apply.exitCode !== 0 || mismatches.length > 0) {
      const conflictArtifacts: string[] = []
      const conflictStamp = `${stamp}-${data.childSessionId}`

      const stderrEntry = await writer.artifact({
        kind: "worktree-merge-conflict",
        path: `worktree/conflicts/${conflictStamp}-git-apply.stderr.txt`,
        data: stderr,
      })
      conflictArtifacts.push(stderrEntry.path)

      const patchEntry = await writer.artifact({
        kind: "worktree-merge-conflict",
        path: `worktree/conflicts/${conflictStamp}-patch.patch`,
        data: patchText,
      })
      conflictArtifacts.push(patchEntry.path)

      const changesEntry = await writer.artifact({
        kind: "worktree-merge-conflict",
        path: `worktree/conflicts/${conflictStamp}-expected.changes.json`,
        data: changeSetText,
      })
      conflictArtifacts.push(changesEntry.path)

      if (mismatches.length > 0) {
        const mismatchEntry = await writer.artifact({
          kind: "worktree-merge-conflict",
          path: `worktree/conflicts/${conflictStamp}-hash-mismatch.json`,
          data: stableJson({ mismatches }),
        })
        conflictArtifacts.push(mismatchEntry.path)
      }

      return {
        status: "conflict",
        conflictArtifacts,
      }
    }

    await GateRunner.run({
      sessionId: data.parentSessionId,
      workdir: data.targetDir,
      changedFiles: entries.map((entry) => entry.path),
      lint: true,
      diffCheck: true,
    })

    return {
      status: "ok",
      appliedFiles: entries.map((entry) => entry.path),
    }
  },
}
