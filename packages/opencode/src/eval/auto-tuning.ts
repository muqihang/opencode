import fs from "fs/promises"
import path from "path"
import { stableJson } from "@/util/stable-json"

export const AUTO_TUNING_SPEC = "auto-tuning/1.0" as const

const RISK_ORDER = {
  low: 1,
  medium: 2,
  high: 3,
} as const

type Risk = keyof typeof RISK_ORDER
type GateStatus = "pass" | "warn" | "fail"
type Decision = "hold" | "suggest"
type Mode = "advisory" | "canary"

export type AutoTuningParams = {
  retrievalTopK: number
  maxToolCalls: number
  criticThreshold: number
}

export type AutoTuningChange = {
  key: keyof AutoTuningParams
  before: number
  after: number
  reason: string
  risk: Risk
}

export type AutoTuningSnapshot = {
  specVersion: typeof AUTO_TUNING_SPEC
  generatedAt: string
  mode: Mode
  advisoryOnly: true
  autoApply: false
  decision: Decision
  rollbackAction: "冻结建议+回到上一版人工签收参数"
  guardrail: {
    offlinePassed: boolean
    onlineStatus: GateStatus
    onlineBreaches: string[]
  }
  before: AutoTuningParams
  after: AutoTuningParams
  changes: AutoTuningChange[]
}

type Rule = {
  key: keyof AutoTuningParams
  risk: Risk
  reason: string
  apply: (value: number) => number
}

type RuleState = {
  after: AutoTuningParams
  reasons: Partial<Record<keyof AutoTuningParams, string[]>>
  risks: Partial<Record<keyof AutoTuningParams, Risk>>
}

const round = (value: number) => Math.round(value * 1_000_000) / 1_000_000

const clamp = (input: { value: number; min: number; max: number }) =>
  Math.min(input.max, Math.max(input.min, input.value))

const mergeRisk = (current: Risk | undefined, next: Risk) => {
  if (!current) return next
  if (RISK_ORDER[next] >= RISK_ORDER[current]) return next
  return current
}

const toChange = (input: {
  before: AutoTuningParams
  state: RuleState
  key: keyof AutoTuningParams
}): AutoTuningChange | undefined => {
  const before = round(input.before[input.key])
  const after = round(input.state.after[input.key])
  if (before === after) return
  const reason = (input.state.reasons[input.key] ?? []).join("; ")
  return {
    key: input.key,
    before,
    after,
    reason,
    risk: input.state.risks[input.key] ?? "low",
  }
}

const applyRule = (input: { state: RuleState; rule: Rule }): RuleState => {
  const current = input.state.after[input.rule.key]
  const next = round(input.rule.apply(current))
  if (current === next) return input.state
  const reasons = {
    ...input.state.reasons,
    [input.rule.key]: [...(input.state.reasons[input.rule.key] ?? []), input.rule.reason],
  }
  const risks = {
    ...input.state.risks,
    [input.rule.key]: mergeRisk(input.state.risks[input.rule.key], input.rule.risk),
  }
  return {
    after: {
      ...input.state.after,
      [input.rule.key]: next,
    },
    reasons,
    risks,
  }
}

const hasFailCheck = (input: { checks: Record<string, GateStatus> | undefined; key: string }) =>
  input.checks?.[input.key] === "fail"

type SnapshotInput = {
  generatedAt?: string
  mode: Mode
  baseline: AutoTuningParams
  offline: {
    passed: boolean
    checks?: Record<string, GateStatus>
  }
  online: {
    status: GateStatus
    breaches: string[]
    metrics?: {
      duplicate_retrieval_rate?: number
      secure_output_pass_rate?: number
    }
  }
}

export type AutoTuningInput = SnapshotInput

