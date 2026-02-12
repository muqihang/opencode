import { describe, expect, test } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { generateAutoTuningSnapshot, renderAutoTuningCanaryReport, runAutoTuningCanary } from "../../src/eval/auto-tuning"

describe("eval.auto tuning", () => {
  test("generates advisory suggestions with before/after/reason/risk when gates degrade", () => {
    const baseline = {
      retrievalTopK: 8,
      maxToolCalls: 2,
      criticThreshold: 0.82,
    }

    const snapshot = generateAutoTuningSnapshot({
      generatedAt: "2026-02-12T12:00:00.000Z",
      mode: "advisory",
      baseline,
      offline: {
        passed: false,
        checks: {
          citationIntegrity: "fail",
          taskCompletion: "fail",
        },
      },
      online: {
        status: "fail",
        breaches: ["g2.duplicate_retrieval_rate", "g2.secure_output_pass_rate"],
        metrics: {
          duplicate_retrieval_rate: 0.22,
          secure_output_pass_rate: 0.91,
        },
      },
    })

    expect(snapshot.specVersion).toBe("auto-tuning/1.0")
    expect(snapshot.mode).toBe("advisory")
    expect(snapshot.autoApply).toBe(false)
    expect(snapshot.advisoryOnly).toBe(true)
    expect(snapshot.rollbackAction).toBe("冻结建议+回到上一版人工签收参数")
    expect(snapshot.decision).toBe("suggest")
    expect(snapshot.changes.length).toBeGreaterThan(0)

    const keys = new Set(snapshot.changes.map((item) => item.key))
    expect(keys.has("retrievalTopK")).toBe(true)
    expect(keys.has("criticThreshold")).toBe(true)

    for (const item of snapshot.changes) {
      expect(item.before).not.toBe(item.after)
      expect(item.reason.length).toBeGreaterThan(0)
      expect(["low", "medium", "high"].includes(item.risk)).toBe(true)
    }

    expect(baseline.retrievalTopK).toBe(8)
    expect(baseline.maxToolCalls).toBe(2)
    expect(baseline.criticThreshold).toBe(0.82)
  })

  test("keeps hold decision without parameter rewrite when both gates are healthy", () => {
    const baseline = {
      retrievalTopK: 8,
      maxToolCalls: 2,
      criticThreshold: 0.82,
    }

    const snapshot = generateAutoTuningSnapshot({
      generatedAt: "2026-02-12T12:00:00.000Z",
      mode: "canary",
      baseline,
      offline: {
        passed: true,
        checks: {
          citationIntegrity: "pass",
          taskCompletion: "pass",
        },
      },
      online: {
        status: "pass",
        breaches: [],
        metrics: {
          duplicate_retrieval_rate: 0.08,
          secure_output_pass_rate: 0.97,
        },
      },
    })

    expect(snapshot.mode).toBe("canary")
    expect(snapshot.decision).toBe("hold")
    expect(snapshot.changes.length).toBe(0)
    expect(snapshot.after.retrievalTopK).toBe(baseline.retrievalTopK)
    expect(snapshot.after.maxToolCalls).toBe(baseline.maxToolCalls)
    expect(snapshot.after.criticThreshold).toBe(baseline.criticThreshold)
  })

  test("renders canary report with controlled advisory statement", () => {
    const snapshot = generateAutoTuningSnapshot({
      generatedAt: "2026-02-12T12:00:00.000Z",
      mode: "advisory",
      baseline: {
        retrievalTopK: 8,
        maxToolCalls: 2,
        criticThreshold: 0.82,
      },
      offline: {
        passed: false,
        checks: {
          citationIntegrity: "fail",
        },
      },
      online: {
        status: "warn",
        breaches: ["g2.duplicate_retrieval_rate"],
      },
    })

    const report = renderAutoTuningCanaryReport({ snapshot })

    expect(report.includes("受控建议模式（advisory/canary），非自动落参")).toBe(true)
    expect(report.includes("冻结建议+回到上一版人工签收参数")).toBe(true)
    expect(report.includes("retrievalTopK")).toBe(true)
  })

  test("writes canary snapshot and report artifacts", async () => {
    await using tmp = await tmpdir()
    const snapshotPath = path.join(tmp.path, "auto-tuning-snapshot.json")
    const reportPath = path.join(tmp.path, "auto-tuning-canary.md")

    const result = await runAutoTuningCanary({
      snapshotPath,
      reportPath,
      input: {
        generatedAt: "2026-02-12T12:00:00.000Z",
        mode: "canary",
        baseline: {
          retrievalTopK: 8,
          maxToolCalls: 2,
          criticThreshold: 0.82,
        },
        offline: {
          passed: false,
          checks: {
            citationIntegrity: "fail",
          },
        },
        online: {
          status: "fail",
          breaches: ["g2.duplicate_retrieval_rate"],
          metrics: {
            duplicate_retrieval_rate: 0.21,
          },
        },
      },
    })

    expect(result.snapshot.mode).toBe("canary")
    expect(result.snapshot.decision).toBe("suggest")
    expect(await Bun.file(snapshotPath).exists()).toBe(true)
    expect(await Bun.file(reportPath).exists()).toBe(true)

    const markdown = await Bun.file(reportPath).text()
    expect(markdown.includes("受控建议模式（advisory/canary），非自动落参")).toBe(true)
  })
})
