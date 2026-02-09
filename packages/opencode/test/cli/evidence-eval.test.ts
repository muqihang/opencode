import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { EvidenceEvalCommand } from "../../src/cli/cmd/evidence"

const OFFLINE_GATE_FLAG = "OPENCODE_EXPERIMENTAL_OFFLINE_EVAL_GATES"

const withOfflineGate = async (value: string | undefined, fn: () => Promise<void>) => {
  const prev = process.env[OFFLINE_GATE_FLAG]
  if (value === undefined) {
    delete process.env[OFFLINE_GATE_FLAG]
  }
  if (value !== undefined) {
    process.env[OFFLINE_GATE_FLAG] = value
  }
  return Promise.resolve(fn()).finally(() => {
    if (prev === undefined) {
      delete process.env[OFFLINE_GATE_FLAG]
      return
    }
    process.env[OFFLINE_GATE_FLAG] = prev
  })
}

describe("cli evidence eval", () => {
  test("writes offline eval report and summary using shared runner", async () => {
    await using tmp = await tmpdir({ git: true })
    const report = path.join(tmp.path, "offline-eval-report.json")
    const summary = path.join(tmp.path, "offline-eval-summary.md")

    await EvidenceEvalCommand.handler({
      report,
      summary,
    } as never)

    const reportJson = (await Bun.file(report).json()) as {
      specVersion: string
      gate: { passed: boolean }
      suites: { id: string }[]
    }
    expect(reportJson.specVersion).toBe("offline-eval/1.0")
    expect(reportJson.suites.length).toBeGreaterThan(0)
    expect(reportJson.gate.passed).toBe(true)

    const summaryText = await Bun.file(summary).text()
    expect(summaryText).toContain("offline-eval/1.0")
    expect(summaryText).toContain("unsupportedClaimRate")
  })

  test("fails the command when gate does not pass", async () => {
    await withOfflineGate(undefined, async () => {
      await using tmp = await tmpdir({ git: true })
      const suiteDir = path.join(tmp.path, "suites")
      const report = path.join(tmp.path, "offline-eval-report.json")
      const summary = path.join(tmp.path, "offline-eval-summary.md")

      await fs.mkdir(suiteDir, { recursive: true })
      await Bun.write(
        path.join(suiteDir, "failing.json"),
        JSON.stringify({
          specVersion: "offline-eval/1.0",
          id: "failing_suite",
          baselineTaskCompletion: 0.9,
          totals: {
            claims: 100,
            unsupportedClaims: 20,
            unknownPredictions: 20,
            correctUnknownPredictions: 10,
            citationChecks: 100,
            validCitations: 70,
            tasks: 20,
            completedTasks: 10,
            keyClaims: 40,
            keyClaimsWithEvidence: 10,
            cacheRequests: 20,
            cacheHits: 2,
          },
        }),
      )

      await expect(
        EvidenceEvalCommand.handler({
          suiteDir,
          report,
          summary,
        } as never),
      ).rejects.toThrow("offline eval gate failed")

      const reportJson = (await Bun.file(report).json()) as { gate: { passed: boolean } }
      expect(reportJson.gate.passed).toBe(false)
    })
  })

  test("downgrades gate failure to non-blocking when switch is off", async () => {
    await withOfflineGate("false", async () => {
      await using tmp = await tmpdir({ git: true })
      const suiteDir = path.join(tmp.path, "suites")
      const report = path.join(tmp.path, "offline-eval-report.json")
      const summary = path.join(tmp.path, "offline-eval-summary.md")

      await fs.mkdir(suiteDir, { recursive: true })
      await Bun.write(
        path.join(suiteDir, "failing.json"),
        JSON.stringify({
          specVersion: "offline-eval/1.0",
          id: "failing_suite",
          baselineTaskCompletion: 0.9,
          totals: {
            claims: 100,
            unsupportedClaims: 20,
            unknownPredictions: 20,
            correctUnknownPredictions: 10,
            citationChecks: 100,
            validCitations: 70,
            tasks: 20,
            completedTasks: 10,
            keyClaims: 40,
            keyClaimsWithEvidence: 10,
            cacheRequests: 20,
            cacheHits: 2,
          },
        }),
      )

      await expect(
        EvidenceEvalCommand.handler({
          suiteDir,
          report,
          summary,
        } as never),
      ).resolves.toBeUndefined()

      const reportJson = (await Bun.file(report).json()) as { gate: { passed: boolean } }
      expect(reportJson.gate.passed).toBe(false)
    })
  })
})
