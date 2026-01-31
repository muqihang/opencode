import { $ } from "bun"
import path from "path"
import fs from "fs/promises"
import { Log } from "../util/log"
import { Global } from "../global"
import z from "zod"
import { Config } from "../config/config"
import { Instance } from "../project/instance"
import { Scheduler } from "../scheduler"
import { EvidenceWriter } from "../evidence/writer"
import { Identifier } from "../id/id"
import { stableJson } from "../util/stable-json"

export namespace Snapshot {
  const log = Log.create({ service: "snapshot" })
  const hour = 60 * 60 * 1000
  const prune = "7.days"
  const limit = 5000

  export function init() {
    Scheduler.register({
      id: "snapshot.cleanup",
      interval: hour,
      run: cleanup,
      scope: "instance",
    })
  }

  export async function cleanup() {
    if (Instance.project.vcs !== "git") return
    const cfg = await Config.get()
    if (cfg.snapshot === false) return
    const git = gitdir()
    const exists = await fs
      .stat(git)
      .then(() => true)
      .catch(() => false)
    if (!exists) return
    const result = await $`git --git-dir ${git} --work-tree ${Instance.worktree} gc --prune=${prune}`
      .quiet()
      .cwd(Instance.directory)
      .nothrow()
    if (result.exitCode !== 0) {
      log.warn("cleanup failed", {
        exitCode: result.exitCode,
        stderr: result.stderr.toString(),
        stdout: result.stdout.toString(),
      })
      return
    }
    log.info("cleanup", { prune })
  }

  export async function track() {
    if (Instance.project.vcs !== "git") return
    const cfg = await Config.get()
    if (cfg.snapshot === false) return
    const git = gitdir()
    if (await fs.mkdir(git, { recursive: true })) {
      await $`git init`
        .env({
          ...process.env,
          GIT_DIR: git,
          GIT_WORK_TREE: Instance.worktree,
        })
        .quiet()
        .nothrow()
      // Configure git to not convert line endings on Windows
      await $`git --git-dir ${git} config core.autocrlf false`.quiet().nothrow()
      log.info("initialized")
    }
    await $`git --git-dir ${git} --work-tree ${Instance.worktree} add .`.quiet().cwd(Instance.directory).nothrow()
    const hash = await $`git --git-dir ${git} --work-tree ${Instance.worktree} write-tree`
      .quiet()
      .cwd(Instance.directory)
      .nothrow()
      .text()
    log.info("tracking", { hash, cwd: Instance.directory, git })
    return hash.trim()
  }

  function root() {
    return Instance.worktree === "/" ? Instance.directory : Instance.worktree
  }

  function toRelative(file: string) {
    if (!path.isAbsolute(file)) return file.split(path.sep).join(path.posix.sep)
    const rel = path.relative(root(), file)
    if (!rel || rel === ".") return ""
    const parts = rel.split(path.sep)
    if (parts.includes("..")) return ""
    return parts.join(path.posix.sep)
  }

  function normalize(files: string[]) {
    const list = files
      .map((file) => toRelative(file))
      .map((file) => file.trim())
      .filter(Boolean)
    const unique = [...new Set(list)].sort()
    const truncated = unique.length > limit
    const slice = truncated ? unique.slice(0, limit) : unique
    return { files: slice, truncated }
  }

  async function listSnapshot(snapshot: string) {
    const git = gitdir()
    const result =
      await $`git -c core.quotepath=false --git-dir ${git} --work-tree ${Instance.worktree} ls-tree -r --name-only ${snapshot}`
        .quiet()
        .cwd(Instance.worktree)
        .nothrow()
    if (result.exitCode !== 0) {
      log.warn("failed to list snapshot files", {
        snapshot,
        exitCode: result.exitCode,
        stderr: result.stderr.toString(),
        stdout: result.stdout.toString(),
      })
      return []
    }
    const text = result.text().trim()
    if (!text) return []
    return text
      .split("\n")
      .map((file) => file.trim())
      .filter(Boolean)
  }

