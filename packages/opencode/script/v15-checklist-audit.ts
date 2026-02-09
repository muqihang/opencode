#!/usr/bin/env bun

import path from "path"
import {
  auditV15CoreInvariants,
  type InvariantAuditReport,
} from "../src/session/orchestrator/invariants"

export type V15ChecklistAuditResult = {
  audit: InvariantAuditReport
  output: string
  exitCode: number
}

type RunInput = {
  rootDir?: string
  write?: (text: string) => void
  collect?: (input: { rootDir: string }) => Promise<InvariantAuditReport>
}

type Milestone = {
  id: string
  title: string
  checks: InvariantAuditReport["results"][number]["id"][]
}

const MILESTONES: Milestone[] = [
  {
    id: "M1",
    title: "可观测稳定化",
    checks: ["I13"],
  },
  {
    id: "M2",
    title: "双规划器 LLM 化",
    checks: ["I1", "I2", "I3", "I4", "I5", "I6"],
  },
  {
    id: "M3",
    title: "评分触发器",
    checks: ["I7", "I8"],
  },
  {
    id: "M4",
    title: "DeepSeek 能力放大",
    checks: ["I12"],
  },
  {
    id: "M5",
    title: "默认开启与灰度收口",
    checks: ["I9", "I10", "I11", "I14"],
  },
]

const lineFor = (row: InvariantAuditReport["results"][number]) => {
  const evidence = row.evidencePaths.length > 0 ? row.evidencePaths.join("; ") : "无"
  return `- ${row.id}: ${row.status} | ${row.title} | 证据路径: ${evidence}`
}

const milestoneLine = (input: {
  row: Map<InvariantAuditReport["results"][number]["id"], InvariantAuditReport["results"][number]>
  milestone: Milestone
}) => {
  const missing = input.milestone.checks.filter((id) => input.row.get(id)?.status !== "已满足")
  const status = missing.length === 0 ? "已满足" : "未满足"
  const missingText = missing.length > 0 ? missing.join("; ") : "无"
  const evidence = [...new Set(input.milestone.checks.flatMap((id) => input.row.get(id)?.evidencePaths ?? []))].toSorted()
  const evidenceText = evidence.length > 0 ? evidence.join("; ") : "无"

  return `- ${input.milestone.id} ${input.milestone.title}: ${status} | 未满足项: ${missingText} | 证据路径: ${evidenceText}`
}

const missingLine = (report: InvariantAuditReport) => {
  const missing = report.results.filter((item) => item.status === "未满足")
  if (missing.length === 0) return "无"
  return missing.map((item) => `${item.id} ${item.title}`).join("; ")
}

const evidenceIndex = (report: InvariantAuditReport) => {
  const evidence = [...new Set(report.results.flatMap((item) => item.evidencePaths))].toSorted()
  if (evidence.length === 0) return ["- 无"]
  return evidence.map((item) => `- ${item}`)
}

const render = (report: InvariantAuditReport) => {
  const row = new Map(report.results.map((item) => [item.id, item]))
  const lines = [
    "# V1.6 收口审计结果",
    `统计: 总计 ${report.summary.total}，已满足 ${report.summary.satisfied}，未满足 ${report.summary.unsatisfied}`,
    "",
    "## 里程碑状态",
    ...MILESTONES.map((item) => milestoneLine({ row, milestone: item })),
    "",
    "## 清单状态",
    ...report.results.map((item) => lineFor(item)),
    "",
    "## 未满足项",
    missingLine(report),
    "",
    "## 证据路径索引",
    ...evidenceIndex(report),
  ]

  return lines.join("\n")
}

export const runV15ChecklistAudit = async (input: RunInput = {}): Promise<V15ChecklistAuditResult> => {
  const rootDir = input.rootDir ?? path.resolve(import.meta.dir, "..")
  const collect = input.collect ?? auditV15CoreInvariants
  const audit = await collect({ rootDir })
  const output = render(audit)
  const write = input.write ?? ((text: string) => console.log(text))
  write(output)

  const exitCode = audit.summary.unsatisfied > 0 ? 1 : 0
  return {
    audit,
    output,
    exitCode,
  }
}

if (import.meta.main) {
  const result = await runV15ChecklistAudit()
  process.exit(result.exitCode)
}
