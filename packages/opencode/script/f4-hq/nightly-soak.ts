#!/usr/bin/env bun

import fs from "fs/promises"
import path from "path"

type Gate = {
  ok: boolean
  note: string
}

type SoakInput = {
  restart_resume_monotonicity: {
    checkpoints: number[]
    monotonic: boolean
  }
  strict_reference_gate: {
    violations: number
    fail_closed: boolean
  }
  assisted_compaction_guardrails: {
    degraded: number
    verify_failures: number
    fallback_safe: boolean
  }
  nightly_soak_pass_rate: number
  restart_resume_regression: number
}

export type F4HqNightlySoakResult = {
  gates: {
    restart_resume_monotonicity: Gate
    strict_reference_gate: Gate
    assisted_compaction_guardrails: Gate
  }
  metrics: {
    nightly_soak_pass_rate: number
    restart_resume_regression: number
  }
  output: string
  outputPath: string
  exitCode: number
}

type RunInput = {
  rootDir?: string
  sourcePath?: string
  write?: (text: string) => void
}

const parseArg = (flag: string) => {
  const i = process.argv.indexOf(flag)
  const v = i >= 0 ? process.argv.at(i + 1) : undefined
  return v
}

export const runF4HqNightlySoak = async (input: RunInput = {}): Promise<F4HqNightlySoakResult> => {
  const rootDir = input.rootDir ?? path.resolve(import.meta.dir, "..", "..", "..", "..")
  const sourcePath =
    input.sourcePath ??
    path.join(
      rootDir,
      "docs",
      "plans",
      "evidence",
      "2026-02-10-v1_6-blocking",
      "card-blk-06",
      "f4-hq",
      "nightly-soak-input.json",
    )
  const text = await fs.readFile(sourcePath, "utf8")
  const data = JSON.parse(text) as SoakInput

  const monotonic = data.restart_resume_monotonicity.checkpoints.every((n, i, arr) => i === 0 || arr[i - 1] <= n)
  const restart = {
    ok: data.restart_resume_monotonicity.monotonic && monotonic,
    note:
      data.restart_resume_monotonicity.monotonic && monotonic
        ? "resume checkpoints monotonic"
        : "resume checkpoints not monotonic",
  }

  const strict = {
    ok: data.strict_reference_gate.violations === 0 && data.strict_reference_gate.fail_closed,
    note:
      data.strict_reference_gate.violations === 0 && data.strict_reference_gate.fail_closed
        ? "no violations and fail-closed enabled"
        : "violations exist or fail-closed disabled",
  }

  const guard = {
    ok:
      data.assisted_compaction_guardrails.degraded === 0 &&
      data.assisted_compaction_guardrails.verify_failures === 0 &&
      data.assisted_compaction_guardrails.fallback_safe,
    note:
      data.assisted_compaction_guardrails.degraded === 0 &&
      data.assisted_compaction_guardrails.verify_failures === 0 &&
      data.assisted_compaction_guardrails.fallback_safe
        ? "degraded path guarded and fallback safe"
        : "guardrail degraded or fallback unsafe",
  }

  const gates = {
    restart_resume_monotonicity: restart,
    strict_reference_gate: strict,
    assisted_compaction_guardrails: guard,
  }

  const metrics = {
    nightly_soak_pass_rate: data.nightly_soak_pass_rate,
    restart_resume_regression: data.restart_resume_regression,
  }

  const outputPath = path.join(
    rootDir,
    "docs",
    "plans",
    "evidence",
    "2026-02-10-v1_6-blocking",
    "card-blk-06",
    "f4-hq",
    "nightly-soak",
    "f4-hq-nightly-soak-latest.md",
  )
  const exitCode = gates.restart_resume_monotonicity.ok && gates.strict_reference_gate.ok && gates.assisted_compaction_guardrails.ok ? 0 : 1
  const relSource = path.relative(rootDir, sourcePath)
  const relOutput = path.relative(rootDir, outputPath)
  const output = [
    "# F4 HQ Nightly Soak",
    "",
    "## Gate Status",
    `- restart_resume_monotonicity: ${gates.restart_resume_monotonicity.ok} | ${gates.restart_resume_monotonicity.note}`,
    `- strict_reference_gate: ${gates.strict_reference_gate.ok} | ${gates.strict_reference_gate.note}`,
    `- assisted_compaction_guardrails: ${gates.assisted_compaction_guardrails.ok} | ${gates.assisted_compaction_guardrails.note}`,
    "",
    "## Metrics",
    `- nightly_soak_pass_rate: ${metrics.nightly_soak_pass_rate}`,
    `- restart_resume_regression: ${metrics.restart_resume_regression}`,
    "",
    "## Replay Snippet",
    `- nightly_run: bun run ./packages/opencode/script/f4-hq/nightly-soak.ts --source ${relSource}`,
    `- artifact_location: ${relOutput}`,
    "- decision_criteria: all three gates must be true; any false gate blocks release.",
    `- exit_code: ${exitCode}`,
  ].join("\n")

  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.writeFile(outputPath, output + "\n", "utf8")

  const write = input.write ?? ((text: string) => console.log(text))
  write(output)
  write(`outputPath=${outputPath}`)
  write(`exitCode=${exitCode}`)

  return {
    gates,
    metrics,
    output,
    outputPath,
    exitCode,
  }
}

if (import.meta.main) {
  const rootDir = parseArg("--root")
  const sourcePath = parseArg("--source")
  const result = await runF4HqNightlySoak({
    rootDir,
    sourcePath,
  })
  process.exit(result.exitCode)
}
