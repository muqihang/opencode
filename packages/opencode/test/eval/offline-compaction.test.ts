import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import type { EvidenceChainResult } from "../../src/evidence/chain"
import * as offline from "../../src/eval/offline"

type Verify = (input: { exportDir: string; sessionId: string }) => Promise<EvidenceChainResult>

const sha = "0".repeat(64)

const manifestJson = (input: { sessionId: string; entries: Array<{ path: string; kind: string }> }) => ({
  specVersion: "evidence-manifest/1.0",
  packId: `EP-${input.sessionId}`,
  generatedAtUtc: new Date().toISOString(),
  entries: input.entries.map((entry) => ({ path: entry.path, sha256: sha, kind: entry.kind })),
})

const packJson = (input: { sessionId: string; pointers: Array<string | { kind: string; ref: string }> }) => ({
  specVersion: "evidence-pack/1.0",
  packId: `EP-${input.sessionId}`,
  task: { title: "test", intent: "test", successCriteria: ["ok"] },
  environment: { execution: { kind: "test", id: "EVAL" } },
  claims: [],
  artifacts: [],
  checks: [],
  events: [],
  capsule: { handoff: "EVAL", pointers: input.pointers, openQuestions: [] },
  risks: [],
  rollback: { strategy: "none", steps: [] },
})

describe("eval.offline > export capsule/handoff chain", () => {
  test("fails when manifest references capsule.session.json but export dir missing it", async () => {
    await using tmp = await tmpdir({ git: true })
    const sessionId = "ses"
    const exportDir = path.join(tmp.path, "export")

    await fs.mkdir(exportDir, { recursive: true })
    await Bun.write(
      path.join(exportDir, "manifest.json"),
      JSON.stringify(
        manifestJson({
          sessionId,
          entries: [
            {
              path: `.opencode/artifacts/${sessionId}/compaction/C0/capsule.session.json`,
              kind: "compaction-capsule-session",
            },
          ],
        }),
      ),
    )

    const verify = (offline as unknown as { verifyOfflineExportEvidenceChain?: Verify }).verifyOfflineExportEvidenceChain
    expect(typeof verify).toBe("function")
    if (typeof verify !== "function") return

    const result = await verify({ exportDir, sessionId })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errorZh).toContain("capsule.session.json")
    expect(result.errorZh).toContain("artifacts/compaction/C0/capsule.session.json")
  })

  test("fails when manifest references capsule.assisted.json but export dir missing it", async () => {
    await using tmp = await tmpdir({ git: true })
    const sessionId = "ses"
    const exportDir = path.join(tmp.path, "export")

    await fs.mkdir(exportDir, { recursive: true })
    await Bun.write(
      path.join(exportDir, "manifest.json"),
      JSON.stringify(
        manifestJson({
          sessionId,
          entries: [
            {
              path: `.opencode/artifacts/${sessionId}/compaction/C0/capsule.assisted.json`,
              kind: "compaction-capsule-assisted",
            },
          ],
        }),
      ),
    )

    const verify = (offline as unknown as { verifyOfflineExportEvidenceChain?: Verify }).verifyOfflineExportEvidenceChain
    expect(typeof verify).toBe("function")
    if (typeof verify !== "function") return

    const result = await verify({ exportDir, sessionId })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errorZh).toContain("capsule.assisted.json")
    expect(result.errorZh).toContain("artifacts/compaction/C0/capsule.assisted.json")
  })

  test("fails when pack capsule pointers reference capsule.handoff.json but export dir missing it", async () => {
    await using tmp = await tmpdir({ git: true })
    const sessionId = "ses"
    const exportDir = path.join(tmp.path, "export")

    await fs.mkdir(exportDir, { recursive: true })
    await Bun.write(path.join(exportDir, "manifest.json"), JSON.stringify(manifestJson({ sessionId, entries: [] })))
    await Bun.write(
      path.join(exportDir, "pack.json"),
      JSON.stringify(
        packJson({
          sessionId,
          pointers: [{ kind: "capsule-handoff", ref: "handoff/child/capsule.handoff.json" }],
        }),
      ),
    )

    const verify = (offline as unknown as { verifyOfflineExportEvidenceChain?: Verify }).verifyOfflineExportEvidenceChain
    expect(typeof verify).toBe("function")
    if (typeof verify !== "function") return

    const result = await verify({ exportDir, sessionId })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errorZh).toContain("capsule.handoff.json")
    expect(result.errorZh).toContain("artifacts/handoff/child/capsule.handoff.json")
  })

  test("fails when pack capsule pointers reference capsule.assisted.md but export dir missing it", async () => {
    await using tmp = await tmpdir({ git: true })
    const sessionId = "ses"
    const exportDir = path.join(tmp.path, "export")

    await fs.mkdir(exportDir, { recursive: true })
    await Bun.write(path.join(exportDir, "manifest.json"), JSON.stringify(manifestJson({ sessionId, entries: [] })))
    await Bun.write(
      path.join(exportDir, "pack.json"),
      JSON.stringify(
        packJson({
          sessionId,
          pointers: [{ kind: "capsule-assisted-view", ref: "compaction/C0/capsule.assisted.md" }],
        }),
      ),
    )

    const verify = (offline as unknown as { verifyOfflineExportEvidenceChain?: Verify }).verifyOfflineExportEvidenceChain
    expect(typeof verify).toBe("function")
    if (typeof verify !== "function") return

    const result = await verify({ exportDir, sessionId })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errorZh).toContain("capsule.assisted.md")
    expect(result.errorZh).toContain("artifacts/compaction/C0/capsule.assisted.md")
  })
})
