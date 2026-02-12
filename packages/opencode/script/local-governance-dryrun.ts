#!/usr/bin/env bun

import fs from "fs/promises"
import path from "path"
import {
  buildExportAuditRecord,
  checkPermissionBaseline,
  collectRetentionEntries,
  planRetentionDryRun,
  type ExportAuditRecord,
  type PermissionBaselineReport,
  type RetentionDryRunReport,
} from "../src/governance/local"

export type LocalGovernanceDryRunResult = {
  rootDir: string
  dryRun: true
  permission: PermissionBaselineReport
  retention: RetentionDryRunReport
  audit: ExportAuditRecord
  outputPath: string
  outputPaths: {
    permission: string
    retention: string
    audit: string
  }
  markdown: string
  exitCode: number
}

type RunInput = {
  rootDir?: string
  now?: Date
  write?: (text: string) => void
}

const rel = (rootDir: string, value: string) => path.relative(rootDir, value).replace(/\\/g, "/")

const render = (result: LocalGovernanceDryRunResult) => {
  const lines = [
    "# Local Safety & Retention Dry-Run Report",
    "",
    `- generatedAt: ${result.audit.ts}`,
    `- rootDir: ${result.rootDir}`,
    "- mode: dry-run only",
    "- deletion: not executed",
    "",
    "## Permission Baseline",
    `- criticalOk: ${result.permission.ok}`,
    `- totalRules: ${result.permission.rows.length}`,
    `- driftCount: ${result.permission.drift.length}`,
    "",
    "| path | expected | actual | critical | status | note |",
    "| --- | --- | --- | --- | --- | --- |",
    ...result.permission.rows.map((row) => {
      const p = rel(result.rootDir, row.path)
      const a = row.actual ?? "N/A"
      return `| ${p} | ${row.expected} | ${a} | ${row.critical} | ${row.status} | ${row.note} |`
    }),
    "",
    "## Retention Dry-Run",
    `- ttlDays: ${result.retention.ttlDays}`,
    `- scanned: ${result.retention.scanned}`,
    `- wouldDelete: ${result.retention.wouldDelete.length}`,
    `- totalSize: ${result.retention.totalSize}`,
    `- cutoffIso: ${result.retention.cutoffIso}`,
    "- action: dry-run only，未执行真实删除",
    "",
    "| path | ageDays | size | reason |",
    "| --- | --- | --- | --- |",
    ...result.retention.wouldDelete.map((row) => {
      const p = rel(result.rootDir, row.path)
      return `| ${p} | ${row.ageDays} | ${row.size} | ${row.reason} |`
    }),
    "",
    "## Export Audit",
    `- action: ${result.audit.action}`,
    `- sessionId: ${result.audit.sessionId}`,
    `- traceId: ${result.audit.traceId}`,
    `- owner: ${result.audit.owner}`,
    `- actor: ${result.audit.actor}`,
    `- reason: ${result.audit.reason}`,
    `- ticket: ${result.audit.ticket}`,
    `- responsibility: ${result.audit.responsibility}`,
    "",
    "## Safety Note",
    "- 本报告为 dry-run only；未执行真实删除动作。",
  ]

  return lines.join("\n")
}

const renderPermissionMatrix = (result: LocalGovernanceDryRunResult) => {
  const lines = [
    "# Permission Baseline Matrix（MVP）",
    "",
    `- generatedAt: ${result.audit.ts}`,
    "- scope: local critical directories",
    "- mode: dry-run only",
    "- deletion: not executed",
    "",
    `- criticalOk: ${result.permission.ok}`,
    `- driftCount: ${result.permission.drift.length}`,
    "",
    "| path | expected | actual | critical | status | note |",
    "| --- | --- | --- | --- | --- | --- |",
    ...result.permission.rows.map((row) => {
      const p = rel(result.rootDir, row.path)
      const a = row.actual ?? "N/A"
      return `| ${p} | ${row.expected} | ${a} | ${row.critical} | ${row.status} | ${row.note} |`
    }),
    "",
    "## Statement",
    "- 本矩阵用于权限偏差判定；dry-run only，未执行真实删除。",
  ]

  return lines.join("\n")
}

