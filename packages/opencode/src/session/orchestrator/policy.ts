import type { OrchestratorPlan } from "@/protocol/orchestrator-plan"

type SecureOutputMode = "strict" | "balanced" | "loose"
type ForkStrategy = "auto" | "suggest" | "off"

type ResolveInput = {
  enabled: boolean
  plan?: OrchestratorPlan
}

type ForkInput = {
  product?: {
    mode?: "base" | "programming" | "legal" | "marxism"
    forkStrategy?: ForkStrategy
  }
  env?: ForkStrategy
}

export const resolveSecureOutputMode = (input: ResolveInput): SecureOutputMode | null => {
  if (!input.enabled) return "balanced"
  const plan = input.plan
  if (!plan) return "balanced"

  const policyMode = plan.evidencePolicy?.mode
  if (plan.orchestratorMode === "fork") return null
  if (plan.orchestratorMode === "chat") {
    if (plan.evidencePolicy?.enabled) return policyMode ?? "balanced"
    return null
  }
  if (plan.orchestratorMode === "assist") return policyMode ?? "balanced"
  if (plan.orchestratorMode === "heavy") return policyMode ?? "strict"

  return "balanced"
}

export const resolveForkStrategy = (input: ForkInput): ForkStrategy => {
  const strategy = input.product?.forkStrategy
  if (strategy) return strategy

  const mode = input.product?.mode
  if (mode && mode !== "base") return "suggest"

  return input.env ?? "auto"
}

export type { SecureOutputMode, ResolveInput, ForkStrategy, ForkInput }
