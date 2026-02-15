import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../fixture/fixture"

type GoInput = {
  p0: {
    reference_gate_green: boolean
    replay_trace_green: boolean
  }
  p1: {
    claims_grounding_green: boolean
    compaction_quality_green: boolean
  }
  p2: {
    contradiction_rate_green: boolean
    anchor_consistency_score_green: boolean
  }
  nightly: {
    nightly_soak_pass_rate: number
    restart_resume_regression: number
  }
  replay_traces: string[]
  mandatory_gates: {
    strict_reference_gate: boolean
    long_session_restart_soak: boolean
    assisted_compaction_guardrails: boolean
  }
  external: {
    checklist_mapped: boolean
  }
}

type GoResult = {
  outputPaths: {
    markdown: string
    json: string
  }
  markdown: string
  pack: {
    consolidated: boolean
    mandatory_metrics_all_green: boolean
  }
  exitCode: number
}

const source = async (root: string, input: GoInput) => {
  const dir = path.join(root, "docs", "plans", "evidence", "2026-02-10-v1_6-blocking", "card-blk-06", "f4-hq")
  const file = path.join(dir, "go-pack-input.json")
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(file, JSON.stringify(input, null, 2), "utf8")
  return file
}

const run = async () => {
  const mod = await import("../../script/f4-hq/go-pack").catch(() => null)
  expect(mod).not.toBeNull()
  if (!mod) return null
  return mod.runF4HqGoPack as (input: {
    rootDir: string
    sourcePath: string
    write?: (text: string) => void
  }) => Promise<GoResult>
}

describe("f4 hq unified go pack", () => {
  test("writes consolidated markdown and json artifacts", async () => {
    const call = await run()
    if (!call) return

    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "repo")
    const input = await source(root, {
      p0: {
        reference_gate_green: true,
        replay_trace_green: true,
      },
      p1: {
        claims_grounding_green: true,
        compaction_quality_green: true,
      },
      p2: {
        contradiction_rate_green: true,
        anchor_consistency_score_green: true,
      },
      nightly: {
        nightly_soak_pass_rate: 0.997,
        restart_resume_regression: 0,
      },
      replay_traces: [
        "docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/f4-hq/p2-compaction-quality-soak-replay-report.md",
      ],
      mandatory_gates: {
        strict_reference_gate: true,
        long_session_restart_soak: true,
        assisted_compaction_guardrails: true,
      },
      external: {
        checklist_mapped: true,
      },
    })

    const logs: string[] = []
    const result = await call({
      rootDir: root,
      sourcePath: input,
      write: (text) => {
        logs.push(text)
      },
    })

    expect(result.pack.consolidated).toBe(true)
    expect(result.outputPaths.markdown).toBe(
      path.join(root, "docs", "plans", "evidence", "2026-02-10-v1_6-blocking", "card-blk-06", "f4-hq", "go-pack", "f4-hq-go-pack-latest.md"),
    )
    expect(result.outputPaths.json).toBe(
      path.join(root, "docs", "plans", "evidence", "2026-02-10-v1_6-blocking", "card-blk-06", "f4-hq", "go-pack", "f4-hq-go-pack-latest.json"),
    )
    expect(await Bun.file(result.outputPaths.markdown).exists()).toBe(true)
    expect(await Bun.file(result.outputPaths.json).exists()).toBe(true)
    expect(result.markdown).toContain("## P2")
    expect(result.markdown).toContain("## Replay Traces")
    expect(result.markdown).toContain("## Mandatory Gates")
    expect(logs.length).toBeGreaterThan(0)
  })

  test("emits mandatory_metrics_all_green in consolidated json", async () => {
    const call = await run()
    if (!call) return

    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "repo")
    const input = await source(root, {
      p0: {
        reference_gate_green: true,
        replay_trace_green: true,
      },
      p1: {
        claims_grounding_green: true,
        compaction_quality_green: false,
      },
      p2: {
        contradiction_rate_green: true,
        anchor_consistency_score_green: false,
      },
      nightly: {
        nightly_soak_pass_rate: 0.992,
        restart_resume_regression: 0,
      },
      replay_traces: [
        "docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/f4-hq/p2-compaction-quality-soak-replay-report.md",
      ],
      mandatory_gates: {
        strict_reference_gate: true,
        long_session_restart_soak: true,
        assisted_compaction_guardrails: false,
      },
      external: {
        checklist_mapped: true,
      },
    })

    const result = await call({
      rootDir: root,
      sourcePath: input,
    })

    const text = await fs.readFile(result.outputPaths.json, "utf8")
    const pack = JSON.parse(text) as Record<string, unknown>
    expect("mandatory_metrics_all_green" in pack).toBe(true)
    expect(typeof pack.mandatory_metrics_all_green).toBe("boolean")
    expect(result.pack.mandatory_metrics_all_green).toBe(false)
    expect(result.markdown).toContain("mandatory_metrics_all_green")
    expect(result.exitCode).toBe(1)
  })
})
