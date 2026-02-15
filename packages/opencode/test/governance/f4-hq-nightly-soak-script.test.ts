import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../fixture/fixture"

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

type SoakResult = {
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

const source = async (root: string, input: SoakInput) => {
  const dir = path.join(root, "docs", "plans", "evidence", "2026-02-10-v1_6-blocking", "card-blk-06", "f4-hq")
  const file = path.join(dir, "nightly-soak-input.json")
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(file, JSON.stringify(input, null, 2), "utf8")
  return file
}

const run = async () => {
  const mod = await import("../../script/f4-hq/nightly-soak").catch(() => null)
  expect(mod).not.toBeNull()
  if (!mod) return null
  return mod.runF4HqNightlySoak as (input: {
    rootDir: string
    sourcePath: string
    write?: (text: string) => void
  }) => Promise<SoakResult>
}

describe("f4 hq nightly soak runner", () => {
  test("gates restart resume monotonicity", async () => {
    const call = await run()
    if (!call) return

    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "repo")
    const input = await source(root, {
      restart_resume_monotonicity: {
        checkpoints: [1, 3, 2],
        monotonic: false,
      },
      strict_reference_gate: {
        violations: 0,
        fail_closed: true,
      },
      assisted_compaction_guardrails: {
        degraded: 0,
        verify_failures: 0,
        fallback_safe: true,
      },
      nightly_soak_pass_rate: 0.997,
      restart_resume_regression: 1,
    })

    const logs: string[] = []
    const result = await call({
      rootDir: root,
      sourcePath: input,
      write: (text) => {
        logs.push(text)
      },
    })

    expect(result.gates.restart_resume_monotonicity.ok).toBe(false)
    expect(result.gates.strict_reference_gate.ok).toBe(true)
    expect(result.gates.assisted_compaction_guardrails.ok).toBe(true)
    expect(result.metrics.restart_resume_regression).toBeGreaterThan(0)
    expect(result.output).toContain("restart_resume_monotonicity")
    expect(result.output).toContain("nightly_run")
    expect(result.output).toContain("artifact_location")
    expect(result.output).toContain("decision_criteria")
    expect(await Bun.file(result.outputPath).exists()).toBe(true)
    expect(logs.length).toBeGreaterThan(0)
  })

  test("gates strict reference check as fail-closed", async () => {
    const call = await run()
    if (!call) return

    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "repo")
    const input = await source(root, {
      restart_resume_monotonicity: {
        checkpoints: [1, 2, 3],
        monotonic: true,
      },
      strict_reference_gate: {
        violations: 2,
        fail_closed: false,
      },
      assisted_compaction_guardrails: {
        degraded: 0,
        verify_failures: 0,
        fallback_safe: true,
      },
      nightly_soak_pass_rate: 0.998,
      restart_resume_regression: 0,
    })

    const result = await call({
      rootDir: root,
      sourcePath: input,
    })

    expect(result.gates.restart_resume_monotonicity.ok).toBe(true)
    expect(result.gates.strict_reference_gate.ok).toBe(false)
    expect(result.gates.assisted_compaction_guardrails.ok).toBe(true)
    expect(result.output).toContain("strict_reference_gate")
    expect(result.exitCode).toBe(1)
  })

  test("gates assisted compaction guardrails", async () => {
    const call = await run()
    if (!call) return

    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "repo")
    const input = await source(root, {
      restart_resume_monotonicity: {
        checkpoints: [1, 2, 3, 4],
        monotonic: true,
      },
      strict_reference_gate: {
        violations: 0,
        fail_closed: true,
      },
      assisted_compaction_guardrails: {
        degraded: 1,
        verify_failures: 1,
        fallback_safe: false,
      },
      nightly_soak_pass_rate: 0.995,
      restart_resume_regression: 0,
    })

    const result = await call({
      rootDir: root,
      sourcePath: input,
    })

    expect(result.gates.restart_resume_monotonicity.ok).toBe(true)
    expect(result.gates.strict_reference_gate.ok).toBe(true)
    expect(result.gates.assisted_compaction_guardrails.ok).toBe(false)
    expect(result.metrics.nightly_soak_pass_rate).toBeGreaterThan(0.99)
    expect(result.output).toContain("assisted_compaction_guardrails")
    expect(result.exitCode).toBe(1)
  })
})
