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

const lineFor = (input: { report: InvariantAuditReport; id: string }) => {
  const row = input.report.results.find((item) => item.id === input.id)
  if (!row) return `- ${input.id}: 未满足 | 证据路径: 无`

  const evidence = row.evidencePaths.length > 0 ? row.evidencePaths.join("; ") : "无"
  return `- ${row.id}: ${row.status} | ${row.title} | 证据路径: ${evidence}`
}

const missingLine = (report: InvariantAuditReport) => {
  const missing = report.results.filter((item) => item.status === "未满足")
  if (missing.length === 0) return "无"
  return missing.map((item) => `${item.id} ${item.title}`).join("; ")
}

const render = (report: InvariantAuditReport) => {
  const lines = [
    "# V1.5 收口审计结果",
    `统计: 总计 ${report.summary.total}，已满足 ${report.summary.satisfied}，未满足 ${report.summary.unsatisfied}`,
    "",
    "## 清单状态",
    ...report.results.map((row) => lineFor({ report, id: row.id })),
    "",
    "## 未满足项",
    missingLine(report),
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
