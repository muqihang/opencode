import path from "path"
import { runOnlineGateDashboard } from "../src/eval/online-gate"

const args = process.argv.slice(2)

const pick = (name: string) => {
  const match = args.find((item) => item.startsWith(`${name}=`))
  if (!match) return
  const value = match.slice(name.length + 1).trim()
  if (!value) return
  return value
}

const num = (value: string | undefined) => {
  if (!value) return
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return
  return parsed
}

const cwd = process.cwd()
const evidenceDir = path.resolve(cwd, pick("--evidenceDir") ?? ".opencode/evidence")
const artifactsDir = path.resolve(cwd, pick("--artifactsDir") ?? ".opencode/artifacts")
const dashboardPath = path.resolve(cwd, pick("--dashboard") ?? "online-gate-dashboard.json")
const summaryPath = path.resolve(cwd, pick("--summary") ?? "online-gate-dashboard.md")
const alertPath = path.resolve(cwd, pick("--alert") ?? "online-gate-alert.json")
const now = pick("--now")
const baselineSecure = num(pick("--baselineSecure") ?? process.env.OPENCODE_ONLINE_GATE_BASELINE_SECURE_OUTPUT_PASS_RATE)
const baselineCritic = num(pick("--baselineCritic") ?? process.env.OPENCODE_ONLINE_GATE_BASELINE_CRITIC_DEGRADED_RATE)

const result = await runOnlineGateDashboard({
  evidenceDir,
  artifactsDir,
  dashboardPath,
  summaryPath,
  alertPath,
  ...(now ? { now } : {}),
  baseline:
    baselineSecure === undefined && baselineCritic === undefined
      ? undefined
      : {
          secure_output_pass_rate: baselineSecure,
          critic_degraded_rate: baselineCritic,
        },
})

const lines = [
  "online gate dashboard built",
  `status: ${result.alert.status}`,
  `gatePassed: ${result.alert.gatePassed ? "yes" : "no"}`,
  `evidenceDir: ${evidenceDir}`,
  `artifactsDir: ${artifactsDir}`,
  `dashboard: ${dashboardPath}`,
  `summary: ${summaryPath}`,
  `alert: ${alertPath}`,
]

console.log(lines.join("\n"))

if (result.alert.status === "fail") {
  process.exit(1)
}

process.exit(0)