  async function writeEvidence(input: {
    sessionId: string
    action: "created" | "reverted" | "restored"
    snapshot: string
    files: string[]
    truncated: boolean
    reason?: string
    patches?: string[]
  }) {
    const writer = await EvidenceWriter.open({ sessionId: input.sessionId })
    const name =
      input.action === "created"
        ? `snapshot/created/${input.snapshot}.json`
        : `snapshot/${input.action}/${Identifier.ascending("snapshot")}.json`
    const data = {
      specVersion: "snapshot-event/1.0",
      action: input.action,
      generatedAtUtc: new Date().toISOString(),
      snapshot: input.snapshot,
      files: input.files,
      truncated: input.truncated,
      reason: input.reason,
      patches: input.patches,
    }
    const entry = await writer.artifact({
      kind: "snapshot-event",
      path: name,
      data: stableJson(data),
    })
    const info: Record<string, unknown> = {
      snapshot: input.snapshot,
      files_artifact: entry.path,
      file_count: input.files.length,
      truncated: input.truncated,
    }
    if (input.reason) info.reason = input.reason
    if (input.patches?.length) info.patches = input.patches
    await writer.event({
      specVersion: "event/1.0",
      ts: new Date().toISOString(),
      sessionId: input.sessionId,
      severity: "info",
      actor: "session:undo",
      type: `snapshot.${input.action}`,
      summary: `snapshot ${input.action}`,
      data: info,
      redaction: { applied: true, policyVersion: "v1" },
    })
  }

  export const Patch = z.object({
    hash: z.string(),
    files: z.string().array(),
  })
  export type Patch = z.infer<typeof Patch>

