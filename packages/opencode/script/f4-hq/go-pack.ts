#!/usr/bin/env bun

import fs from "fs/promises"
import path from "path"

type GoInput = {
  p0: {
    reference_gate_green: boolean
    replay_trace_green: boolean
  }
  p1: {
    claims_grounding_green: boolean
    compaction_quality_green: boolean
  }
  p2?: {
    contradiction_rate_green: boolean
    anchor_consistency_score_green: boolean
  }
  nightly: {
    nightly_soak_pass_rate: number
    restart_resume_regression: number
  }
  replay_traces?: string[]
  mandatory_gates?: {
    strict_reference_gate: boolean
    long_session_restart_soak: boolean
    assisted_compaction_guardrails: boolean
  }
  external: {
    checklist_mapped: boolean
  }
}

export type F4HqGoPackResult = {
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

export const runF4HqGoPack = async (input: RunInput = {}): Promise<F4HqGoPackResult> => {
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
      "go-pack-input.json",
    )
  const text = await fs.readFile(sourcePath, "utf8")
  const data = JSON.parse(text) as GoInput
  const p2 = data.p2 ?? {
    contradiction_rate_green: false,
    anchor_consistency_score_green: false,
  }
  const replayTraces = Array.isArray(data.replay_traces)
    ? data.replay_traces.map((item) => String(item).trim()).filter((item) => item.length > 0)
    : []
  const gates = data.mandatory_gates ?? {
    strict_reference_gate: data.p0.reference_gate_green,
    long_session_restart_soak: data.nightly.restart_resume_regression === 0,
    assisted_compaction_guardrails: data.p1.compaction_quality_green,
  }

  const mandatory =
    data.p0.reference_gate_green &&
    data.p0.replay_trace_green &&
    data.p1.claims_grounding_green &&
    data.p1.compaction_quality_green &&
    p2.contradiction_rate_green &&
    p2.anchor_consistency_score_green &&
    data.nightly.nightly_soak_pass_rate >= 0.995 &&
    data.nightly.restart_resume_regression === 0 &&
    replayTraces.length > 0 &&
    gates.strict_reference_gate &&
    gates.long_session_restart_soak &&
    gates.assisted_compaction_guardrails &&
    data.external.checklist_mapped

  const outputPaths = {
    markdown: path.join(
      rootDir,
      "docs",
      "plans",
      "evidence",
      "2026-02-10-v1_6-blocking",
      "card-blk-06",
      "f4-hq",
      "go-pack",
      "f4-hq-go-pack-latest.md",
    ),
    json: path.join(
      rootDir,
      "docs",
      "plans",
      "evidence",
      "2026-02-10-v1_6-blocking",
      "card-blk-06",
      "f4-hq",
      "go-pack",
      "f4-hq-go-pack-latest.json",
    ),
  }

  const pack = {
    consolidated: true,
    mandatory_metrics_all_green: mandatory,
    source_path: path.relative(rootDir, sourcePath),
    generated_at: new Date().toISOString(),
    checks: {
      p0: data.p0,
      p1: data.p1,
      p2,
      nightly: data.nightly,
      replay_traces: replayTraces,
      mandatory_gates: gates,
      external: data.external,
    },
  }

  const markdown = [
    "# F4 HQ GO Pack (Consolidated)",
    "",
    "## Pack",
    `- consolidated: ${pack.consolidated}`,
    `- mandatory_metrics_all_green: ${pack.mandatory_metrics_all_green}`,
    `- generated_at: ${pack.generated_at}`,
    `- source_path: ${pack.source_path}`,
    "",
    "## P0",
    `- reference_gate_green: ${data.p0.reference_gate_green}`,
    `- replay_trace_green: ${data.p0.replay_trace_green}`,
    "",
    "## P1",
    `- claims_grounding_green: ${data.p1.claims_grounding_green}`,
    `- compaction_quality_green: ${data.p1.compaction_quality_green}`,
    "",
    "## P2",
    `- contradiction_rate_green: ${p2.contradiction_rate_green}`,
    `- anchor_consistency_score_green: ${p2.anchor_consistency_score_green}`,
    "",
    "## Nightly",
    `- nightly_soak_pass_rate: ${data.nightly.nightly_soak_pass_rate}`,
    `- restart_resume_regression: ${data.nightly.restart_resume_regression}`,
    "",
    "## Replay Traces",
    ...replayTraces.map((item) => `- ${item}`),
    ...(replayTraces.length === 0 ? ["- (none)"] : []),
    "",
    "## Mandatory Gates",
    `- strict_reference_gate: ${gates.strict_reference_gate}`,
    `- long_session_restart_soak: ${gates.long_session_restart_soak}`,
    `- assisted_compaction_guardrails: ${gates.assisted_compaction_guardrails}`,
    "",
    "## External",
    `- checklist_mapped: ${data.external.checklist_mapped}`,
  ].join("\n")

  await fs.mkdir(path.dirname(outputPaths.markdown), { recursive: true })
  await fs.writeFile(outputPaths.markdown, markdown + "\n", "utf8")
  await fs.writeFile(outputPaths.json, JSON.stringify(pack, null, 2) + "\n", "utf8")

  const exitCode = pack.mandatory_metrics_all_green ? 0 : 1
  const write = input.write ?? ((text: string) => console.log(text))
  write(markdown)
  write(`markdownPath=${outputPaths.markdown}`)
  write(`jsonPath=${outputPaths.json}`)
  write(`exitCode=${exitCode}`)

  return {
    outputPaths,
    markdown,
    pack,
    exitCode,
  }
}

if (import.meta.main) {
  const rootDir = parseArg("--root")
  const sourcePath = parseArg("--source")
  const result = await runF4HqGoPack({
    rootDir,
    sourcePath,
  })
  process.exit(result.exitCode)
}
