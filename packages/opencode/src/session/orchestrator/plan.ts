import { ulid } from "ulid"
import { CachePolicy } from "@/cache/policy"
import { CacheStore } from "@/cache/store"
import { OrchestratorFeatures } from "@/protocol/orchestrator-features"
import {
  OrchestratorPlan,
  OrchestratorUxMode,
  OrchestratorMode,
  type OrchestratorPlanScores,
} from "@/protocol/orchestrator-plan"
import { Instance } from "@/project/instance"
import { sha256Text } from "@/routing/cache"
import { stableJson } from "@/util/stable-json"
import type { A1Features } from "./features"
import { modeFromScores } from "./scorer"

type BuildInput = {
  sessionId: string
  messageId: string
  features: OrchestratorFeatures
  scores?: OrchestratorPlanScores
  toolsetFingerprint: string
  a1?: A1Features
  dualPassSynthesis?: boolean
}

type CacheStatus = "hit" | "miss" | "expired" | "disabled" | "forced_rebuild"

type CacheTier = "memory" | "disk" | "none"

type CacheScope = {
  projectId: string
  worktreeRoot: string
}

type PlanCache = {
  status: CacheStatus
  tier: CacheTier
  key: string
  scope: CacheScope
  namespace: "orchestrator-plan"
}

type BuildResult = {
  plan: OrchestratorPlan
  cache: PlanCache
}

type PlanWorker = OrchestratorPlan["workers"][number]

type PlanReason = { code: string; message: string }

type Breaker = { trips: number }

const baseDir = () => (Instance.worktree === "/" ? Instance.directory : Instance.worktree)

const LargeIntentTokens = 256

const HeavyIntentTokens = 1024

const AdaptiveDefaultWorkers = 2

const AdaptiveMaxWorkers = 3

const AdaptiveBudgetDivisor = 8

const AdaptiveBreakerTrips = 2

const DualPassCriticTimeoutMs = 1200

const DualPassUnknownFirst = "unknown-first"

const breaker = new Map<string, Breaker>()

const readTrips = (sessionId: string) => breaker.get(sessionId)?.trips ?? 0

const writeTrips = (input: { sessionId: string; trips: number }) => {
  if (input.trips <= 0) {
    breaker.delete(input.sessionId)
    return
  }
  breaker.set(input.sessionId, { trips: input.trips })
}

const worker = (id: string): PlanWorker => ({
  id,
  model: "small",
  budget: { timeoutMs: 1500 },
})

const resolveModeLegacy = (input: {
  uxMode: OrchestratorUxMode
  hasVerificationIntent: boolean
  intentTokensEstimate: number
}): OrchestratorMode => {
  if (input.uxMode === "deep" && input.intentTokensEstimate >= HeavyIntentTokens) return "heavy"
  if (input.hasVerificationIntent) return "assist"
  if (input.uxMode === "deep" && input.intentTokensEstimate >= LargeIntentTokens) return "assist"
  return "chat"
}

const resolveMode = (input: {
  uxMode: OrchestratorUxMode
  hasWriteIntent: boolean
  hasExecIntent: boolean
  hasVerificationIntent: boolean
  intentTokensEstimate: number
  scores?: OrchestratorPlanScores
}): OrchestratorMode => {
  if (input.hasWriteIntent || input.hasExecIntent) return "fork"
  if (input.scores) return modeFromScores({ uxMode: input.uxMode, scores: input.scores })
  return resolveModeLegacy({
    uxMode: input.uxMode,
    hasVerificationIntent: input.hasVerificationIntent,
    intentTokensEstimate: input.intentTokensEstimate,
  })
}

const resolveEvidencePolicy = (input: { uxMode: OrchestratorUxMode; hasVerificationIntent: boolean }) => {
  if (input.hasVerificationIntent) return { enabled: true, mode: "balanced" as const }
  if (input.uxMode === "deep") return { enabled: true, mode: "balanced" as const }
  return undefined
}

const resolveDualPass = (input: { a1?: A1Features; dualPassSynthesis: boolean }) => {
  if (!input.dualPassSynthesis) return undefined
  if (!input.a1?.dualPassCandidate) return undefined
  return {
    enabled: true,
    criticTimeoutMs: DualPassCriticTimeoutMs,
    unknownFirst: DualPassUnknownFirst,
  }
}

const resolveWorkers = (input: { orchestratorMode: OrchestratorMode }): PlanWorker[] => {
  if (input.orchestratorMode === "assist") {
    return [worker("retrieval_planner"), worker("evidence_critic")]
  }
  if (input.orchestratorMode === "heavy") {
    return [worker("retrieval_planner"), worker("patch_planner")]
  }
  return []
}

const budgetCap = (maxOutputTokens: number) => Math.max(512, Math.floor(maxOutputTokens / AdaptiveBudgetDivisor))

