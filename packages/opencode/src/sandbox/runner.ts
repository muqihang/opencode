import z from "zod"
import os from "os"
import { spawn } from "child_process"
import { $ } from "bun"
import { Shell } from "@/shell/shell"
import { EvidenceWriter } from "@/evidence/writer"
import { captureWorktreePatch } from "@/worktree/changes"
import { buildExecPolicyEval } from "@/sandbox/execpolicy"
import { stableJson } from "@/util/stable-json"

const NetworkPolicy = z.union([
  z.object({ mode: z.literal("deny_all") }).strict(),
  z
    .object({
      mode: z.literal("allowlist"),
      allowedDomains: z.array(z.string().min(1)),
    })
    .strict(),
  z
    .object({
      mode: z.literal("full"),
      note: z.string().min(1).optional(),
    })
    .strict(),
])

const Capability = z
  .object({
    readonlyPaths: z.array(z.string().min(1)),
    writePaths: z.array(z.string().min(1)),
    exportPaths: z.array(z.string().min(1)),
    network: NetworkPolicy,
    workdirMode: z.enum(["isolated", "shared"]),
  })
  .strict()

const Limits = z
  .object({
    timeoutMs: z.number().int().positive(),
    maxProcesses: z.number().int().positive().optional(),
    maxMemoryMb: z.number().int().positive().optional(),
    maxCpuSeconds: z.number().int().positive().optional(),
  })
  .strict()

const RunInput = z
  .object({
    sessionId: z.string().min(1),
    toolName: z.string().min(1),
    command: z.string().min(1),
    args: z.array(z.string().min(1)).optional(),
    cwd: z.string().min(1).optional(),
    capability: Capability,
    limits: Limits,
    abort: z.custom<AbortSignal>((value) => value instanceof AbortSignal).optional(),
  })
  .strict()

async function readRepoInfo(cwd: string) {
  const head = await $`git rev-parse HEAD`.quiet().nothrow().cwd(cwd)
  if (head.exitCode !== 0) return undefined
  const commit = head.stdout?.toString().trim()
  if (!commit) return undefined

  const status = await $`git status --porcelain`.quiet().nothrow().cwd(cwd)
  const dirty = status.exitCode === 0 && status.stdout?.toString().trim().length > 0

  const root = await $`git rev-parse --show-toplevel`.quiet().nothrow().cwd(cwd)
  const rootPath = root.exitCode === 0 ? root.stdout?.toString().trim() : undefined

  return {
    commit,
    dirty,
    root: rootPath || undefined,
    worktree: cwd,
  }
}

