import path from "path"
import z from "zod"
import { EvidenceWriter } from "@/evidence/writer"
import { LSP } from "@/lsp"
import type { LSPClient } from "@/lsp/client"
import { SandboxRunner } from "@/sandbox/runner"
import { stableJson } from "@/util/stable-json"
import { Filesystem } from "@/util/filesystem"

const GateInput = z
  .object({
    sessionId: z.string().min(1),
    workdir: z.string().min(1),
    changedFiles: z.array(z.string().min(1)),
    lint: z.boolean().optional(),
    diffCheck: z.boolean().optional(),
  })
  .strict()

type GateCheck = {
  id: string
  command: string
  status: "pass" | "fail" | "skip"
  artifact?: string
}

type GateResult = {
  checks: GateCheck[]
  artifacts: string[]
}

function normalizePath(value: string) {
  return Filesystem.normalizePath(value)
}

async function runLint(input: {
  workdir: string
  changedFiles: string[]
  writer: Awaited<ReturnType<typeof EvidenceWriter.open>>
}) {
  const absoluteFiles = input.changedFiles.map((file) =>
    normalizePath(path.resolve(input.workdir, file)),
  )
  const fileSet = new Set(absoluteFiles)
  const diagnostics = await LSP.diagnostics()
  const filtered: Record<string, LSPClient.Diagnostic[]> = {}
  for (const [file, items] of Object.entries(diagnostics)) {
    const normalized = normalizePath(file)
    if (!fileSet.has(normalized)) continue
    filtered[file] = items
  }
  const errors = Object.values(filtered)
    .flat()
    .filter((item) => item.severity === 1)

  const artifact = await input.writer.artifact({
    kind: "gate-lsp-diagnostics",
    path: "gate/lsp-diagnostics.json",
    data: stableJson({ files: filtered }),
  })

  return {
    check: {
      id: "gate:lsp",
      command: "lsp.diagnostics",
      status: errors.length > 0 ? "fail" : "pass",
      artifact: artifact.path,
    } satisfies GateCheck,
    artifactPath: artifact.path,
  }
}

async function runDiffCheck(input: {
  sessionId: string
  workdir: string
  writer: Awaited<ReturnType<typeof EvidenceWriter.open>>
}) {
  try {
    const result = await SandboxRunner.run({
      sessionId: input.sessionId,
      toolName: "gate.diff-check",
      command: "git",
      args: ["diff", "--check"],
      cwd: input.workdir,
      capability: {
        readonlyPaths: [input.workdir],
        writePaths: [path.join(input.workdir, ".opencode")],
        exportPaths: [],
        network: { mode: "deny_all" },
        workdirMode: "shared",
      },
      limits: { timeoutMs: 5000 },
    })

    const output = result.stdout.trim()
    const status = output.length > 0 || result.exitCode !== 0 ? "fail" : "pass"
    return {
      check: {
        id: "gate:git-diff-check",
        command: "git diff --check",
        status,
        artifact: result.stdoutArtifactPath,
      } satisfies GateCheck,
      artifactPath: result.stdoutArtifactPath,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const artifact = await input.writer.artifact({
      kind: "gate-error",
      path: `gate/git-diff-check-error.json`,
      data: stableJson({ error: message }),
    })
    return {
      check: {
        id: "gate:git-diff-check",
        command: "git diff --check",
        status: "fail",
        artifact: artifact.path,
      } satisfies GateCheck,
      artifactPath: artifact.path,
    }
  }
}

export const GateRunner = {
  async run(input: z.infer<typeof GateInput>): Promise<GateResult> {
    const data = GateInput.parse(input)
    const writer = await EvidenceWriter.open({ sessionId: data.sessionId })
    const checks: GateCheck[] = []
    const artifacts: string[] = []

    if (data.lint !== false) {
      const lint = await runLint({ workdir: data.workdir, changedFiles: data.changedFiles, writer })
      await writer.check(lint.check)
      checks.push(lint.check)
      artifacts.push(lint.artifactPath)
    }

    if (data.diffCheck !== false) {
      const diff = await runDiffCheck({ sessionId: data.sessionId, workdir: data.workdir, writer })
      await writer.check(diff.check)
      checks.push(diff.check)
      artifacts.push(diff.artifactPath)
    }

    if (checks.length === 0) {
      const fallback = await runDiffCheck({ sessionId: data.sessionId, workdir: data.workdir, writer })
      await writer.check(fallback.check)
      checks.push(fallback.check)
      artifacts.push(fallback.artifactPath)
    }

    await writer.pack({ handoff: "gate" })

    return { checks, artifacts }
  },
}