const adaptiveWorkers = (input: {
  sessionId: string
  uxMode: OrchestratorUxMode
  intentTokensEstimate: number
  workers: PlanWorker[]
  maxOutputTokens: number
}) => {
  if (input.workers.length === 0) {
    writeTrips({ sessionId: input.sessionId, trips: 0 })
    return { workers: input.workers, reasons: [] as PlanReason[] }
  }

  const high = input.uxMode === "deep" && input.intentTokensEstimate >= HeavyIntentTokens
  const scaled =
    high && input.workers.length === AdaptiveDefaultWorkers
      ? [...input.workers, worker("evidence_critic")]
      : input.workers
  const cap = budgetCap(input.maxOutputTokens)
  const load = input.intentTokensEstimate * Math.max(1, scaled.length)
  const over = load > cap
  const prevTrips = readTrips(input.sessionId)
  const trips = over ? prevTrips + 1 : 0
  writeTrips({ sessionId: input.sessionId, trips })
  const trip = trips >= AdaptiveBreakerTrips
  const cut = over ? (trip ? 2 : 1) : 0
  const count = Math.max(1, scaled.length - cut)
  const workers = scaled.slice(0, Math.min(count, AdaptiveMaxWorkers))

  const policy = (() => {
    if (scaled.length === AdaptiveMaxWorkers && !over) {
      return {
        code: "adaptive.ttc.scale_3",
        message: "deep high complexity and budget allow worker=3",
      }
    }
    if (scaled.length === AdaptiveMaxWorkers && over) {
      return {
        code: "adaptive.ttc.scale_blocked_budget",
        message: "deep high complexity triggered scale-up but budget gate blocked it",
      }
    }
    return {
      code: "adaptive.ttc.default_2",
      message: "default worker=2 policy kept",
    }
  })()

  const reasons = [
    policy,
    ...(over
      ? [
          {
            code: "adaptive.ttc.guard.budget",
            message: `budget guard active load=${load} cap=${cap}`,
          },
          {
            code: "adaptive.ttc.budget_overrun",
            message: `budget overrun load=${load} cap=${cap}`,
          },
        ]
      : []),
    ...(over && workers.length < scaled.length
      ? [
          {
            code: "adaptive.ttc.early_stop",
            message: "budget guard triggered early-stop on worker fanout",
          },
        ]
      : []),
    ...(over && scaled.length >= 3 && workers.length <= 2
      ? [
          {
            code: "adaptive.ttc.degrade_3_to_2",
            message: "budget gate degraded workers from 3 to 2",
          },
        ]
      : []),
    ...(over && scaled.length >= 2 && workers.length === 1
      ? [
          {
            code: "adaptive.ttc.degrade_2_to_1",
            message: "budget breaker degraded workers from 2 to 1",
          },
        ]
      : []),
    ...(trip
      ? [
          {
            code: "adaptive.ttc.breaker.active",
            message: `budget breaker active after ${trips} consecutive overruns`,
          },
          {
            code: "adaptive.ttc.breaker.trip",
            message: `budget breaker tripped after ${trips} consecutive overruns`,
          },
        ]
      : []),
    ...(!over && prevTrips > 0
      ? [
          {
            code: "adaptive.ttc.breaker.recover",
            message: "budget breaker recovered after returning inside budget",
          },
        ]
      : []),
  ]

  return { workers, reasons }
}

const resolveReasons = (input: {
  uxMode: OrchestratorUxMode
  hasWriteIntent: boolean
  hasExecIntent: boolean
  hasVerificationIntent: boolean
  intentTokensEstimate: number
}): PlanReason[] => {
  const primary =
    input.hasWriteIntent || input.hasExecIntent
      ? { code: "intent.write_exec", message: "write/exec intent detected" }
      : undefined
  const verification = input.hasVerificationIntent
    ? { code: "intent.verification", message: "verification intent detected" }
    : undefined
  const heavy =
    input.uxMode === "deep" && input.intentTokensEstimate >= HeavyIntentTokens
      ? { code: "ux.deep.high_complexity", message: "deep mode with high complexity intent" }
      : undefined

  const deep =
    input.uxMode === "deep" && input.intentTokensEstimate >= LargeIntentTokens
      ? { code: "ux.deep.large", message: "deep mode with large intent" }
      : undefined

  const reasons = [primary, heavy, verification, deep].filter(
    (item): item is PlanReason => !!item,
  )
  return reasons.length > 0
    ? reasons
    : [{ code: "intent.chat", message: "default chat intent" }]
}

const mergeReasons = (input: { reasons: PlanReason[]; adaptive: PlanReason[] }) => {
  const seen = new Set<string>()
  return [...input.reasons, ...input.adaptive].filter((item) => {
    if (seen.has(item.code)) return false
    seen.add(item.code)
    return true
  })
}