export const SandboxRunner = {
  async run(input: z.infer<typeof RunInput>) {
    const req = RunInput.parse(input)
    const writer = await EvidenceWriter.open({ sessionId: req.sessionId })
    const shell = Shell.acceptable()
    const backend = "soft"
    const enforcement = "soft"
    const runCwd = req.cwd ?? process.cwd()
    const startedAt = new Date().toISOString()
    await writer.event({
      specVersion: "event/1.0",
      ts: startedAt,
      sessionId: req.sessionId,
      severity: "info",
      actor: `tool:${req.toolName}`,
      type: "tool.started",
      summary: "tool started",
      redaction: { applied: true, policyVersion: "v1" },
    })
    await writer.event({
      specVersion: "event/1.0",
      ts: new Date().toISOString(),
      sessionId: req.sessionId,
      severity: "info",
      actor: "sandbox:runner",
      type: "sandbox.backend_selected",
      summary: "sandbox backend selected",
      data: {
        backend,
        enforcement,
        network: req.capability.network,
        workdirMode: req.capability.workdirMode,
        readonlyPaths: req.capability.readonlyPaths,
        writePaths: req.capability.writePaths,
        exportPaths: req.capability.exportPaths,
      },
      redaction: { applied: true, policyVersion: "v1" },
    })

    const execPolicy = buildExecPolicyEval({
      toolName: req.toolName,
      command: req.command,
      args: req.args,
      cwd: runCwd,
      backend,
      enforcement,
      capability: req.capability,
      limits: req.limits,
    })
    try {
      const entry = await writer.artifact({
        kind: "execpolicy-eval",
        path: "policy/execpolicy.eval.json",
        data: stableJson(execPolicy),
      })
      await writer.event({
        specVersion: "event/1.0",
        ts: new Date().toISOString(),
        sessionId: req.sessionId,
        severity: "info",
        actor: "sandbox:runner",
        type: "policy.exec_evaluated",
        summary: "exec policy evaluated",
        data: {
          artifact: entry.path,
          sha256: entry.sha256,
        },
        redaction: { applied: true, policyVersion: "v1" },
      })
    } catch {
      // Best-effort: failures are recorded by EvidenceWriter when possible.
    }

    const proc = req.args
      ? spawn(req.command, req.args, {
          shell: false,
          cwd: runCwd,
          env: {
            ...process.env,
          },
          stdio: ["ignore", "pipe", "pipe"],
          detached: process.platform !== "win32",
        })
      : spawn(req.command, {
          shell,
          cwd: runCwd,
          env: {
            ...process.env,
          },
          stdio: ["ignore", "pipe", "pipe"],
          detached: process.platform !== "win32",
        })

    let stdout = ""
    let stderr = ""
    proc.stdout?.on("data", (chunk) => {
      stdout += chunk.toString()
    })
    proc.stderr?.on("data", (chunk) => {
      stderr += chunk.toString()
    })

    let timedOut = false
    let aborted = false
    let exited = false
    const timeout = req.limits.timeoutMs
    const abort = req.abort
    const abortHandler = () => {
      aborted = true
      void Shell.killTree(proc, { exited: () => exited })
    }
    if (abort?.aborted) abortHandler()
    if (abort && !abort.aborted) {
      abort.addEventListener("abort", abortHandler, { once: true })
    }
    const timeoutTimer = setTimeout(() => {
      timedOut = true
      void Shell.killTree(proc, { exited: () => exited })
    }, timeout + 50)

    let failure: unknown = null
    await new Promise<void>((resolve, reject) => {
      proc.once("exit", () => {
        exited = true
        if (abort) abort.removeEventListener("abort", abortHandler)
        clearTimeout(timeoutTimer)
        resolve()
      })
      proc.once("error", (error) => {
        exited = true
        if (abort) abort.removeEventListener("abort", abortHandler)
        clearTimeout(timeoutTimer)
        reject(error)
      })
    }).catch((error) => {
      failure = error
    })

    const stdoutEntry = await writer.artifact({ kind: "stdout", data: stdout })
    const stderrEntry = await writer.artifact({ kind: "stderr", data: stderr })

    const doneAt = new Date().toISOString()
    await writer.event({
      specVersion: "event/1.0",
      ts: doneAt,
      sessionId: req.sessionId,
      severity: failure ? "error" : "info",
      actor: `tool:${req.toolName}`,
      type: "tool.completed",
      summary: failure ? "tool completed with error" : "tool completed",
      data: {
        status: failure ? "error" : aborted ? "aborted" : timedOut ? "timeout" : "ok",
      },
      redaction: { applied: true, policyVersion: "v1" },
    })
    if (req.capability.workdirMode === "isolated") {
      await captureWorktreePatch({
        workdir: runCwd,
        sessionId: req.sessionId,
        writer,
      })
    }
    const evidence = { finalized: true, error: undefined as string | undefined }
    try {
      const repoInfo = await readRepoInfo(runCwd)
      const runtimeInfo = {
        node: process.version,
        bun: typeof Bun !== "undefined" ? Bun.version : undefined,
      }
      const runtime =
        runtimeInfo.node || runtimeInfo.bun
          ? { node: runtimeInfo.node, bun: runtimeInfo.bun }
          : undefined
      const osInfo = {
        platform: process.platform,
        arch: process.arch,
        release: os.release(),
      }
      await writer.pack({
        handoff: failure ? "tool failed" : "ok",
        execution: {
          kind: "sandbox",
          id: `sandbox:${req.sessionId}`,
          backend,
          enforcement,
        },
        environment: {
          os: osInfo,
          runtime,
          repo: repoInfo,
        },
      })
    } catch (error) {
      evidence.finalized = false
      evidence.error = error instanceof Error ? error.message : String(error)
    }
    if (failure) throw failure

    return {
      backend,
      enforcement,
      exitCode: proc.exitCode ?? -1,
      timedOut,
      aborted,
      stdout,
      stderr,
      stdoutArtifactPath: stdoutEntry.path,
      stderrArtifactPath: stderrEntry.path,
      producedArtifacts: [
        { path: stdoutEntry.path, sha256: stdoutEntry.sha256, kind: "stdout" },
        { path: stderrEntry.path, sha256: stderrEntry.sha256, kind: "stderr" },
      ],
      evidence,
    }
  },
}
