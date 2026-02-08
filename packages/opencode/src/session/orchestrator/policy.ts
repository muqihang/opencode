import type { OrchestratorPlan } from "@/protocol/orchestrator-plan"

type SecureOutputMode = "strict" | "balanced" | "loose"
type ForkStrategy = "auto" | "suggest" | "off"
type PolicyAction = "allow" | "ask" | "deny"
type PolicyMap = Partial<Record<string, PolicyAction>>
type PolicySource = "core" | "tenant" | "plugin" | "runtime_hint"

type PolicyConflictReason = {
  code: "policy_conflict_denied"
  key: string
  winner: "core" | "tenant"
  source: "plugin"
  attempted: PolicyAction
  enforced: "deny"
}

type MergePolicyInput = {
  core?: PolicyMap
  tenant?: PolicyMap
  plugin?: PolicyMap
  runtimeHint?: PolicyMap
}

type MergePolicyResult = {
  policy: Record<string, PolicyAction>
  reasons: PolicyConflictReason[]
}

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

const pickPolicy = (input: { key: string } & MergePolicyInput): PolicyAction | undefined => {
  const core = input.core?.[input.key]
  if (core) return core

  const tenant = input.tenant?.[input.key]
  if (tenant) return tenant

  const plugin = input.plugin?.[input.key]
  if (plugin) return plugin

  return input.runtimeHint?.[input.key]
}

const deniedConflict = (input: { key: string } & MergePolicyInput): PolicyConflictReason | undefined => {
  const attempted = input.plugin?.[input.key]
  if (!attempted) return
  if (attempted === "deny") return

  const core = input.core?.[input.key]
  if (core === "deny") {
    return {
      code: "policy_conflict_denied",
      key: input.key,
      winner: "core",
      source: "plugin",
      attempted,
      enforced: "deny",
    }
  }

  const tenant = input.tenant?.[input.key]
  if (tenant === "deny") {
    return {
      code: "policy_conflict_denied",
      key: input.key,
      winner: "tenant",
      source: "plugin",
      attempted,
      enforced: "deny",
    }
  }
}

export const mergePolicyPrecedence = (input: MergePolicyInput): MergePolicyResult => {
  const keys = new Set([
    ...Object.keys(input.core ?? {}),
    ...Object.keys(input.tenant ?? {}),
    ...Object.keys(input.plugin ?? {}),
    ...Object.keys(input.runtimeHint ?? {}),
  ])
  const policy: Record<string, PolicyAction> = {}
  const reasons: PolicyConflictReason[] = []

  for (const key of keys) {
    const action = pickPolicy({ ...input, key })
    if (action) {
      policy[key] = action
    }

    const reason = deniedConflict({ ...input, key })
    if (reason) reasons.push(reason)
  }

  return {
    policy,
    reasons,
  }
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

export type {
  SecureOutputMode,
  ResolveInput,
  ForkStrategy,
  ForkInput,
  PolicyAction,
  PolicyMap,
  PolicySource,
  PolicyConflictReason,
  MergePolicyInput,
  MergePolicyResult,
}