const renderExportAuditPolicy = (result: LocalGovernanceDryRunResult) => {
  const lines = [
    "# Export Audit Policy（MVP）",
    "",
    `- generatedAt: ${result.audit.ts}`,
    "- mode: dry-run only",
    "- deletion: not executed",
    "",
    "## Required Fields",
    "| field | value |",
    "| --- | --- |",
    `| action | ${result.audit.action} |`,
    `| ts | ${result.audit.ts} |`,
    `| sessionId | ${result.audit.sessionId} |`,
    `| traceId | ${result.audit.traceId} |`,
    `| actor | ${result.audit.actor} |`,
    `| owner | ${result.audit.owner} |`,
    `| outDir | ${result.audit.outDir} |`,
    `| reason | ${result.audit.reason} |`,
    `| ticket | ${result.audit.ticket} |`,
    `| responsibility | ${result.audit.responsibility} |`,
    "",
    "## Retention & Accountability",
    "- 审计记录至少保留 180 天。",
    "- owner 对导出动作负责；actor 对执行行为负责。",
    "- traceId + ticket 用于追踪与问责链路。",
    "",
    "## Statement",
    "- 本策略文档为导出审计最小治理约束；dry-run only，未执行真实删除。",
  ]

  return lines.join("\n")
}

export const runLocalGovernanceDryRun = async (input: RunInput = {}): Promise<LocalGovernanceDryRunResult> => {
  const rootDir = input.rootDir ?? path.resolve(import.meta.dir, "..", "..", "..")
  const now = input.now ?? new Date()

  const permission = await checkPermissionBaseline({
    rules: [
      { path: rootDir, expected: "755", critical: true },
      { path: path.join(rootDir, "docs"), expected: "755", critical: true },
      { path: path.join(rootDir, "docs", "plans", "evidence"), expected: "755", critical: true },
      { path: path.join(rootDir, "packages"), expected: "755", critical: false },
      { path: path.join(rootDir, "packages", "opencode"), expected: "755", critical: false },
    ],
  })

  const retentionRoots = [
    path.join(rootDir, "docs", "plans", "evidence"),
    path.join(rootDir, ".opencode", "artifact"),
  ]
  const entries = await collectRetentionEntries({ roots: retentionRoots })
  const retention = planRetentionDryRun({
    ttlDays: 30,
    now,
    entries,
  })

  const audit = buildExportAuditRecord({
    ts: now.toISOString(),
    sessionId: "card-blk-06-p2-5-local-gov",
    actor: "local-governance-dryrun",
    owner: "P2-5-LOCAL-GOV-01",
    outDir: "docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p2-5",
    traceId: "trace-card-blk-06-p2-5-local-gov",
    reason: "local safety retention governance evidence",
    ticket: "card-blk-06/p2-5",
  })

  const outputDir = path.join(
    rootDir,
    "docs",
    "plans",
    "evidence",
    "2026-02-10-v1_6-blocking",
    "card-blk-06",
    "p2-5",
  )
  const outputPath = path.join(outputDir, "retention-dryrun-report.md")
  const outputPaths = {
    permission: path.join(outputDir, "permission-baseline-matrix.md"),
    retention: outputPath,
    audit: path.join(outputDir, "export-audit-policy.md"),
  }
  const result = {
    rootDir,
    dryRun: true as const,
    permission,
    retention,
    audit,
    outputPath,
    outputPaths,
    markdown: "",
    exitCode: permission.ok ? 0 : 1,
  }
  const markdown = render({ ...result, markdown: "" })
  const permissionMarkdown = renderPermissionMatrix({ ...result, markdown })
  const auditMarkdown = renderExportAuditPolicy({ ...result, markdown })
  const finalResult = {
    ...result,
    markdown,
  }

  await fs.mkdir(outputDir, { recursive: true })
  await fs.writeFile(outputPath, markdown + "\n", "utf8")
  await fs.writeFile(outputPaths.permission, permissionMarkdown + "\n", "utf8")
  await fs.writeFile(outputPaths.audit, auditMarkdown + "\n", "utf8")

  const write = input.write ?? ((text: string) => console.log(text))
  write(markdown)
  write(`outputPath=${outputPath}`)
  write(`permissionPath=${outputPaths.permission}`)
  write(`auditPath=${outputPaths.audit}`)
  write(`exitCode=${finalResult.exitCode}`)
  return finalResult
}

if (import.meta.main) {
  const result = await runLocalGovernanceDryRun()
  process.exit(result.exitCode)
}
