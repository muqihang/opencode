export const OFFLINE_EVAL_SPEC = "offline-eval/1.0" as const

export const OFFLINE_GATE = {
  unsupportedClaimRate: 0.05,
  unknownPrecision: 0.85,
  citationIntegrity: 0.95,
  keyClaimEvidenceIntegrity: 1,
  cacheHitRatio: 0.7,
  taskCompletionDelta: 0.03,
} as const

type Cmp = "<=" | ">="
type Status = "pass" | "fail" | "warn"

export type GateCheck = {
  ok: boolean
  status: Status
  metric:
    | "unsupportedClaimRate"
    | "unknownPrecision"
    | "citationIntegrity"
    | "keyClaimEvidenceIntegrity"
    | "cacheHitRatio"
    | "taskCompletion"
  cmp: Cmp
  actual: number
  threshold: number
}

export type OfflineGateInput = {
  unsupportedClaimRate: number
  unknownPrecision: number
  citationIntegrity: number
  keyClaimEvidenceIntegrity: number
  cacheHitRatio: number
  taskCompletion: number
  baselineTaskCompletion: number
  enforceCacheHitRatio?: boolean
}

export type OfflineGateResult = {
  specVersion: typeof OFFLINE_EVAL_SPEC
  passed: boolean
  thresholds: {
    unsupportedClaimRate: number
    unknownPrecision: number
    citationIntegrity: number
    keyClaimEvidenceIntegrity: number
    cacheHitRatio: number
    taskCompletionFloor: number
  }
  checks: {
    unsupportedClaimRate: GateCheck
    unknownPrecision: GateCheck
    citationIntegrity: GateCheck
    keyClaimEvidenceIntegrity: GateCheck
    cacheHitRatio: GateCheck
    taskCompletion: GateCheck
  }
}

const round = (v: number) => Math.round(v * 1_000_000) / 1_000_000

const status = (ok: boolean): Status => (ok ? "pass" : "fail")

const checkLe = (input: {
  metric: GateCheck["metric"]
  actual: number
  threshold: number
}): GateCheck => {
  const actual = round(input.actual)
  const threshold = round(input.threshold)
  const ok = actual <= threshold
  return {
    ok,
    status: status(ok),
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
  const ok = actual >= threshold
  return {
    ok,
    status: status(ok),
    metric: input.metric,
    cmp: ">=",
    actual,
    threshold,
  }
}

const warnable = (input: { check: GateCheck; enforce: boolean }) => {
  if (input.enforce || input.check.ok) return input.check
  return {
    ...input.check,
    status: "warn" as const,
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
    keyClaimEvidenceIntegrity: checkGe({
      metric: "keyClaimEvidenceIntegrity",
      actual: input.keyClaimEvidenceIntegrity,
      threshold: OFFLINE_GATE.keyClaimEvidenceIntegrity,
    }),
    cacheHitRatio: warnable({
      check: checkGe({
        metric: "cacheHitRatio",
        actual: input.cacheHitRatio,
        threshold: OFFLINE_GATE.cacheHitRatio,
      }),
      enforce: input.enforceCacheHitRatio ?? true,
    }),
    taskCompletion: checkGe({
      metric: "taskCompletion",
      actual: input.taskCompletion,
      threshold: taskFloor,
    }),
  }
  const passed = Object.values(checks).every((item) => item.status !== "fail")

  return {
    specVersion: OFFLINE_EVAL_SPEC,
    passed,
    thresholds: {
      unsupportedClaimRate: OFFLINE_GATE.unsupportedClaimRate,
      unknownPrecision: OFFLINE_GATE.unknownPrecision,
      citationIntegrity: OFFLINE_GATE.citationIntegrity,
      keyClaimEvidenceIntegrity: OFFLINE_GATE.keyClaimEvidenceIntegrity,
      cacheHitRatio: OFFLINE_GATE.cacheHitRatio,
      taskCompletionFloor: taskFloor,
    },
    checks,
  }
}
