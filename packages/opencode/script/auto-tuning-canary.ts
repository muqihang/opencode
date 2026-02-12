import path from "path"
import { runAutoTuningCanary, type AutoTuningInput } from "../src/eval/auto-tuning"

const args = process.argv.slice(2)

const pick = (name: string) => {
  const found = args.find((item) => item.startsWith(`${name}=`))
  if (!found) return
  const value = found.slice(name.length + 1).trim()
  if (!value) return
  return value
}

const num = (value: unknown, fallback: number) => {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

const bool = (value: unknown, fallback: boolean) => {
  if (typeof value === "boolean") return value
  if (typeof value === "string") {
    if (value === "true") return true
    if (value === "false") return false
  }
  return fallback
}

const status = (value: unknown, fallback: "pass" | "warn" | "fail") => {
  if (value === "pass" || value === "warn" || value === "fail") return value
  return fallback
}

const list = (value: unknown) => {
  if (!Array.isArray(value)) return [] as string[]
  return value.filter((item): item is string => typeof item === "string" && item.length > 0)
}

const checks = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {} as Record<string, "pass" | "warn" | "fail">
  return Object.entries(value).reduce(
    (memo, [key, item]) => {
      const state =
        item && typeof item === "object" && !Array.isArray(item)
          ? status((item as Record<string, unknown>).status, "pass")
          : status(item, "pass")
      return {
        ...memo,
        [key]: state,
      }
    },
    {} as Record<string, "pass" | "warn" | "fail">,
  )
}

const cwd = process.cwd()

const resolvePath = (value: string | undefined, fallback: string) => path.resolve(cwd, value ?? fallback)

const mode = (() => {
  const value = pick("--mode")
  if (value === "advisory" || value === "canary") return value
  return "canary"
})()

const offlinePath = resolvePath(pick("--offline"), "offline-eval-nightly-report.json")
const onlinePath = resolvePath(pick("--online"), "online-gate-alert.json")
const onlineDashboardPath = resolvePath(pick("--onlineDashboard"), "online-gate-dashboard.json")
const baselinePath = resolvePath(pick("--baseline"), "auto-tuning-baseline.json")
const snapshotPath = resolvePath(pick("--snapshot"), "auto-tuning-canary-snapshot.json")
const reportPath = resolvePath(pick("--report"), "auto-tuning-canary-report.md")
const now = pick("--now")

const offlineRaw = await Bun.file(offlinePath).json().catch(() => ({} as Record<string, unknown>))
const onlineRaw = await Bun.file(onlinePath).json().catch(() => ({} as Record<string, unknown>))
const onlineDashboardRaw = await Bun.file(onlineDashboardPath).json().catch(() => ({} as Record<string, unknown>))
const baselineRaw = await Bun.file(baselinePath).json().catch(() => ({} as Record<string, unknown>))

const offlineGate =
  offlineRaw &&
  typeof offlineRaw === "object" &&
  !Array.isArray(offlineRaw) &&
  (offlineRaw as Record<string, unknown>).gate &&
  typeof (offlineRaw as Record<string, unknown>).gate === "object"
    ? ((offlineRaw as Record<string, unknown>).gate as Record<string, unknown>)
    : ({} as Record<string, unknown>)

const onlineMetrics =
  onlineDashboardRaw &&
  typeof onlineDashboardRaw === "object" &&
  !Array.isArray(onlineDashboardRaw) &&
  (onlineDashboardRaw as Record<string, unknown>).metrics &&
  typeof (onlineDashboardRaw as Record<string, unknown>).metrics === "object"
    ? ((onlineDashboardRaw as Record<string, unknown>).metrics as Record<string, unknown>)
    : ({} as Record<string, unknown>)

const duplicateMetric =
  onlineMetrics.duplicate_retrieval_rate &&
  typeof onlineMetrics.duplicate_retrieval_rate === "object" &&
  !Array.isArray(onlineMetrics.duplicate_retrieval_rate)
    ? (onlineMetrics.duplicate_retrieval_rate as Record<string, unknown>)
    : ({} as Record<string, unknown>)

const secureMetric =
  onlineMetrics.secure_output_pass_rate &&
  typeof onlineMetrics.secure_output_pass_rate === "object" &&
  !Array.isArray(onlineMetrics.secure_output_pass_rate)
    ? (onlineMetrics.secure_output_pass_rate as Record<string, unknown>)
    : ({} as Record<string, unknown>)

const input: AutoTuningInput = {
  generatedAt: now ?? new Date().toISOString(),
  mode,
  baseline: {
    retrievalTopK: num((baselineRaw as Record<string, unknown>).retrievalTopK, 8),
    maxToolCalls: num((baselineRaw as Record<string, unknown>).maxToolCalls, 2),
    criticThreshold: num((baselineRaw as Record<string, unknown>).criticThreshold, 0.82),
  },
  offline: {
    passed: bool((offlineRaw as Record<string, unknown>).passed ?? offlineGate.passed, false),
    checks: checks((offlineRaw as Record<string, unknown>).checks ?? offlineGate.checks),
  },
  online: {
    status: status((onlineRaw as Record<string, unknown>).status, "warn"),
    breaches: list((onlineRaw as Record<string, unknown>).breaches),
    metrics: {
      duplicate_retrieval_rate: num((onlineRaw as Record<string, unknown>).duplicate_retrieval_rate ?? duplicateMetric.value1h, 0),
      secure_output_pass_rate: num((onlineRaw as Record<string, unknown>).secure_output_pass_rate ?? secureMetric.value24h, 1),
    },
  },
}

const result = await runAutoTuningCanary({
  snapshotPath,
  reportPath,
  input,
})

const lines = [
  "auto tuning canary completed",
  `mode: ${result.snapshot.mode}`,
  `decision: ${result.snapshot.decision}`,
  `advisoryOnly: ${result.snapshot.advisoryOnly ? "yes" : "no"}`,
  `autoApply: ${result.snapshot.autoApply ? "yes" : "no"}`,
  `offline: ${offlinePath}`,
  `online: ${onlinePath}`,
  `onlineDashboard: ${onlineDashboardPath}`,
  `baseline: ${baselinePath}`,
  `snapshot: ${snapshotPath}`,
  `report: ${reportPath}`,
]

console.log(lines.join("\n"))
process.exit(0)