  export async function patch(hash: string): Promise<Patch> {
    const git = gitdir()
    await $`git --git-dir ${git} --work-tree ${Instance.worktree} add .`.quiet().cwd(Instance.directory).nothrow()
    const result =
      await $`git -c core.autocrlf=false -c core.quotepath=false --git-dir ${git} --work-tree ${Instance.worktree} diff --no-ext-diff --name-only ${hash} -- .`
        .quiet()
        .cwd(Instance.directory)
        .nothrow()

    // If git diff fails, return empty patch
    if (result.exitCode !== 0) {
      log.warn("failed to get diff", { hash, exitCode: result.exitCode })
      return { hash, files: [] }
    }

    const files = result.text()
    return {
      hash,
      files: files
        .trim()
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => path.join(Instance.worktree, x)),
    }
  }

  export async function trackWithEvidence(input: { sessionId: string; reason?: string }) {
    const snapshot = await track()
    if (!snapshot) return snapshot
    const files = await listSnapshot(snapshot)
    const normalized = normalize(files)
    await writeEvidence({
      sessionId: input.sessionId,
      action: "created",
      snapshot,
      files: normalized.files,
      truncated: normalized.truncated,
      reason: input.reason,
    })
    return snapshot
  }

  export async function revertWithEvidence(input: {
    sessionId: string
    patches: Patch[]
    reason?: string
    snapshot?: string
  }) {
    await revert(input.patches)
    const snapshot = input.snapshot ?? input.patches.at(0)?.hash
    if (!snapshot) return
    const files = input.patches.flatMap((patch) => patch.files)
    const normalized = normalize(files)
    const hashes = [...new Set(input.patches.map((patch) => patch.hash))].sort()
    await writeEvidence({
      sessionId: input.sessionId,
      action: "reverted",
      snapshot,
      files: normalized.files,
      truncated: normalized.truncated,
      reason: input.reason,
      patches: hashes.length ? hashes : undefined,
    })
  }

  export async function restore(snapshot: string) {
    log.info("restore", { commit: snapshot })
    const git = gitdir()
    const result =
      await $`git --git-dir ${git} --work-tree ${Instance.worktree} read-tree ${snapshot} && git --git-dir ${git} --work-tree ${Instance.worktree} checkout-index -a -f`
        .quiet()
        .cwd(Instance.worktree)
        .nothrow()

    if (result.exitCode !== 0) {
      log.error("failed to restore snapshot", {
        snapshot,
        exitCode: result.exitCode,
        stderr: result.stderr.toString(),
        stdout: result.stdout.toString(),
      })
    }
  }

  export async function restoreWithEvidence(input: { sessionId: string; snapshot: string; reason?: string }) {
    const patch = await Snapshot.patch(input.snapshot)
    const normalized = normalize(patch.files)
    await restore(input.snapshot)
    await writeEvidence({
      sessionId: input.sessionId,
      action: "restored",
      snapshot: input.snapshot,
      files: normalized.files,
      truncated: normalized.truncated,
      reason: input.reason,
    })
  }

  export async function revert(patches: Patch[]) {
    const files = new Set<string>()
    const git = gitdir()
    for (const item of patches) {
      for (const file of item.files) {
        if (files.has(file)) continue
        log.info("reverting", { file, hash: item.hash })
        const result = await $`git --git-dir ${git} --work-tree ${Instance.worktree} checkout ${item.hash} -- ${file}`
          .quiet()
          .cwd(Instance.worktree)
          .nothrow()
        if (result.exitCode !== 0) {
          const relativePath = path.relative(Instance.worktree, file)
          const checkTree =
            await $`git --git-dir ${git} --work-tree ${Instance.worktree} ls-tree ${item.hash} -- ${relativePath}`
              .quiet()
              .cwd(Instance.worktree)
              .nothrow()
          if (checkTree.exitCode === 0 && checkTree.text().trim()) {
            log.info("file existed in snapshot but checkout failed, keeping", {
              file,
            })
          } else {
            log.info("file did not exist in snapshot, deleting", { file })
            await fs.unlink(file).catch(() => {})
          }
        }
        files.add(file)
      }
    }
  }

  export async function diff(hash: string) {
    const git = gitdir()
    await $`git --git-dir ${git} --work-tree ${Instance.worktree} add .`.quiet().cwd(Instance.directory).nothrow()
    const result =
      await $`git -c core.autocrlf=false --git-dir ${git} --work-tree ${Instance.worktree} diff --no-ext-diff ${hash} -- .`
        .quiet()
        .cwd(Instance.worktree)
        .nothrow()

    if (result.exitCode !== 0) {
      log.warn("failed to get diff", {
        hash,
        exitCode: result.exitCode,
        stderr: result.stderr.toString(),
        stdout: result.stdout.toString(),
      })
      return ""
    }

    return result.text().trim()
  }

  export const FileDiff = z
    .object({
      file: z.string(),
      before: z.string(),
      after: z.string(),
      additions: z.number(),
      deletions: z.number(),
    })
    .meta({
      ref: "FileDiff",
    })
  export type FileDiff = z.infer<typeof FileDiff>
  export async function diffFull(from: string, to: string): Promise<FileDiff[]> {
    const git = gitdir()
    const result: FileDiff[] = []
    for await (const line of $`git -c core.autocrlf=false --git-dir ${git} --work-tree ${Instance.worktree} diff --no-ext-diff --no-renames --numstat ${from} ${to} -- .`
      .quiet()
      .cwd(Instance.directory)
      .nothrow()
      .lines()) {
      if (!line) continue
      const [additions, deletions, file] = line.split("\t")
      const isBinaryFile = additions === "-" && deletions === "-"
      const before = isBinaryFile
        ? ""
        : await $`git -c core.autocrlf=false --git-dir ${git} --work-tree ${Instance.worktree} show ${from}:${file}`
            .quiet()
            .nothrow()
            .text()
      const after = isBinaryFile
        ? ""
        : await $`git -c core.autocrlf=false --git-dir ${git} --work-tree ${Instance.worktree} show ${to}:${file}`
            .quiet()
            .nothrow()
            .text()
      const added = isBinaryFile ? 0 : parseInt(additions)
      const deleted = isBinaryFile ? 0 : parseInt(deletions)
      result.push({
        file,
        before,
        after,
        additions: Number.isFinite(added) ? added : 0,
        deletions: Number.isFinite(deleted) ? deleted : 0,
      })
    }
    return result
  }

  function gitdir() {
    const project = Instance.project
    return path.join(Global.Path.data, "snapshot", project.id)
  }
}
