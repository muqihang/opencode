type Input = {
  stage: string
  reason: string
}

export type DegradedTaxonomy = {
  reason_codes: string[]
  failure_class: string
  failure_code: string
  fallback_from: string
  fallback_to: string
  fallback_edge: string
  retryable: boolean
}

const AdaptiveStop = new Set([
  "adaptive.ttc.early_stop",
  "adaptive.ttc.degrade_3_to_2",
  "adaptive.ttc.degrade_2_to_1",
  "adaptive.ttc.max_rerun.stop",
  "adaptive.ttc.breaker.active",
  "adaptive.ttc.breaker.trip",
])

const AdaptiveBreaker = new Set(["adaptive.ttc.breaker.active", "adaptive.ttc.breaker.trip"])

const clean = (value: string) => value.trim()

const kebabToSnake = (value: string) => value.replace(/-/g, "_")

const normalizeCode = (value: string) => {
  const text = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._=-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
  if (text.startsWith("fallback=")) {
    const target = kebabToSnake(text.slice("fallback=".length).trim())
    if (target) return `fallback.${target}`
  }
  return text
}

const dedupe = (input: string[]) => Array.from(new Set(input.filter(Boolean)))

const fromAdaptiveCodes = (reason: string) => {
  const hits = reason.match(/adaptive\.ttc\.[a-z0-9_.-]+/gi)
  const list = (hits ?? []).map((item) => item.toLowerCase())
  return dedupe(list)
}

const fromSegments = (reason: string) => {
  const bits = reason
    .split(/[;,]/)
    .map(clean)
    .filter(Boolean)
    .map(normalizeCode)
    .filter(Boolean)
  return dedupe(bits)
}

const fallbackTarget = (reason: string) => {
  const match = reason.match(/fallback=([a-z0-9_-]+)/i)
  const value = match?.[1]?.trim().toLowerCase()
  if (!value) return ""
  if (value === "unknown-first") return "dual_pass_unknown_first"
  if (value === "draft") return "dual_pass_draft"
  return `dual_pass_${kebabToSnake(value)}`
}

const taxonomyAdaptive = (input: { codes: string[] }) => {
  const stop = input.codes.some((code) => AdaptiveStop.has(code))
  const breaker = input.codes.some((code) => AdaptiveBreaker.has(code))
  const unknown = input.codes.includes("adaptive.ttc.fallback.unknown_first")
  const failure =
    input.codes.find((code) => AdaptiveBreaker.has(code)) ??
    input.codes.find((code) => AdaptiveStop.has(code)) ??
    input.codes[0] ??
    "adaptive.ttc.degraded"
  return {
    reason_codes: input.codes,
    failure_class: "adaptive_ttc",
    failure_code: failure,
    fallback_from: breaker || unknown ? "adaptive_ttc_breaker" : "adaptive_ttc",
    fallback_to: stop || unknown ? "dual_pass_unknown_first" : "dual_pass_draft",
    fallback_edge: stop ? "stop" : "continue",
    retryable: !stop,
  } satisfies DegradedTaxonomy
}

const taxonomyDualPass = (input: { codes: string[]; reason: string }) => {
  const failure = input.codes[0] ?? "dual_pass_degraded"
  return {
    reason_codes: input.codes,
    failure_class: "dual_pass",
    failure_code: failure,
    fallback_from: "dual_pass_critic",
    fallback_to: fallbackTarget(input.reason),
    fallback_edge: "degrade",
    retryable: true,
  } satisfies DegradedTaxonomy
}

const taxonomyPlanner = (input: { codes: string[] }) => {
  const failure = input.codes[0] ?? "planner_degraded_fallback"
  return {
    reason_codes: input.codes,
    failure_class: "planner",
    failure_code: failure,
    fallback_from: "planner",
    fallback_to: "dual_pass_unknown_first",
    fallback_edge: "fallback",
    retryable: true,
  } satisfies DegradedTaxonomy
}

const taxonomyPlan = (input: { codes: string[] }) => {
  const failure = input.codes[0] ?? "plan_error"
  return {
    reason_codes: input.codes,
    failure_class: "plan",
    failure_code: failure,
    fallback_from: "plan_builder",
    fallback_to: "orchestrator_bypass",
    fallback_edge: "error",
    retryable: true,
  } satisfies DegradedTaxonomy
}

const taxonomyTurn = (input: { codes: string[] }) => {
  const failure = input.codes[0] ?? "turn_error"
  return {
    reason_codes: input.codes,
    failure_class: "turn",
    failure_code: failure,
    fallback_from: "orchestrator_turn",
    fallback_to: "pass_through",
    fallback_edge: "error",
    retryable: true,
  } satisfies DegradedTaxonomy
}

const taxonomyForkTask = (input: { codes: string[] }) => {
  const failure = input.codes[0] ?? "fork_task_error"
  return {
    reason_codes: input.codes,
    failure_class: "fork_task",
    failure_code: failure,
    fallback_from: "fork_task",
    fallback_to: "fork_notice_skip",
    fallback_edge: "error",
    retryable: true,
  } satisfies DegradedTaxonomy
}

const taxonomyDefault = (input: { stage: string; codes: string[] }) => {
  const stage = normalizeCode(input.stage).replace(/\./g, "_") || "orchestrator"
  const failure = input.codes[0] ?? `${stage}_degraded`
  return {
    reason_codes: input.codes,
    failure_class: stage,
    failure_code: failure,
    fallback_from: "",
    fallback_to: "",
    fallback_edge: "",
    retryable: true,
  } satisfies DegradedTaxonomy
}

const reasonCodes = (input: Input) => {
  const adaptive = fromAdaptiveCodes(input.reason)
  if (adaptive.length > 0) return adaptive
  const generic = fromSegments(input.reason)
  if (generic.length > 0) return generic
  const fallback = normalizeCode(input.stage)
  if (fallback) return [fallback]
  return ["unknown_reason"]
}

export const normalizeOrchestratorDegraded = (input: Input): DegradedTaxonomy => {
  const stage = normalizeCode(input.stage)
  const codes = reasonCodes(input)
  if (stage === "adaptive_ttc" || stage === "adaptive_ttc_breaker") return taxonomyAdaptive({ codes })
  if (stage === "dual_pass") return taxonomyDualPass({ codes, reason: input.reason })
  if (stage === "planner") return taxonomyPlanner({ codes })
  if (stage === "plan") return taxonomyPlan({ codes })
  if (stage === "turn") return taxonomyTurn({ codes })
  if (stage === "fork_task") return taxonomyForkTask({ codes })
  return taxonomyDefault({ stage: input.stage, codes })
}
