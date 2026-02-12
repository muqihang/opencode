import fs from "fs/promises"
import path from "path"
import type { Dirent } from "fs"

export type PermissionBaselineRule = {
  path: string
  expected: string
  critical: boolean
}

export type PermissionBaselineStatus = "ok" | "drift" | "missing" | "error"

export type PermissionBaselineRow = {
  path: string
  expected: string
  actual: string | null
  critical: boolean
  status: PermissionBaselineStatus
  note: string
}

export type PermissionBaselineReport = {
  ok: boolean
  rows: PermissionBaselineRow[]
  drift: PermissionBaselineRow[]
  criticalDrift: PermissionBaselineRow[]
}

export type RetentionEntry = {
  path: string
  mtimeMs: number
  size: number
}

export type RetentionCandidate = {
  path: string
  size: number
  ageDays: number
  reason: string
}

export type RetentionDryRunReport = {
  dryRun: true
  ttlDays: number
  cutoffIso: string
  scanned: number
  totalSize: number
  wouldDelete: RetentionCandidate[]
}

export type ExportAuditRecord = {
  action: "export"
  ts: string
  sessionId: string
  actor: string
  owner: string
  outDir: string
  traceId: string
  reason: string
  ticket: string
  responsibility: string
}

const fmt = (mode: number) => (mode & 0o777).toString(8).padStart(3, "0")

export const checkPermissionBaseline = async (input: {
  rules: PermissionBaselineRule[]
}): Promise<PermissionBaselineReport> => {
  const rows = await Promise.all(
    input.rules.map(async (rule) => {
      const stat = await fs.stat(rule.path).catch((error: NodeJS.ErrnoException) => error)

      if (stat instanceof Error) {
        const status: PermissionBaselineStatus = stat.code === "ENOENT" ? "missing" : "error"
        const note = stat.code === "ENOENT" ? "path-not-found" : stat.message
        return {
          path: rule.path,
          expected: rule.expected,
          actual: null,
          critical: rule.critical,
          status,
          note,
        }
      }

      const actual = fmt(stat.mode)
      const status: PermissionBaselineStatus = actual === rule.expected ? "ok" : "drift"
      const note = status === "ok" ? "match" : `expected=${rule.expected},actual=${actual}`

      return {
        path: rule.path,
        expected: rule.expected,
        actual,
        critical: rule.critical,
        status,
        note,
      }
    }),
  )

  const drift = rows.filter((row) => row.status !== "ok")
  const criticalDrift = drift.filter((row) => row.critical)

  return {
    ok: criticalDrift.length === 0,
    rows,
    drift,
    criticalDrift,
  }
}

const dayMs = 24 * 60 * 60 * 1000

export const planRetentionDryRun = (input: {
  ttlDays: number
  now?: Date
  entries: RetentionEntry[]
}): RetentionDryRunReport => {
  const now = input.now ?? new Date()
  const nowMs = now.getTime()
  const cutoffMs = nowMs - input.ttlDays * dayMs

  const wouldDelete = input.entries
    .filter((entry) => entry.mtimeMs < cutoffMs)
    .map((entry) => {
      const ageDays = Math.floor((nowMs - entry.mtimeMs) / dayMs)
      return {
        path: entry.path,
        size: entry.size,
        ageDays,
        reason: `older-than-ttl-${input.ttlDays}d`,
      }
    })

  const totalSize = wouldDelete.reduce((sum, entry) => sum + entry.size, 0)

  return {
    dryRun: true,
    ttlDays: input.ttlDays,
    cutoffIso: new Date(cutoffMs).toISOString(),
    scanned: input.entries.length,
    totalSize,
    wouldDelete,
  }
}

const walk = async (dir: string): Promise<RetentionEntry[]> => {
  const list = await fs.readdir(dir, { withFileTypes: true }).catch(() => [] as Dirent[])
  const nested = await Promise.all(
    list.map(async (entry) => {
      const full = path.join(dir, entry.name)
      if (entry.isSymbolicLink()) return [] as RetentionEntry[]
      if (entry.isDirectory()) return walk(full)
      if (!entry.isFile()) return [] as RetentionEntry[]

      const stat = await fs.stat(full).catch(() => null)
      if (!stat) return [] as RetentionEntry[]
      return [{ path: full, mtimeMs: stat.mtimeMs, size: stat.size }]
    }),
  )

  return nested.flat()
}

export const collectRetentionEntries = async (input: { roots: string[] }): Promise<RetentionEntry[]> => {
  const trees = await Promise.all(
    input.roots.map(async (root) => {
      const stat = await fs.stat(root).catch(() => null)
      if (!stat?.isDirectory()) return [] as RetentionEntry[]
      return walk(root)
    }),
  )

  return trees.flat()
}

export const buildExportAuditRecord = (input: {
  ts?: string
  sessionId: string
  actor: string
  owner: string
  outDir: string
  traceId: string
  reason: string
  ticket: string
}): ExportAuditRecord => {
  const ts = input.ts ?? new Date().toISOString()
  return {
    action: "export",
    ts,
    sessionId: input.sessionId,
    actor: input.actor,
    owner: input.owner,
    outDir: input.outDir,
    traceId: input.traceId,
    reason: input.reason,
    ticket: input.ticket,
    responsibility: `owner=${input.owner};actor=${input.actor};ticket=${input.ticket}`,
  }
}
