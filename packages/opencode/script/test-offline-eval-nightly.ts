import path from "path"
import { runOfflineGateEval } from "../src/eval/offline"

const cwd = process.cwd()
const suiteDir = path.join(cwd, "eval", "suites-nightly")
const reportPath = path.join(cwd, "offline-eval-nightly-report.json")
const summaryPath = path.join(cwd, "offline-eval-nightly-summary.md")

const report = await runOfflineGateEval({
  suiteDir,
  reportPath,
  summaryPath,
  minSampleCount: 50,
  enforceCacheHitRatio: true,
})

const lines = [
  "offline eval nightly completed",
  `specVersion: ${report.specVersion}`,
  `suiteDir: ${report.suiteDir}`,
  `sampleCount: ${report.aggregate.sampleCount}`,
  `minSampleCount: ${report.gate.thresholds.minSampleCount}`,
  `passed: ${report.gate.passed ? "yes" : "no"}`,
  `report: ${reportPath}`,
  `summary: ${summaryPath}`,
]
console.log(lines.join("\n"))

if (report.gate.passed) {
  process.exit(0)
}

process.exit(1)
