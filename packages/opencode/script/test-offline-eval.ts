import path from "path"
import { runOfflineGateEval } from "../src/eval/offline"
import { Flag } from "../src/flag/flag"

const cwd = process.cwd()
const reportPath = path.join(cwd, "offline-eval-report.json")
const summaryPath = path.join(cwd, "offline-eval-summary.md")
const suiteDir = path.join(cwd, "eval", "suites")

const report = await runOfflineGateEval({
  suiteDir,
  reportPath,
  summaryPath,
  enforceCacheHitRatio: Flag.OPENCODE_EXPERIMENTAL_OFFLINE_EVAL_GATES,
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

if (report.gate.checks.cacheHitRatio.status === "warn") {
  console.log("offline eval cache hit ratio below threshold (warning only: OPENCODE_EXPERIMENTAL_OFFLINE_EVAL_GATES=false)")
}

if (report.gate.passed) {
  process.exit(0)
}

process.exit(1)
