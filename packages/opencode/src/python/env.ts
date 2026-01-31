import path from "path"
import fs from "fs/promises"
import { spawn } from "child_process"

const DEFAULT_TIMEOUT = 2 * 60 * 1000

type RunResult = {
  ok: boolean
  stdout: string
  stderr: string
}

function collect(chunks: string[]) {
  return chunks.join("")
}

async function runProcess(command: string, args: string[], timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve) => {
    const stdoutChunks: string[] = []
    const stderrChunks: string[] = []
    const state = { settled: false }
    const proc = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] })

    const finalize = (result: RunResult) => {
      if (state.settled) return
      state.settled = true
      clearTimeout(timeout)
      resolve(result)
    }

    const timeout = setTimeout(() => {
      if (state.settled) return
      state.settled = true
      proc.kill("SIGKILL")
      const stdout = collect(stdoutChunks)
      const stderr = collect(stderrChunks) || "timeout"
      resolve({ ok: false, stdout, stderr })
    }, timeoutMs)

    proc.stdout?.on("data", (chunk) => {
      stdoutChunks.push(chunk.toString())
    })
    proc.stderr?.on("data", (chunk) => {
      stderrChunks.push(chunk.toString())
    })
    proc.once("error", (err) => {
      const stdout = collect(stdoutChunks)
      const stderr = collect(stderrChunks) || (err instanceof Error ? err.message : String(err))
      finalize({ ok: false, stdout, stderr })
    })
    proc.once("exit", (code) => {
      const stdout = collect(stdoutChunks)
      const stderr = collect(stderrChunks)
      if (code === 0) {
        finalize({ ok: true, stdout, stderr })
        return
      }
      const reason = stderr || `exit ${code ?? "unknown"}`
      finalize({ ok: false, stdout, stderr: reason })
    })
  })
}

export async function computeFileSha256(filePath: string): Promise<string> {
  const file = Bun.file(filePath)
  const buffer = await file.arrayBuffer()
  const hash = new Bun.CryptoHasher("sha256")
  hash.update(buffer)
  return hash.digest("hex")
}

export function resolveVenvDir({ baseDir, venvKey }: { baseDir: string; venvKey: string }): string {
  return path.join(baseDir, ".opencode", "runtime", "python", "venv", venvKey)
}

export function resolveVenvPythonPath(venvDir: string): string {
  if (process.platform === "win32") return path.join(venvDir, "Scripts", "python.exe")
  return path.join(venvDir, "bin", "python")
}

export async function ensureVenv({ pythonPath, venvDir }: { pythonPath: string; venvDir: string }): Promise<void> {
  const venvPython = resolveVenvPythonPath(venvDir)
  const exists = await Bun.file(venvPython).exists()
  if (exists) return
  await fs.mkdir(venvDir, { recursive: true })
  const result = await runProcess(pythonPath, ["-m", "venv", venvDir], DEFAULT_TIMEOUT)
  if (result.ok) return
  throw new Error(`python -m venv failed: ${result.stderr}`)
}

export async function pipInstallOffline(options: {
  venvPython: string
  wheelhousePath: string
  lockFile: string
  timeoutMs: number
}): Promise<RunResult> {
  const args = [
    "-m",
    "pip",
    "install",
    "--no-index",
    "--find-links",
    options.wheelhousePath,
    "--require-hashes",
    "-r",
    options.lockFile,
  ]
  return runProcess(options.venvPython, args, options.timeoutMs)
}

export async function pipInstallOnline(options: {
  venvPython: string
  lockFile: string
  timeoutMs: number
}): Promise<RunResult> {
  const args = ["-m", "pip", "install", "--require-hashes", "-r", options.lockFile]
  return runProcess(options.venvPython, args, options.timeoutMs)
}

export async function pipFreeze({ venvPython }: { venvPython: string }): Promise<string> {
  const result = await runProcess(venvPython, ["-m", "pip", "freeze"], DEFAULT_TIMEOUT)
  if (result.ok) return result.stdout
  throw new Error(result.stderr)
}