const workspaceFingerprint = () =>
  sha256Text(
    stableJson({
      specVersion: "workspace-fingerprint/1.0",
      projectId: Instance.project.id,
      worktree: Instance.worktree,
      directory: Instance.directory,
      vcs: Instance.project.vcs ?? "none",
    }),
  )

export const buildPlan = async (input: BuildInput): Promise<BuildResult> => {
  const feat = input.features.features
  const dualPassSynthesis = input.dualPassSynthesis === true
  const a1 =
    input.a1 ??
    ({
      highRisk: false,
      requiresCitation: false,
      dualPassCandidate: false,
    } satisfies A1Features)
  const wsFingerprint = workspaceFingerprint()
  const evidencePolicy = resolveEvidencePolicy({ uxMode: feat.uxMode, hasVerificationIntent: feat.hasVerificationIntent })
  const inputsFingerprint = sha256Text(
    stableJson({
      specVersion: "orchestrator-plan-inputs/1.0",
      sessionId: input.sessionId,
      messageId: input.messageId,
      workspaceFingerprint: wsFingerprint,
      toolsetFingerprint: input.toolsetFingerprint,
      uxMode: feat.uxMode,
      evidencePolicy: evidencePolicy ?? null,
      scores: input.scores ?? null,
      a1,
      dualPassSynthesis,
      versions: { stableJson: "v1" },
    }),
  )

  const scope = { projectId: Instance.project.id, worktreeRoot: baseDir() }
  const cacheKey = CacheStore.key({
    namespace: "orchestrator-plan",
    scope,
    input: {
      specVersion: "orchestrator-plan-cache-key/1.0",
      sessionId: input.sessionId,
      messageId: input.messageId,
      workspaceFingerprint: wsFingerprint,
      toolsetFingerprint: input.toolsetFingerprint,
      uxMode: feat.uxMode,
      evidencePolicy: evidencePolicy ?? null,
      scores: input.scores ?? null,
      a1,
      dualPassSynthesis,
    },
  })

  const store = CacheStore.open({ namespace: "orchestrator-plan", scope, limits: CachePolicy.limits() })
  const policy = CachePolicy.policy("orchestrator-plan")
  const cached = await store.getOrCompute({
    key: cacheKey,
    ttlMs: CachePolicy.ttlMs("orchestrator-plan"),
    policy: { enabled: policy.enabled, force: policy.force },
    compute: async () => {
      const orchestratorMode = resolveMode({
        uxMode: feat.uxMode,
        hasWriteIntent: feat.hasWriteIntent,
        hasExecIntent: feat.hasExecIntent,
        hasVerificationIntent: feat.hasVerificationIntent,
        intentTokensEstimate: feat.intentTokensEstimate,
        scores: input.scores,
      })

      const budgets = {
        maxWallClockMs: 8000,
        workerTimeoutMs: 1500,
        maxOutputTokens: 32000,
        maxToolCalls: 4,
      }

      const workers = resolveWorkers({ orchestratorMode })
      const adaptive = adaptiveWorkers({
        sessionId: input.sessionId,
        uxMode: feat.uxMode,
        intentTokensEstimate: feat.intentTokensEstimate,
        workers,
        maxOutputTokens: budgets.maxOutputTokens,
      })

      const toolPolicy = { allowed: ["retrieval"], bounceMax: 1 as const }
      const dualPass = resolveDualPass({ a1, dualPassSynthesis })
      const reasons = resolveReasons({
        uxMode: feat.uxMode,
        hasWriteIntent: feat.hasWriteIntent,
        hasExecIntent: feat.hasExecIntent,
        hasVerificationIntent: feat.hasVerificationIntent,
        intentTokensEstimate: feat.intentTokensEstimate,
      })
      const allReasons = mergeReasons({
        reasons: [
          ...reasons,
          ...(dualPass
            ? [
                {
                  code: "a1.dual_pass.default_on",
                  message: "A1 dual-pass candidate enabled by synthesis gate",
                },
              ]
            : []),
        ],
        adaptive: adaptive.reasons,
      })

      return OrchestratorPlan.parse({
        specVersion: "orchestrator-plan/1.0",
        orchestratorPlanId: ulid(),
        sessionId: input.sessionId,
        messageId: input.messageId,
        orchestratorMode,
        uxMode: feat.uxMode,
        workers: adaptive.workers,
        budgets,
        evidencePolicy,
        toolPolicy,
        dualPass,
        scores: input.scores,
        reasons: allReasons,
        inputsFingerprint: { sha256: inputsFingerprint },
      })
    },
  })

  return {
    plan: cached.value,
    cache: {
      status: cached.status,
      tier: cached.tier,
      key: cacheKey,
      scope,
      namespace: "orchestrator-plan",
    },
  }
}
