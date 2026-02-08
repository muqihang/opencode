import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { runOfflineGateEval } from "../../src/eval/offline"

const writeSuites = async (dir: string, suites: unknown[]) => {
  const root = path.join(dir, "eval", "suites")
  await fs.mkdir(root, { recursive: true })
  await Promise.all(
    suites.map((suite, i) => Bun.write(path.join(root, `suite_${i}.json`), `${JSON.stringify(suite, null, 2)}\n`)),
  )
  return root
}

describe("eval.offline", () => {
  test("writes claim/citation/cache dimensions to report and keeps eval artifacts", async () => {
    await using tmp = await tmpdir()
    const suiteDir = await writeSuites(tmp.path, [
      {
        specVersion: "offline-eval/1.0",
        id: "legal_facts_v1",
        baselineTaskCompletion: 0.9,
        totals: {
          claims: 100,
          unsupportedClaims: 4,
          unknownPredictions: 40,
          correctUnknownPredictions: 36,
          citationChecks: 80,
          validCitations: 77,
          keyClaims: 30,
          keyClaimsWithEvidence: 30,
          cacheRequests: 50,
          cacheHits: 40,
          tasks: 60,
          completedTasks: 54,
        },
      },
      {
        specVersion: "offline-eval/1.0",
        id: "sales_reasoning_v1",
        baselineTaskCompletion: 0.88,
        totals: {
          claims: 50,
          unsupportedClaims: 2,
          unknownPredictions: 20,
          correctUnknownPredictions: 17,
          citationChecks: 40,
          validCitations: 38,
          keyClaims: 10,
          keyClaimsWithEvidence: 10,
          cacheRequests: 20,
          cacheHits: 15,
          tasks: 40,
          completedTasks: 35,
        },
      },
    ])
    const reportPath = path.join(tmp.path, "offline-eval-report.json")
    const summaryPath = path.join(tmp.path, "offline-eval-summary.md")

    const report = await runOfflineGateEval({
      suiteDir,
      reportPath,
      summaryPath,
    })

    expect(report.passed).toBe(true)
    expect(report.aggregate.dimensions.claim.unsupportedClaimRate).toBeCloseTo(0.04)
    expect(report.aggregate.dimensions.claim.keyClaimEvidenceIntegrity).toBe(1)
    expect(report.aggregate.dimensions.citation.unknownPrecision).toBeCloseTo(0.883333)
    expect(report.aggregate.dimensions.citation.citationIntegrity).toBeCloseTo(0.958333)
    expect(report.aggregate.dimensions.cache.cacheHitRatio).toBeCloseTo(0.785714)
    expect(report.gate.checks.cacheHitRatio.status).toBe("pass")

    const disk = (await Bun.file(reportPath).json()) as typeof report
    expect(disk.aggregate.dimensions.cache.cacheHitRatio).toBeCloseTo(0.785714)
    expect(await Bun.file(reportPath).exists()).toBe(true)
    expect(await Bun.file(summaryPath).exists()).toBe(true)

    const summary = await Bun.file(summaryPath).text()
    expect(summary.includes("## Claim Dimensions")).toBe(true)
    expect(summary.includes("## Citation Dimensions")).toBe(true)
    expect(summary.includes("## Cache Dimensions")).toBe(true)
  })

  test("cache hit ratio below threshold warns or blocks based on gate flag", async () => {
    await using tmp = await tmpdir()
    const suiteDir = await writeSuites(tmp.path, [
      {
        specVersion: "offline-eval/1.0",
        id: "cache_heavy_v1",
        baselineTaskCompletion: 0.9,
        totals: {
          claims: 100,
          unsupportedClaims: 3,
          unknownPredictions: 20,
          correctUnknownPredictions: 18,
          citationChecks: 50,
          validCitations: 49,
          keyClaims: 20,
          keyClaimsWithEvidence: 20,
          cacheRequests: 10,
          cacheHits: 5,
          tasks: 30,
          completedTasks: 28,
        },
      },
    ])

    const warn = await runOfflineGateEval({
      suiteDir,
      reportPath: path.join(tmp.path, "warn-report.json"),
      summaryPath: path.join(tmp.path, "warn-summary.md"),
      enforceCacheHitRatio: false,
    })

    expect(warn.passed).toBe(true)
    expect(warn.gate.checks.cacheHitRatio.ok).toBe(false)
    expect(warn.gate.checks.cacheHitRatio.status).toBe("warn")

    const block = await runOfflineGateEval({
      suiteDir,
      reportPath: path.join(tmp.path, "block-report.json"),
      summaryPath: path.join(tmp.path, "block-summary.md"),
      enforceCacheHitRatio: true,
    })

    expect(block.passed).toBe(false)
    expect(block.gate.checks.cacheHitRatio.ok).toBe(false)
    expect(block.gate.checks.cacheHitRatio.status).toBe("fail")
  })
})
