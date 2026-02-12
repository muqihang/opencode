import type { OrchestratorMode } from "@/protocol/orchestrator-plan"

export type HybridRoutingStrategy = "main_first"

export type HybridCompensationGate = "strict" | "balanced" | "off"

export type HybridRoutingRollback = "orchestrator_main"

export type HybridRoutingPolicy = {
  specVersion: "hybrid-routing-policy/1.0"
  source: "default" | "config" | "env" | "fallback"
  strategy: HybridRoutingStrategy
  compensationGate: HybridCompensationGate
  rollback: HybridRoutingRollback
}

type HybridMainRoute = {
  source: "orchestrator"
  enabled: boolean
  mode?: OrchestratorMode
  coversRetrieval?: boolean
  degraded: boolean
}

const isMainRetrievalMode = (mode: OrchestratorMode) => mode === "assist" || mode === "heavy"

const mainCoversRetrieval = (main: HybridMainRoute) => {
  if (typeof main.coversRetrieval === "boolean") return main.coversRetrieval
  if (!main.mode) return false
  return isMainRetrievalMode(main.mode)
}

const build = (input: {
  source: HybridRoutingPolicy["source"]
  strategy: HybridRoutingStrategy
  compensationGate: HybridCompensationGate
  rollback: HybridRoutingRollback
}): HybridRoutingPolicy => ({
  specVersion: "hybrid-routing-policy/1.0",
  source: input.source,
  strategy: input.strategy,
  compensationGate: input.compensationGate,
  rollback: input.rollback,
})

const parseStrategy = (value: unknown): HybridRoutingStrategy | undefined => {
  if (typeof value !== "string") return
  const strategy = value.trim().toLowerCase()
  if (strategy === "main_first") return "main_first"
  return
}

const parseGate = (value: unknown): HybridCompensationGate | undefined => {
  if (typeof value !== "string") return
  const gate = value.trim().toLowerCase()
  if (gate === "strict") return "strict"
  if (gate === "balanced") return "balanced"
  if (gate === "off") return "off"
  return
}

const parseRollback = (value: unknown): HybridRoutingRollback | undefined => {
  if (typeof value !== "string") return
  const rollback = value.trim().toLowerCase()
  if (rollback === "orchestrator_main") return "orchestrator_main"
  return
}

const defaults = {
  strategy: "main_first" as HybridRoutingStrategy,
  compensationGate: "balanced" as HybridCompensationGate,
  rollback: "orchestrator_main" as HybridRoutingRollback,
}

const fallbackPolicy = () =>
  build({
    source: "fallback",
    strategy: defaults.strategy,
    compensationGate: "strict",
    rollback: defaults.rollback,
  })

export const resolveHybridRoutingPolicy = (input?: {
  strategy?: unknown
  gate?: unknown
  rollback?: unknown
  envStrategy?: unknown
  envGate?: unknown
  envRollback?: unknown
}): HybridRoutingPolicy => {
  const envUsed = input?.envStrategy !== undefined || input?.envGate !== undefined || input?.envRollback !== undefined
  const envStrategy = parseStrategy(input?.envStrategy)
  const envGate = parseGate(input?.envGate)
  const envRollback = parseRollback(input?.envRollback)
  if (envUsed) {
    if (!envStrategy && input?.envStrategy !== undefined) return fallbackPolicy()
    if (!envGate && input?.envGate !== undefined) return fallbackPolicy()
    if (!envRollback && input?.envRollback !== undefined) return fallbackPolicy()
    return build({
      source: "env",
      strategy: envStrategy ?? defaults.strategy,
      compensationGate: envGate ?? defaults.compensationGate,
      rollback: envRollback ?? defaults.rollback,
    })
  }

  const cfgUsed = input?.strategy !== undefined || input?.gate !== undefined || input?.rollback !== undefined
  const cfgStrategy = parseStrategy(input?.strategy)
  const cfgGate = parseGate(input?.gate)
  const cfgRollback = parseRollback(input?.rollback)
  if (cfgUsed) {
    if (!cfgStrategy && input?.strategy !== undefined) return fallbackPolicy()
    if (!cfgGate && input?.gate !== undefined) return fallbackPolicy()
    if (!cfgRollback && input?.rollback !== undefined) return fallbackPolicy()
    return build({
      source: "config",
      strategy: cfgStrategy ?? defaults.strategy,
      compensationGate: cfgGate ?? defaults.compensationGate,
      rollback: cfgRollback ?? defaults.rollback,
    })
  }

  return build({
    source: "default",
    strategy: defaults.strategy,
    compensationGate: defaults.compensationGate,
    rollback: defaults.rollback,
  })
}

export const shouldRunCompensationByPolicy = (input: {
  policy?: HybridRoutingPolicy
  main?: HybridMainRoute
}) => {
  const policy = input.policy ?? resolveHybridRoutingPolicy()
  if (policy.compensationGate === "off") return false

  const main = input.main
  if (!main) return true
  if (main.source !== "orchestrator") return true
  if (!main.enabled) return true
  if (main.degraded) return true
  if (mainCoversRetrieval(main)) return false
  if (policy.compensationGate === "balanced") return true
  return false
}
