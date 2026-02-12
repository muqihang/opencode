import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { runLocalGovernanceDryRun } from "../../script/local-governance-dryrun"

describe("local governance dry-run script", () => {
  test("returns non-zero when baseline drifts and keeps dry-run behavior", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "repo")
    const art = path.join(root, ".opencode", "artifact")
    const ev = path.join(root, "docs", "plans", "evidence")

    await fs.mkdir(art, { recursive: true })
    await fs.mkdir(ev, { recursive: true })
    await fs.chmod(art, 0o755)
    await fs.chmod(ev, 0o700)

    const old = path.join(ev, "old.log")
    await fs.writeFile(old, "old")
    const oldTime = new Date("2025-10-01T00:00:00.000Z")
    await fs.utimes(old, oldTime, oldTime)

    const logs: string[] = []
    const result = await runLocalGovernanceDryRun({
      rootDir: root,
      now: new Date("2026-02-12T00:00:00.000Z"),
      write: (text) => {
        logs.push(text)
      },
    })

    expect(result.exitCode).toBe(1)
    expect(result.retention.dryRun).toBe(true)
    expect(result.retention.wouldDelete.length).toBeGreaterThan(0)
    expect(result.permission.ok).toBe(false)
    expect(logs.join("\n")).toContain("dry-run only")

    const permissionDoc = await fs.readFile(result.outputPaths.permission, "utf8")
    const retentionDoc = await fs.readFile(result.outputPaths.retention, "utf8")
    const auditDoc = await fs.readFile(result.outputPaths.audit, "utf8")

    expect(permissionDoc).toContain("dry-run only")
    expect(retentionDoc).toContain("未执行真实删除")
    expect(auditDoc).toContain("responsibility")

    const stillThere = await fs.stat(old)
    expect(stillThere.isFile()).toBe(true)
  })
})
