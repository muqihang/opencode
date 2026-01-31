import z from "zod"
import path from "path"
import fs from "fs/promises"
import { spawn } from "child_process"
import { Tool } from "./tool"
import DESCRIPTION from "./python.txt"
import { Config } from "@/config/config"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { resolveWorkdirMode, resolveWorkdirPath } from "@/workdir/resolve"
import { SandboxRunner } from "@/sandbox/runner"
import { ScriptRegistry } from "@/python/registry"
import {
  computeFileSha256,
  ensureVenv,
  pipFreeze,
  pipInstallOffline,
  pipInstallOnline,
  resolveVenvDir,
  resolveVenvPythonPath,
} from "@/python/env"
import { EvidenceWriter } from "@/evidence/writer"
import { Filesystem } from "@/util/filesystem"
import { stableJson } from "@/util/stable-json"

const DEFAULT_TIMEOUT = 2 * 60 * 1000
const DEPS_LOCK_ARTIFACT = "python/deps-lock.sha256.txt"
const PIP_FREEZE_ARTIFACT = "python/pip-freeze.txt"

type PythonMetadata = {
  exit: number
  description: string
  script_id: string
  script_sha256: string
  input_artifact: string
  output_artifact: string
  python_path: string
  python_version_artifact?: string
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

function errorText(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

function hashText(text: string) {
  const hash = new Bun.CryptoHasher("sha256")
  hash.update(text)
  return hash.digest("hex")
}

async function pythonVersion(pythonPath: string) {
  return new Promise<{ text?: string; error?: string }>((resolve) => {
    let stdout = ""
    let stderr = ""
    let settled = false
    const proc = spawn(pythonPath, ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
    })
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      proc.kill("SIGKILL")
      resolve({ error: "timeout" })
    }, 5000)
    proc.stdout?.on("data", (chunk) => {
      stdout += chunk.toString()
    })
    proc.stderr?.on("data", (chunk) => {
      stderr += chunk.toString()
    })
    proc.once("error", (err) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve({ error: err instanceof Error ? err.message : String(err) })
    })
    proc.once("exit", () => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      const text = (stdout || stderr).trim()
      resolve(text ? { text } : { error: "empty output" })
    })
  })
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
      const parsed = Session.Info.shape.id.safeParse(ctx.sessionID)
      const info = parsed.success ? await Session.get(ctx.sessionID).catch(() => undefined) : undefined
      const kind = info?.parentID ? "child" : "primary"
      const mode = await resolveWorkdirMode({ kind })
      const workdir = params.workdir ?? (await resolveWorkdirPath({ sessionId: ctx.sessionID, mode }))
      const timeout = params.timeout ?? DEFAULT_TIMEOUT

      const script = await ScriptRegistry.resolve({ scriptId: params.script_id })
      const base = baseDir()
      const artifactsRoot = path.join(base, ".opencode", "artifacts", ctx.sessionID)
      const inputPath = path.join(artifactsRoot, "python", "input.json")
      const outputFile = outputName(params.output_name)
      const outputPath = path.join(artifactsRoot, "python", outputFile)

      await fs.mkdir(path.dirname(outputPath), { recursive: true })

      const writer = await EvidenceWriter.open({ sessionId: ctx.sessionID })
      const version = await pythonVersion(pythonPath)
      const versionEntry = version.text
        ? await writer.artifact({
            kind: "python-version",
            path: "python/python-version.txt",
            data: version.text,
          })
        : undefined
      await writer.event({
        specVersion: "event/1.0",
        ts: new Date().toISOString(),
        sessionId: ctx.sessionID,
        severity: version.text ? "info" : "warn",
        actor: "tool:python",
        type: "tool.python.env",
        summary: version.text ? "python version recorded" : "python version unavailable",
        data: {
          python_path: pythonPath,
          version: version.text,
          artifact: versionEntry?.path,
          error: version.text ? undefined : version.error,
        },
        redaction: { applied: true, policyVersion: "v1" },
      })
      const inputData = params.input_json ?? {}
      const inputEntry = await writer.artifact({
        kind: "python-input",
        path: "python/input.json",
        data: stableJson(inputData),
      })

      const deps = config.python?.deps
      const depsMode = deps?.mode ?? "offline"
      const allowOnlineFallback = deps?.allowOnlineFallback ?? false
      const depsEnabled =
        depsMode !== "disabled" &&
        (Boolean(deps?.lockFile) || Boolean(deps?.wheelhousePath) || depsMode === "online")

      const resolveDepsPath = async (label: string, value: string) => {
        const resolved = path.isAbsolute(value) ? value : path.resolve(base, value)
        const real = await fs.realpath(resolved).catch(() => resolved)
        const allowed = Instance.containsPath(real)
        if (allowed) return real
        await writer.event({
          specVersion: "event/1.0",
          ts: new Date().toISOString(),
          sessionId: ctx.sessionID,
          severity: "warn",
          actor: "tool:python",
          type: "tool.python.deps.path_rejected",
          summary: "python deps path rejected",
          data: {
            label,
            path: resolved,
          },
          redaction: { applied: true, policyVersion: "v1" },
        })
        throw new Error(`${label} must be within project boundary`)
      }

      const lockPath = depsEnabled && deps?.lockFile ? await resolveDepsPath("lockFile", deps.lockFile) : undefined
      const wheelhousePath =
        depsEnabled && deps?.wheelhousePath ? await resolveDepsPath("wheelhousePath", deps.wheelhousePath) : undefined
      const lockExists = lockPath ? await Filesystem.exists(lockPath) : false
      if (lockPath && !lockExists) {
        await writer.event({
          specVersion: "event/1.0",
          ts: new Date().toISOString(),
          sessionId: ctx.sessionID,
          severity: "warn",
          actor: "tool:python",
          type: "tool.python.deps.offline_install_failed",
          summary: "python deps lock file missing",
          data: { lock_file: lockPath },
          redaction: { applied: true, policyVersion: "v1" },
        })
        throw new Error("python.deps.lockFile not found")
      }
      if (depsEnabled && !lockPath) {
        await writer.event({
          specVersion: "event/1.0",
          ts: new Date().toISOString(),
          sessionId: ctx.sessionID,
          severity: "warn",
          actor: "tool:python",
          type: "tool.python.deps.offline_install_failed",
          summary: "python deps lock file required",
          data: { mode: depsMode },
          redaction: { applied: true, policyVersion: "v1" },
        })
        throw new Error("python.deps.lockFile is required when deps are enabled")
      }

      const lockHashResult = lockPath
        ? await computeFileSha256(lockPath)
            .then((hash) => ({ ok: true as const, hash }))
            .catch((error) => ({ ok: false as const, error }))
        : undefined
      const lockHashValue = lockHashResult?.ok
        ? lockHashResult.hash
        : lockPath
          ? "lock-error"
          : "no-lock"
      if (depsEnabled && lockPath) {
        const lockData = lockHashResult?.ok
          ? lockHashResult.hash
          : stableJson({ error: errorText(lockHashResult?.error), path: lockPath })
        const lockEntry = await writer.artifact({
          kind: "python-deps-lock",
          path: DEPS_LOCK_ARTIFACT,
          data: lockData,
        })
        if (!lockHashResult?.ok) {
          await writer.event({
            specVersion: "event/1.0",
            ts: new Date().toISOString(),
            sessionId: ctx.sessionID,
            severity: "warn",
            actor: "tool:python",
            type: "tool.python.deps.lock_hash_failed",
            summary: "python deps lock hash failed",
            data: { lock_file: lockPath, artifact: lockEntry.path },
            redaction: { applied: true, policyVersion: "v1" },
          })
          throw new Error("python.deps.lockFile could not be hashed")
        }
      }

      if (depsEnabled) {
        await writer.event({
          specVersion: "event/1.0",
          ts: new Date().toISOString(),
          sessionId: ctx.sessionID,
          severity: "info",
          actor: "tool:python",
          type: "tool.python.deps.policy",
          summary: "python deps policy resolved",
          data: {
            mode: depsMode,
            allow_online_fallback: allowOnlineFallback,
            lock_file: lockPath ? path.relative(base, lockPath) : undefined,
            wheelhouse_path: wheelhousePath ? path.relative(base, wheelhousePath) : undefined,
          },
          redaction: { applied: true, policyVersion: "v1" },
        })
      }

      const venvKey = depsEnabled
        ? hashText(
            stableJson({
              python_path: pythonPath,
              lock: lockHashValue,
              wheelhouse: wheelhousePath ?? "no-wheelhouse",
              mode: depsMode,
            }),
          )
        : "base"
      const venvDir = depsEnabled ? resolveVenvDir({ baseDir: base, venvKey }) : ""
      const venvPython = depsEnabled ? resolveVenvPythonPath(venvDir) : pythonPath
      const pythonExec = depsEnabled ? venvPython : pythonPath

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
        workdirMode: mode,
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
            pythonPath: pythonExec,
            inputPath,
            outputPath,
          },
        },
      })

      const writePipFreeze = async () => {
        const result = await pipFreeze({ venvPython })
          .then((text) => ({ ok: true as const, text }))
          .catch((error) => ({ ok: false as const, error }))
        const data = result.ok ? result.text : stableJson({ error: errorText(result.error) })
        const entry = await writer.artifact({
          kind: "python-pip-freeze",
          path: PIP_FREEZE_ARTIFACT,
          data,
        })
        if (result.ok) return entry
        await writer.event({
          specVersion: "event/1.0",
          ts: new Date().toISOString(),
          sessionId: ctx.sessionID,
          severity: "warn",
          actor: "tool:python",
          type: "tool.python.deps.pip_freeze_failed",
          summary: "python deps pip freeze failed",
          data: { artifact: entry.path, error: errorText(result.error) },
          redaction: { applied: true, policyVersion: "v1" },
        })
        return entry
      }

      if (depsEnabled) {
        await ensureVenv({ pythonPath, venvDir })
        if (depsMode === "offline") {
          if (!lockPath) {
            await writer.event({
              specVersion: "event/1.0",
              ts: new Date().toISOString(),
              sessionId: ctx.sessionID,
              severity: "warn",
              actor: "tool:python",
              type: "tool.python.deps.offline_install_failed",
              summary: "python deps lock file missing",
              data: { mode: depsMode },
              redaction: { applied: true, policyVersion: "v1" },
            })
            await writePipFreeze()
            throw new Error("python.deps.lockFile is required for offline mode")
          }
          if (!wheelhousePath) {
            await writer.event({
              specVersion: "event/1.0",
              ts: new Date().toISOString(),
              sessionId: ctx.sessionID,
              severity: "warn",
              actor: "tool:python",
              type: "tool.python.deps.offline_install_failed",
              summary: "python deps wheelhouse missing",
              data: { lock_file: lockPath },
              redaction: { applied: true, policyVersion: "v1" },
            })
            await writePipFreeze()
            throw new Error("python.deps.wheelhousePath is required for offline mode")
          }
          const wheelhouseOk = await Filesystem.isDir(wheelhousePath)
          if (!wheelhouseOk) {
            await writer.event({
              specVersion: "event/1.0",
              ts: new Date().toISOString(),
              sessionId: ctx.sessionID,
              severity: "warn",
              actor: "tool:python",
              type: "tool.python.deps.offline_install_failed",
              summary: "python deps wheelhouse invalid",
              data: { wheelhouse_path: wheelhousePath },
              redaction: { applied: true, policyVersion: "v1" },
            })
            await writePipFreeze()
            throw new Error("python.deps.wheelhousePath must be a directory")
          }
          await writer.event({
            specVersion: "event/1.0",
            ts: new Date().toISOString(),
            sessionId: ctx.sessionID,
            severity: "info",
            actor: "tool:python",
            type: "tool.python.deps.offline_install_started",
            summary: "python deps offline install started",
            data: { lock_file: lockPath, wheelhouse_path: wheelhousePath },
            redaction: { applied: true, policyVersion: "v1" },
          })
          const lockStat = await fs.stat(lockPath)
          const lockIsEmpty = lockStat.size === 0
          if (lockIsEmpty) {
            await writer.event({
              specVersion: "event/1.0",
              ts: new Date().toISOString(),
              sessionId: ctx.sessionID,
              severity: "info",
              actor: "tool:python",
              type: "tool.python.deps.offline_install_completed",
              summary: "python deps offline install skipped (empty lock)",
              data: { lock_file: lockPath },
              redaction: { applied: true, policyVersion: "v1" },
            })
          }
          if (!lockIsEmpty) {
            const install = await pipInstallOffline({
              venvPython,
              wheelhousePath,
              lockFile: lockPath,
              timeoutMs: timeout,
            })
            if (install.ok) {
              await writer.event({
                specVersion: "event/1.0",
                ts: new Date().toISOString(),
                sessionId: ctx.sessionID,
                severity: "info",
                actor: "tool:python",
                type: "tool.python.deps.offline_install_completed",
                summary: "python deps offline install completed",
                data: { lock_file: lockPath },
                redaction: { applied: true, policyVersion: "v1" },
              })
            }
            if (!install.ok) {
              const stderrEntry = await writer.artifact({
                kind: "python-deps-install-stderr",
                path: "python/deps-install.stderr.txt",
                data: install.stderr,
              })
              await writer.event({
                specVersion: "event/1.0",
                ts: new Date().toISOString(),
                sessionId: ctx.sessionID,
                severity: "warn",
                actor: "tool:python",
                type: "tool.python.deps.offline_install_failed",
                summary: "python deps offline install failed",
                data: { lock_file: lockPath, stderr_artifact: stderrEntry.path },
                redaction: { applied: true, policyVersion: "v1" },
              })
              if (!allowOnlineFallback) {
                await writePipFreeze()
                throw new Error(`python deps offline install failed: ${install.stderr}`)
              }
              if (network.mode === "deny_all") {
                await writer.event({
                  specVersion: "event/1.0",
                  ts: new Date().toISOString(),
                  sessionId: ctx.sessionID,
                  severity: "warn",
                  actor: "tool:python",
                  type: "tool.python.deps.online_fallback_blocked",
                  summary: "python deps online fallback blocked by network policy",
                  data: { network_policy: network },
                  redaction: { applied: true, policyVersion: "v1" },
                })
                await writePipFreeze()
                throw new Error("python deps online fallback blocked by network policy")
              }
              await writer.event({
                specVersion: "event/1.0",
                ts: new Date().toISOString(),
                sessionId: ctx.sessionID,
                severity: "warn",
                actor: "tool:python",
                type: "tool.python.deps.online_fallback_requested",
                summary: "python deps online fallback requested",
                data: { reason: "offline install failed", network_policy: network, lock_file: lockPath },
                redaction: { applied: true, policyVersion: "v1" },
              })
              const approval = await ctx
                .ask({
                  permission: "python.deps_online",
                  patterns: [params.script_id],
                  always: ["*"],
                  metadata: {
                    reason: "offline install failed",
                    lockFile: lockPath,
                    networkPolicy: network,
                  },
                })
                .then(() => ({ ok: true as const }))
                .catch((error) => ({ ok: false as const, error }))
              if (!approval.ok) {
                await writer.event({
                  specVersion: "event/1.0",
                  ts: new Date().toISOString(),
                  sessionId: ctx.sessionID,
                  severity: "warn",
                  actor: "tool:python",
                  type: "tool.python.deps.online_fallback_denied",
                  summary: "python deps online fallback denied",
                  data: { error: errorText(approval.error) },
                  redaction: { applied: true, policyVersion: "v1" },
                })
                await writePipFreeze()
                throw approval.error instanceof Error ? approval.error : new Error(String(approval.error))
              }
              const online = await pipInstallOnline({
                venvPython,
                lockFile: lockPath,
                timeoutMs: timeout,
              })
              if (online.ok) {
                await writer.event({
                  specVersion: "event/1.0",
                  ts: new Date().toISOString(),
                  sessionId: ctx.sessionID,
                  severity: "warn",
                  actor: "tool:python",
                  type: "tool.python.deps.online_fallback_used",
                  summary: "python deps online fallback used",
                  data: { network_policy: network, lock_file: lockPath },
                  redaction: { applied: true, policyVersion: "v1" },
                })
              }
              if (!online.ok) {
                const onlineStderr = await writer.artifact({
                  kind: "python-deps-install-stderr",
                  path: "python/deps-install-online.stderr.txt",
                  data: online.stderr,
                })
                await writer.event({
                  specVersion: "event/1.0",
                  ts: new Date().toISOString(),
                  sessionId: ctx.sessionID,
                  severity: "warn",
                  actor: "tool:python",
                  type: "tool.python.deps.online_fallback_failed",
                  summary: "python deps online fallback failed",
                  data: { lock_file: lockPath, stderr_artifact: onlineStderr.path },
                  redaction: { applied: true, policyVersion: "v1" },
                })
                await writePipFreeze()
                throw new Error(`python deps online fallback failed: ${online.stderr}`)
              }
            }
          }
          await writePipFreeze()
        }
      }

      const run = await SandboxRunner.run({
        sessionId: ctx.sessionID,
        toolName: "python",
        command: pythonExec,
        args: [script.path, "--input", inputPath, "--output", outputPath],
        cwd: workdir,
        capability,
        limits: { timeoutMs: timeout },
        abort: ctx.abort,
      })

      const postWriter = await EvidenceWriter.open({ sessionId: ctx.sessionID })
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
      const outputEntry = await postWriter.artifact({
        kind: "python-output",
        path: `python/${outputFile}`,
        data: outputText,
      })

      await postWriter.event({
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
          python_path: pythonExec,
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
        python_path: pythonExec,
        python_version_artifact: versionEntry?.path,
      }
      return {
        title: params.description,
        metadata,
        output,
      }
    },
  }
})
