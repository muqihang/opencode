import z from "zod"
import * as path from "path"
import * as fs from "fs/promises"
import { Tool } from "./tool"
import { Bus } from "../bus"
import { FileWatcher } from "../file/watcher"
import { Instance } from "../project/instance"
import { Patch } from "../patch"
import { createTwoFilesPatch, diffLines } from "diff"
import { assertExternalDirectory } from "./external-directory"
import { trimDiff } from "./edit"
import { LSP } from "../lsp"
import { Filesystem } from "../util/filesystem"
import DESCRIPTION from "./apply_patch.txt"
import { File } from "../file"
import { EvidenceWriter } from "../evidence/writer"
import { Session } from "@/session"
import { resolveWorkdirMode, resolveWorkdirPath } from "@/workdir/resolve"
import { toLogicalPath, toWorkdirPath } from "@/workdir/paths"
import { WorkdirWriteQueue } from "@/workdir/write-queue"
import { FileTime } from "@/file/time"
import { captureWorktreePatch } from "@/worktree/changes"

const PatchParams = z.object({
  patchText: z.string().describe("The full patch text that describes all changes to be made"),
})

export const ApplyPatchTool = Tool.define("apply_patch", {
  description: DESCRIPTION,
  parameters: PatchParams,
  async execute(params, ctx) {
    if (!params.patchText) {
      throw new Error("patchText is required")
    }

    // Parse the patch to get hunks
    let hunks: Patch.Hunk[]
    try {
      const parseResult = Patch.parsePatch(params.patchText)
      hunks = parseResult.hunks
    } catch (error) {
      throw new Error(`apply_patch verification failed: ${error}`)
    }

    if (hunks.length === 0) {
      const normalized = params.patchText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim()
      if (normalized === "*** Begin Patch\n*** End Patch") {
        throw new Error("patch rejected: empty patch")
      }
      throw new Error("apply_patch verification failed: no hunks found")
    }

    const parsed = Session.Info.shape.id.safeParse(ctx.sessionID)
    const info = parsed.success ? await Session.get(ctx.sessionID).catch(() => undefined) : undefined
    const kind = info?.parentID ? "child" : "primary"
    const mode = await resolveWorkdirMode({ kind })
    const workdir = await resolveWorkdirPath({ sessionId: ctx.sessionID, mode })
    const base = Instance.worktree === "/" ? Instance.directory : Instance.worktree
    const writer = await EvidenceWriter.open({ sessionId: ctx.sessionID })
    await writer.event({
      specVersion: "event/1.0",
      ts: new Date().toISOString(),
      sessionId: ctx.sessionID,
      severity: "info",
      actor: "workdir:resolve",
      type: "workdir.mode_resolved",
      summary: "workdir mode resolved",
      data: {
        mode,
        workdir,
        logicalRoot: base,
      },
      redaction: { applied: true, policyVersion: "v1" },
    })

    // Validate file paths and check permissions
    const fileChanges: Array<{
      filePath: string
      logicalPath: string
      oldContent: string
      newContent: string
      type: "add" | "update" | "delete" | "move"
      movePath?: string
      moveLogicalPath?: string
      diff: string
      additions: number
      deletions: number
    }> = []

    let totalDiff = ""

    for (const hunk of hunks) {
      const repoPath = path.resolve(base, hunk.path)
      const filePath = toWorkdirPath({ repoPath, workdir })
      const logicalPath = toLogicalPath({ repoPath })
      await assertExternalDirectory(ctx, repoPath)

      switch (hunk.type) {
        case "add": {
          const oldContent = ""
          const newContent =
            hunk.contents.length === 0 || hunk.contents.endsWith("\n") ? hunk.contents : `${hunk.contents}\n`
          const diff = trimDiff(createTwoFilesPatch(logicalPath, logicalPath, oldContent, newContent))

          let additions = 0
          let deletions = 0
          for (const change of diffLines(oldContent, newContent)) {
            if (change.added) additions += change.count || 0
            if (change.removed) deletions += change.count || 0
          }

          fileChanges.push({
            filePath,
            logicalPath,
            oldContent,
            newContent,
            type: "add",
            diff,
            additions,
            deletions,
          })

          totalDiff += diff + "\n"
          break
        }

        case "update": {
          // Check if file exists for update
          const stats = await fs.stat(filePath).catch(() => null)
          if (!stats || stats.isDirectory()) {
            throw new Error(`apply_patch verification failed: Failed to read file to update: ${filePath}`)
          }

          const oldContent = await fs.readFile(filePath, "utf-8")
          let newContent = oldContent

          // Apply the update chunks to get new content
          try {
            const fileUpdate = Patch.deriveNewContentsFromChunks(filePath, hunk.chunks)
            newContent = fileUpdate.content
          } catch (error) {
            throw new Error(`apply_patch verification failed: ${error}`)
          }

          const diff = trimDiff(createTwoFilesPatch(logicalPath, logicalPath, oldContent, newContent))

          let additions = 0
          let deletions = 0
          for (const change of diffLines(oldContent, newContent)) {
            if (change.added) additions += change.count || 0
            if (change.removed) deletions += change.count || 0
          }

          const moveRepoPath = hunk.move_path ? path.resolve(base, hunk.move_path) : undefined
          const movePath = moveRepoPath ? toWorkdirPath({ repoPath: moveRepoPath, workdir }) : undefined
          const moveLogicalPath = moveRepoPath ? toLogicalPath({ repoPath: moveRepoPath }) : undefined
          if (moveRepoPath) await assertExternalDirectory(ctx, moveRepoPath)

          fileChanges.push({
            filePath,
            logicalPath,
            oldContent,
            newContent,
            type: hunk.move_path ? "move" : "update",
            movePath,
            moveLogicalPath,
            diff,
            additions,
            deletions,
          })

          totalDiff += diff + "\n"
          break
        }

        case "delete": {
          const contentToDelete = await fs.readFile(filePath, "utf-8").catch((error) => {
            throw new Error(`apply_patch verification failed: ${error}`)
          })
          const deleteDiff = trimDiff(createTwoFilesPatch(logicalPath, logicalPath, contentToDelete, ""))

          const deletions = contentToDelete.split("\n").length

          fileChanges.push({
            filePath,
            logicalPath,
            oldContent: contentToDelete,
            newContent: "",
            type: "delete",
            diff: deleteDiff,
            additions: 0,
            deletions,
          })

          totalDiff += deleteDiff + "\n"
          break
        }
      }
    }

    // Build per-file metadata for UI rendering (used for both permission and result)
    const files = fileChanges.map((change) => ({
      filePath: change.filePath,
      relativePath: change.moveLogicalPath ?? change.logicalPath,
      type: change.type,
      diff: change.diff,
      before: change.oldContent,
      after: change.newContent,
      additions: change.additions,
      deletions: change.deletions,
      movePath: change.movePath,
    }))

    // Check permissions if needed
    const relativePaths = fileChanges.map((c) => c.moveLogicalPath ?? c.logicalPath)
    await ctx.ask({
      permission: "edit",
      patterns: relativePaths,
      always: ["*"],
      metadata: {
        filepath: relativePaths.join(", "),
        diff: totalDiff,
        files,
      },
    })

    const lockFiles = Array.from(
      new Set(
        fileChanges
          .flatMap((change) => [change.filePath, change.movePath])
          .filter((item): item is string => Boolean(item)),
      ),
    ).sort()
    const withLocks = async (paths: string[], fn: () => Promise<void>): Promise<void> => {
      const [current, ...rest] = paths
      if (!current) return fn()
      return FileTime.withLock(current, () => withLocks(rest, fn))
    }

    // Apply the changes
    const changedFiles: string[] = []

    const applyChanges = async () => {
      for (const change of fileChanges) {
        const edited = change.type === "delete" ? undefined : (change.movePath ?? change.filePath)
        switch (change.type) {
          case "add":
            // Create parent directories (recursive: true is safe on existing/root dirs)
            await fs.mkdir(path.dirname(change.filePath), { recursive: true })
            await fs.writeFile(change.filePath, change.newContent, "utf-8")
            changedFiles.push(change.filePath)
            break

          case "update":
            await fs.writeFile(change.filePath, change.newContent, "utf-8")
            changedFiles.push(change.filePath)
            break

          case "move":
            if (change.movePath) {
              // Create parent directories (recursive: true is safe on existing/root dirs)
              await fs.mkdir(path.dirname(change.movePath), { recursive: true })
              await fs.writeFile(change.movePath, change.newContent, "utf-8")
              await fs.unlink(change.filePath)
              changedFiles.push(change.movePath)
            }
            break

          case "delete":
            await fs.unlink(change.filePath)
            changedFiles.push(change.filePath)
            break
        }

        if (edited) {
          await Bus.publish(File.Event.Edited, {
            file: edited,
          })
        }
      }
    }

    const runWrite = () => withLocks(lockFiles, applyChanges)
    if (mode === "shared") {
      await WorkdirWriteQueue.run({
        sessionId: ctx.sessionID,
        targetDir: workdir,
        reason: "apply_patch",
        intentFiles: relativePaths,
        writer,
        work: runWrite,
      })
    }
    if (mode === "isolated") {
      await runWrite()
    }

    // Publish file change events
    for (const filePath of changedFiles) {
      await Bus.publish(FileWatcher.Event.Updated, { file: filePath, event: "change" })
    }

    // Notify LSP of file changes and collect diagnostics
    for (const change of fileChanges) {
      if (change.type === "delete") continue
      const target = change.movePath ?? change.filePath
      await LSP.touchFile(target, true)
    }
    const diagnostics = await LSP.diagnostics()

    // Generate output summary
    const summaryLines = fileChanges.map((change) => {
      if (change.type === "add") {
        return `A ${change.logicalPath}`
      }
      if (change.type === "delete") {
        return `D ${change.logicalPath}`
      }
      const target = change.moveLogicalPath ?? change.logicalPath
      return `M ${target}`
    })
    let output = `Success. Updated the following files:\n${summaryLines.join("\n")}`

    // Report LSP errors for changed files
    const MAX_DIAGNOSTICS_PER_FILE = 20
    for (const change of fileChanges) {
      if (change.type === "delete") continue
      const target = change.movePath ?? change.filePath
      const normalized = Filesystem.normalizePath(target)
      const issues = diagnostics[normalized] ?? []
      const errors = issues.filter((item) => item.severity === 1)
      if (errors.length > 0) {
        const limited = errors.slice(0, MAX_DIAGNOSTICS_PER_FILE)
        const suffix =
          errors.length > MAX_DIAGNOSTICS_PER_FILE ? `\n... and ${errors.length - MAX_DIAGNOSTICS_PER_FILE} more` : ""
        output += `\n\nLSP errors detected in ${change.moveLogicalPath ?? change.logicalPath}, please fix:\n<diagnostics file="${target}">\n${limited.map(LSP.Diagnostic.pretty).join("\n")}${suffix}\n</diagnostics>`
      }
    }

    if (mode === "isolated") {
      await captureWorktreePatch({
        workdir,
        sessionId: ctx.sessionID,
        writer,
      })
    }

    return {
      title: output,
      metadata: {
        diff: totalDiff,
        files,
        diagnostics,
      },
      output,
    }
  },
})
