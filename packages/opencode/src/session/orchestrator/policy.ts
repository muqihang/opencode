import type { OrchestratorPlan } from "@/protocol/orchestrator-plan"

type SecureOutputMode = "strict" | "balanced" | "loose"

type ResolveInput = {
  enabled: boolean
  plan?: OrchestratorPlan
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

export type { SecureOutputMode, ResolveInput }
