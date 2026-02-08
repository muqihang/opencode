import path from "path"
import { runOfflineGateEval } from "../src/eval/offline"

const cwd = process.cwd()
const reportPath = path.join(cwd, "offline-eval-report.json")
const summaryPath = path.join(cwd, "offline-eval-summary.md")
const suiteDir = path.join(cwd, "eval", "suites")

const report = await runOfflineGateEval({
  suiteDir,
  reportPath,
  summaryPath,
})

const lines = [
  "offline eval completed",
  `specVersion: ${report.specVersion}`,
  `suiteDir: ${report.suiteDir}`,
  `passed: ${report.gate.passed ? "yes" : "no"}`,
  `report: ${reportPath}`,
  `summary: ${summaryPath}`,
]
console.log(lines.join("\n"))

if (report.gate.passed) {
  process.exit(0)
}
process.exit(1)