const buildRules = (input: SnapshotInput): Rule[] => {
  const duplicateBreach =
    input.online.breaches.includes("g2.duplicate_retrieval_rate") ||
    input.online.breaches.includes("h2.duplicate_retrieval_rate_6h") ||
    (input.online.metrics?.duplicate_retrieval_rate ?? 0) > 0.15
  const secureBreach =
    input.online.breaches.includes("g2.secure_output_pass_rate") ||
    input.online.breaches.includes("h2.secure_output_pass_rate_drop") ||
    ((input.online.metrics?.secure_output_pass_rate ?? 1) < 0.95 && input.online.status !== "pass")
  const qualityBreach =
    !input.offline.passed ||
    hasFailCheck({ checks: input.offline.checks, key: "citationIntegrity" }) ||
    hasFailCheck({ checks: input.offline.checks, key: "taskCompletion" })

  return [
    ...(duplicateBreach
      ? [
          {
            key: "retrievalTopK" as const,
            risk: "medium" as const,
            reason: "online duplicate retrieval 过高，建议降低检索扇出",
            apply: (value: number) => clamp({ value: value - 1, min: 4, max: 12 }),
          },
        ]
      : []),
    ...(secureBreach
      ? [
          {
            key: "maxToolCalls" as const,
            risk: "medium" as const,
            reason: "secure output pass rate 下降，建议收紧单轮工具调用",
            apply: (value: number) => clamp({ value: value - 1, min: 1, max: 4 }),
          },
          {
            key: "criticThreshold" as const,
            risk: "high" as const,
            reason: "secure output pass rate 下降，建议提高 critic 阈值",
            apply: (value: number) => clamp({ value: value + 0.02, min: 0.6, max: 0.99 }),
          },
        ]
      : []),
    ...(qualityBreach
      ? [
          {
            key: "criticThreshold" as const,
            risk: "high" as const,
            reason: "offline gate 未通过，建议提高 critic 阈值抑制风险输出",
            apply: (value: number) => clamp({ value: value + 0.03, min: 0.6, max: 0.99 }),
          },
        ]
      : []),
  ]
}

export const generateAutoTuningSnapshot = (input: SnapshotInput): AutoTuningSnapshot => {
  const rules = buildRules(input)
  const state = rules.reduce(
    (memo, rule) => applyRule({ state: memo, rule }),
    {
      after: input.baseline,
      reasons: {},
      risks: {},
    } satisfies RuleState,
  )
  const changes = (["retrievalTopK", "maxToolCalls", "criticThreshold"] as const)
    .map((key) => toChange({ before: input.baseline, state, key }))
    .filter((item): item is AutoTuningChange => Boolean(item))

  return {
    specVersion: AUTO_TUNING_SPEC,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    mode: input.mode,
    advisoryOnly: true,
    autoApply: false,
    decision: changes.length > 0 ? "suggest" : "hold",
    rollbackAction: "冻结建议+回到上一版人工签收参数",
    guardrail: {
      offlinePassed: input.offline.passed,
      onlineStatus: input.online.status,
      onlineBreaches: [...input.online.breaches],
    },
    before: input.baseline,
    after: state.after,
    changes,
  }
}

const fmt = (value: number) => value.toFixed(4)

const row = (input: AutoTuningChange) =>
  `| ${input.key} | ${fmt(input.before)} | ${fmt(input.after)} | ${input.reason} | ${input.risk} |`

export const renderAutoTuningCanaryReport = (input: { snapshot: AutoTuningSnapshot }) => {
  const lines = [
    "# Auto-Tuning Canary Report",
    "",
    "- 模式：受控建议模式（advisory/canary），非自动落参",
    `- generatedAt: ${input.snapshot.generatedAt}`,
    `- decision: ${input.snapshot.decision}`,
    `- autoApply: ${input.snapshot.autoApply ? "yes" : "no"}`,
    `- advisoryOnly: ${input.snapshot.advisoryOnly ? "yes" : "no"}`,
    `- rollbackAction: ${input.snapshot.rollbackAction}`,
    "",
    "## Guardrail Status",
    "",
    `- offlinePassed: ${input.snapshot.guardrail.offlinePassed ? "yes" : "no"}`,
    `- onlineStatus: ${input.snapshot.guardrail.onlineStatus}`,
    `- onlineBreaches: ${input.snapshot.guardrail.onlineBreaches.length === 0 ? "none" : input.snapshot.guardrail.onlineBreaches.join(", ")}`,
    "",
    "## Suggested Changes",
    "",
    "| key | before | after | reason | risk |",
    "| --- | ---: | ---: | --- | --- |",
    ...(input.snapshot.changes.length === 0 ? ["| (none) | - | - | no change | low |"] : input.snapshot.changes.map((item) => row(item))),
    "",
    "## Safety Statement",
    "",
    "- 本轮仅产出建议快照与报告，不写入线上配置，不自动改运行参数。",
    "- 如需回滚：冻结建议+回到上一版人工签收参数。",
  ]
  return `${lines.join("\n")}\n`
}

type RunAutoTuningCanaryInput = {
  snapshotPath: string
  reportPath: string
  input: SnapshotInput
}

export const runAutoTuningCanary = async (input: RunAutoTuningCanaryInput) => {
  const snapshot = generateAutoTuningSnapshot(input.input)
  const report = renderAutoTuningCanaryReport({ snapshot })
  await fs.mkdir(path.dirname(input.snapshotPath), { recursive: true })
  await fs.mkdir(path.dirname(input.reportPath), { recursive: true })
  await Bun.write(input.snapshotPath, stableJson(snapshot))
  await Bun.write(input.reportPath, report)
  return {
    snapshot,
    report,
  }
}
