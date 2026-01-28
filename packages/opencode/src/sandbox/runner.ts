import z from "zod"
import { spawn } from "child_process"
import { Shell } from "@/shell/shell"
import { EvidenceWriter } from "@/evidence/writer"

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

export const SandboxRunner = {
  async run(input: z.infer<typeof RunInput>) {
    const req = RunInput.parse(input)
    const writer = await EvidenceWriter.open({ sessionId: req.sessionId })
    const shell = Shell.acceptable()
    const backend = "soft"
    const enforcement = "soft"
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

    const proc = req.args
      ? spawn(req.command, req.args, {
          shell: false,
          cwd: req.cwd,
          env: {
            ...process.env,
          },
          stdio: ["ignore", "pipe", "pipe"],
          detached: process.platform !== "win32",
        })
      : spawn(req.command, {
          shell,
          cwd: req.cwd,
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
    const evidence = { finalized: true, error: undefined as string | undefined }
    try {
      await writer.pack({
        handoff: failure ? "tool failed" : "ok",
        execution: {
          kind: "sandbox",
          id: `sandbox:${req.sessionId}`,
          backend,
          enforcement,
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
