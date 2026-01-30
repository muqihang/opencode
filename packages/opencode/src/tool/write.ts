import z from "zod"
import * as path from "path"
import { Tool } from "./tool"
import { LSP } from "../lsp"
import { createTwoFilesPatch } from "diff"
import DESCRIPTION from "./write.txt"
import { Bus } from "../bus"
import { File } from "../file"
import { FileTime } from "../file/time"
import { Filesystem } from "../util/filesystem"
import { Instance } from "../project/instance"
import { EvidenceWriter } from "../evidence/writer"
import { trimDiff } from "./edit"
import { assertExternalDirectory } from "./external-directory"
import { Session } from "@/session"
import { resolveWorkdirMode, resolveWorkdirPath } from "@/workdir/resolve"
import { toLogicalPath, toWorkdirPath } from "@/workdir/paths"
import { WorkdirWriteQueue } from "@/workdir/write-queue"
import { captureWorktreePatch } from "@/worktree/changes"

const MAX_DIAGNOSTICS_PER_FILE = 20
const MAX_PROJECT_DIAGNOSTICS_FILES = 5

export const WriteTool = Tool.define("write", {
  description: DESCRIPTION,
  parameters: z.object({
    content: z.string().describe("The content to write to the file"),
    filePath: z.string().describe("The absolute path to the file to write (must be absolute, not relative)"),
  }),
  async execute(params, ctx) {
    const base = Instance.worktree === "/" ? Instance.directory : Instance.worktree
    const repoPath = path.isAbsolute(params.filePath)
      ? params.filePath
      : path.resolve(base, params.filePath)
    await assertExternalDirectory(ctx, repoPath)

    const parsed = Session.Info.shape.id.safeParse(ctx.sessionID)
    const info = parsed.success ? await Session.get(ctx.sessionID).catch(() => undefined) : undefined
    const kind = info?.parentID ? "child" : "primary"
    const mode = await resolveWorkdirMode({ kind })
    const workdir = await resolveWorkdirPath({ sessionId: ctx.sessionID, mode })
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

    const internal = Filesystem.contains(base, repoPath)
    const logicalPath = internal
      ? toLogicalPath({ repoPath })
      : path.relative(base, repoPath).split(path.sep).join(path.posix.sep)
    const filepath = internal ? toWorkdirPath({ repoPath, workdir }) : repoPath

    let exists = false
    let contentOld = ""
    let diff = ""

    const writeFile = async () =>
      FileTime.withLock(filepath, async () => {
        const file = Bun.file(filepath)
        exists = await file.exists()
        contentOld = exists ? await file.text() : ""
        if (exists) await FileTime.assert(ctx.sessionID, filepath)

        diff = trimDiff(createTwoFilesPatch(logicalPath, logicalPath, contentOld, params.content))
        await ctx.ask({
          permission: "edit",
          patterns: [logicalPath],
          always: ["*"],
          metadata: {
            filepath,
            diff,
          },
        })

        await Bun.write(filepath, params.content)
        await Bus.publish(File.Event.Edited, {
          file: filepath,
        })
        FileTime.read(ctx.sessionID, filepath)
      })

    if (mode === "shared") {
      await WorkdirWriteQueue.run({
        sessionId: ctx.sessionID,
        targetDir: workdir,
        reason: "write",
        intentFiles: [logicalPath],
        writer,
        work: writeFile,
      })
    }
    if (mode === "isolated") {
      await writeFile()
    }

    let output = "Wrote file successfully."
    await LSP.touchFile(filepath, true)
    const diagnostics = await LSP.diagnostics()
    const normalizedFilepath = Filesystem.normalizePath(filepath)
    let projectDiagnosticsCount = 0
    for (const [file, issues] of Object.entries(diagnostics)) {
      const errors = issues.filter((item) => item.severity === 1)
      if (errors.length === 0) continue
      const limited = errors.slice(0, MAX_DIAGNOSTICS_PER_FILE)
      const suffix =
        errors.length > MAX_DIAGNOSTICS_PER_FILE ? `\n... and ${errors.length - MAX_DIAGNOSTICS_PER_FILE} more` : ""
      if (file === normalizedFilepath) {
        output += `\n\nLSP errors detected in this file, please fix:\n<diagnostics file="${filepath}">\n${limited.map(LSP.Diagnostic.pretty).join("\n")}${suffix}\n</diagnostics>`
        continue
      }
      if (projectDiagnosticsCount >= MAX_PROJECT_DIAGNOSTICS_FILES) continue
      projectDiagnosticsCount++
      output += `\n\nLSP errors detected in other files:\n<diagnostics file="${file}">\n${limited.map(LSP.Diagnostic.pretty).join("\n")}${suffix}\n</diagnostics>`
    }

    if (mode === "isolated") {
      await captureWorktreePatch({
        workdir,
        sessionId: ctx.sessionID,
        writer,
      })
    }

    return {
      title: logicalPath,
      metadata: {
        diagnostics,
        filepath,
        exists: exists,
      },
      output,
    }
  },
})
