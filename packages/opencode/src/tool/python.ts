import z from "zod"
import path from "path"
import fs from "fs/promises"
import { Tool } from "./tool"
import DESCRIPTION from "./python.txt"
import { Config } from "@/config/config"
import { Instance } from "@/project/instance"
import { SessionWorktree } from "@/worktree/session"
import { SandboxRunner } from "@/sandbox/runner"
import { ScriptRegistry } from "@/python/registry"
import { EvidenceWriter } from "@/evidence/writer"
import { stableJson } from "@/util/stable-json"

const DEFAULT_TIMEOUT = 2 * 60 * 1000

type PythonMetadata = {
  exit: number
  description: string
  script_id: string
  script_sha256: string
  input_artifact: string
  output_artifact: string
  python_path: string
  truncated?: boolean
}

function baseDir() {
  return Instance.worktree === "/" ? Instance.directory : Instance.worktree
}

function outputName(value: string | undefined) {
  const name = value?.trim() || "output.json"
  if (name.includes("/") || name.includes("\\") || name.includes("..")) {
    throw new Error("output_name must be a simple filename")
  }
  return name
}

export const PythonTool = Tool.define("python", async () => {
  return {
    description: DESCRIPTION,
    parameters: z.object({
      script_id: z.string().describe("Allowlisted script id (built-in or project)"),
      input_json: z.record(z.string(), z.unknown()).optional(),
      output_name: z.string().optional(),
      timeout: z.number().int().positive().optional(),
      workdir: z.string().optional(),
      description: z.string().describe("Clear, concise description of what this script does"),
    }),
    async execute(params, ctx) {
      const config = await Config.get()
      const pythonPath = config.python?.pythonPath ?? "python3"
      const workdir =
        params.workdir ??
        (Instance.project.vcs === "git" ? await SessionWorktree.ensure({ sessionId: ctx.sessionID }) : Instance.directory)
      const timeout = params.timeout ?? DEFAULT_TIMEOUT

      const script = await ScriptRegistry.resolve({ scriptId: params.script_id })
      const base = baseDir()
      const artifactsRoot = path.join(base, ".opencode", "artifacts", ctx.sessionID)
      const inputPath = path.join(artifactsRoot, "python", "input.json")
      const outputFile = outputName(params.output_name)
      const outputPath = path.join(artifactsRoot, "python", outputFile)

      await fs.mkdir(path.dirname(outputPath), { recursive: true })

      const writer = await EvidenceWriter.open({ sessionId: ctx.sessionID })
      const inputData = params.input_json ?? {}
      const inputEntry = await writer.artifact({
        kind: "python-input",
        path: "python/input.json",
        data: stableJson(inputData),
      })

      const network =
        config.python?.allowNetwork === true
          ? config.python.allowedDomains && config.python.allowedDomains.length > 0
            ? { mode: "allowlist" as const, allowedDomains: config.python.allowedDomains }
            : { mode: "full" as const, note: "python.allowNetwork enabled without allowlist" }
          : { mode: "deny_all" as const }

      const capability = {
        readonlyPaths: [Instance.worktree],
        writePaths: [workdir, path.join(Instance.worktree, ".opencode")],
        exportPaths: [],
        network,
        workdirMode: Instance.project.vcs === "git" ? "isolated" : "shared",
      }

      await ctx.ask({
        permission: "python",
        patterns: [params.script_id],
        always: ["*"],
        metadata: {
          capability: {
            cwd: workdir,
            timeoutMs: timeout,
            ...capability,
            script: {
              id: script.id,
              sha256: script.sha256,
              path: script.path,
            },
            pythonPath,
            inputPath,
            outputPath,
          },
        },
      })

      const run = await SandboxRunner.run({
        sessionId: ctx.sessionID,
        toolName: "python",
        command: pythonPath,
        args: [script.path, "--input", inputPath, "--output", outputPath],
        cwd: workdir,
        capability,
        limits: { timeoutMs: timeout },
        abort: ctx.abort,
      })

      const outputFileHandle = Bun.file(outputPath)
      const outputExists = await outputFileHandle.exists()
      let outputText = outputExists ? await outputFileHandle.text().catch(() => "") : ""
      if (!outputText) {
        outputText = stableJson({
          error: "Python script did not produce output file",
          stdout: run.stdout,
          stderr: run.stderr,
        })
      }
      const outputEntry = await writer.artifact({
        kind: "python-output",
        path: `python/${outputFile}`,
        data: outputText,
      })

      await writer.event({
        specVersion: "event/1.0",
        ts: new Date().toISOString(),
        sessionId: ctx.sessionID,
        severity: "info",
        actor: "tool:python",
        type: "tool.python.executed",
        summary: "python tool executed",
        data: {
          script_id: script.id,
          script_sha256: script.sha256,
          input_path: inputEntry.path,
          output_path: outputEntry.path,
          python_path: pythonPath,
          network_policy: network,
        },
        redaction: { applied: true, policyVersion: "v1" },
      })

      const output = [
        "<python_output>",
        `path: ${outputEntry.path}`,
        `script_id: ${script.id}`,
        "</python_output>",
      ].join("\n")

      const metadata: PythonMetadata = {
        exit: run.exitCode,
        description: params.description,
        script_id: script.id,
        script_sha256: script.sha256,
        input_artifact: inputEntry.path,
        output_artifact: outputEntry.path,
        python_path: pythonPath,
      }
      return {
        title: params.description,
        metadata,
        output,
      }
    },
  }
})
