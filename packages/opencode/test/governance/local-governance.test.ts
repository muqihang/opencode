import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { buildExportAuditRecord, checkPermissionBaseline, planRetentionDryRun } from "../../src/governance/local"

describe("local governance core", () => {
  test("detects permission baseline drift on critical directories", async () => {
    await using tmp = await tmpdir()
    const secure = path.join(tmp.path, "secure")
    const relaxed = path.join(tmp.path, "relaxed")
    const missing = path.join(tmp.path, "missing")

    await fs.mkdir(secure, { recursive: true })
    await fs.mkdir(relaxed, { recursive: true })
    await fs.chmod(secure, 0o700)
    await fs.chmod(relaxed, 0o755)

    const report = await checkPermissionBaseline({
      rules: [
        { path: secure, expected: "700", critical: true },
        { path: relaxed, expected: "700", critical: true },
        { path: missing, expected: "700", critical: false },
      ],
    })

    const secureRow = report.rows.find((row) => row.path === secure)
    const relaxedRow = report.rows.find((row) => row.path === relaxed)
    const missingRow = report.rows.find((row) => row.path === missing)

    expect(secureRow?.status).toBe("ok")
    expect(relaxedRow?.status).toBe("drift")
    expect(missingRow?.status).toBe("missing")
    expect(report.ok).toBe(false)
    expect(report.drift.length).toBe(2)
  })

  test("builds retention dry-run plan without deletion side effects", () => {
    const now = new Date("2026-02-12T00:00:00.000Z")
    const old = now.getTime() - 90 * 24 * 60 * 60 * 1000
    const recent = now.getTime() - 5 * 24 * 60 * 60 * 1000

    const report = planRetentionDryRun({
      ttlDays: 30,
      now,
      entries: [
        { path: "docs/plans/evidence/old.log", mtimeMs: old, size: 100 },
        { path: "docs/plans/evidence/new.log", mtimeMs: recent, size: 40 },
      ],
    })

    expect(report.dryRun).toBe(true)
    expect(report.scanned).toBe(2)
    expect(report.wouldDelete.length).toBe(1)
    expect(report.wouldDelete[0]?.path).toBe("docs/plans/evidence/old.log")
    expect(report.wouldDelete[0]?.reason).toContain("ttl")
    expect(report.totalSize).toBe(100)
  })

  test("builds export audit record with accountability fields", () => {
    const record = buildExportAuditRecord({
      sessionId: "sess_001",
      actor: "opencode export",
      owner: "P2-5-LOCAL-GOV-01",
      outDir: "docs/plans/evidence",
      traceId: "trace_001",
      reason: "evidence export",
      ticket: "card-blk-06/p2-5",
      ts: "2026-02-12T00:00:00.000Z",
    })

    expect(record.action).toBe("export")
    expect(record.sessionId).toBe("sess_001")
    expect(record.owner).toBe("P2-5-LOCAL-GOV-01")
    expect(record.traceId).toBe("trace_001")
    expect(record.ticket).toBe("card-blk-06/p2-5")
    expect(record.responsibility).toContain("owner")
  })
})
