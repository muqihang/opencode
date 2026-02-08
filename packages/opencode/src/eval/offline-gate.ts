export const OFFLINE_EVAL_SPEC = "offline-eval/1.0" as const

export const OFFLINE_GATE = {
  unsupportedClaimRate: 0.05,
  unknownPrecision: 0.85,
  citationIntegrity: 0.95,
  taskCompletionDelta: 0.03,
} as const

type Cmp = "<=" | ">="

export type GateCheck = {
  ok: boolean
  metric: "unsupportedClaimRate" | "unknownPrecision" | "citationIntegrity" | "taskCompletion"
  cmp: Cmp
  actual: number
  threshold: number
}

export type OfflineGateInput = {
  unsupportedClaimRate: number
  unknownPrecision: number
  citationIntegrity: number
  taskCompletion: number
  baselineTaskCompletion: number
}

export type OfflineGateResult = {
  specVersion: typeof OFFLINE_EVAL_SPEC
  passed: boolean
  thresholds: {
    unsupportedClaimRate: number
    unknownPrecision: number
    citationIntegrity: number
    taskCompletionFloor: number
  }
  checks: {
    unsupportedClaimRate: GateCheck
    unknownPrecision: GateCheck
    citationIntegrity: GateCheck
    taskCompletion: GateCheck
  }
}

const round = (v: number) => Math.round(v * 1_000_000) / 1_000_000

const checkLe = (input: {
  metric: GateCheck["metric"]
  actual: number
  threshold: number
}): GateCheck => {
  const actual = round(input.actual)
  const threshold = round(input.threshold)
  return {
    ok: actual <= threshold,
    metric: input.metric,
    cmp: "<=",
    actual,
    threshold,
  }
}

const checkGe = (input: {
  metric: GateCheck["metric"]
  actual: number
  threshold: number
}): GateCheck => {
  const actual = round(input.actual)
  const threshold = round(input.threshold)
  return {
    ok: actual >= threshold,
    metric: input.metric,
    cmp: ">=",
    actual,
    threshold,
  }
}

export const evaluateOfflineGate = (input: OfflineGateInput): OfflineGateResult => {
  const taskFloor = round(input.baselineTaskCompletion - OFFLINE_GATE.taskCompletionDelta)
  const checks = {
    unsupportedClaimRate: checkLe({
      metric: "unsupportedClaimRate",
      actual: input.unsupportedClaimRate,
      threshold: OFFLINE_GATE.unsupportedClaimRate,
    }),
    unknownPrecision: checkGe({
      metric: "unknownPrecision",
      actual: input.unknownPrecision,
      threshold: OFFLINE_GATE.unknownPrecision,
    }),
    citationIntegrity: checkGe({
      metric: "citationIntegrity",
      actual: input.citationIntegrity,
      threshold: OFFLINE_GATE.citationIntegrity,
    }),
    taskCompletion: checkGe({
      metric: "taskCompletion",
      actual: input.taskCompletion,
      threshold: taskFloor,
    }),
  }
  const passed = Object.values(checks).every((item) => item.ok)

  return {
    specVersion: OFFLINE_EVAL_SPEC,
    passed,
    thresholds: {
      unsupportedClaimRate: OFFLINE_GATE.unsupportedClaimRate,
      unknownPrecision: OFFLINE_GATE.unknownPrecision,
      citationIntegrity: OFFLINE_GATE.citationIntegrity,
      taskCompletionFloor: taskFloor,
    },
    checks,
  }
}
