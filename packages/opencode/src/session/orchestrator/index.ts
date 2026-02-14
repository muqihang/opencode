import type { Tool } from "ai"
import path from "path"
import { Instance } from "@/project/instance"
import { EvidenceWriter } from "@/evidence/writer"
import { LlmWorkerRolePack } from "@/protocol/llm-worker-role-pack"
import { LlmWorkerResult, criticVerdictV2FromV1 } from "@/protocol/llm-worker-result"
import { OrchestratorPlan } from "@/protocol/orchestrator-plan"
import { OrchestratorFeatures } from "@/protocol/orchestrator-features"
import { WorkerRunner } from "./worker-runner"
import { isPlannerWorker, type WorkerModel } from "./worker-spec"
import { runDualPass } from "./dual-pass"
import { runToolBroker } from "./tool-broker"
import { normalizeOrchestratorDegraded } from "./degraded-taxonomy"
import { stableJson } from "@/util/stable-json"
import { artifactSessionPrefix, isA2TenantNamespaceEnabled, resolveTenantScope } from "@/util/tenant-context"
import { buildClaimsSeed, parseClaimsSeedPointers } from "../secure-output-contract"

type TurnInput = {
  sessionId: string
  messageId: string
  abort: AbortSignal
  plan: OrchestratorPlan
  features: OrchestratorFeatures
  intentText: string
  system: string[]
  tools: Record<string, Tool>
  workingSetPointers?: string[]
  model?: WorkerModel
}

type TurnResult = {
  system: string[]
  tools: Record<string, Tool>
  degraded: boolean
}

type ToolGateInput = {
  tools: Record<string, Tool>
  mainTools?: OrchestratorPlan["mainTools"]
}

type WorkerRun = Awaited<ReturnType<typeof WorkerRunner.run>>

type WorkerEntry = { workerId: string; run: WorkerRun }

type BrokerOutput = Awaited<ReturnType<typeof runToolBroker>>

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

const writeOrchestratorDegraded = async (input: {
  sessionId: string
  messageId: string
  stage: string
  reason: string
}) => {
  const taxonomy = normalizeOrchestratorDegraded({
    stage: input.stage,
    reason: input.reason,
  })
  const writer = await EvidenceWriter.open({ sessionId: input.sessionId }).catch(() => undefined)
  if (!writer) return
  await writer
    .event({
      specVersion: "event/1.0",
      ts: new Date().toISOString(),
      sessionId: input.sessionId,
      severity: "warn",
      actor: "orchestrator:runner",
      type: "orchestrator.degraded",
      summary: "orchestrator degraded",
      data: {
        messageId: input.messageId,
        stage: input.stage,
        reason: input.reason,
        ...taxonomy,
      },
      redaction: { applied: true, policyVersion: "v1" },
    })
    .catch(() => {})
}

const writeOrchestratorIdempotent = async (input: {
  sessionId: string
  messageId: string
  planId: string
  idempotencyKey: string
  fallbackPath: string
}) => {
  const writer = await EvidenceWriter.open({ sessionId: input.sessionId }).catch(() => undefined)
  if (!writer) return
  await writer
    .event({
      specVersion: "event/1.0",
      ts: new Date().toISOString(),
      sessionId: input.sessionId,
      severity: "info",
      actor: "orchestrator:runner",
      type: "orchestrator.idempotent",
      summary: "orchestrator turn cache replay",
      data: {
        messageId: input.messageId,
        planId: input.planId,
        idempotencyKey: input.idempotencyKey,
        decision: "reuse_cached_turn",
        fallbackPath: input.fallbackPath,
      },
      redaction: { applied: true, policyVersion: "v1" },
    })
    .catch(() => {})
}

const planPointerPath = (input: { sessionId: string; planId: string }) => {
  const scope = resolveTenantScope()
  const prefix = artifactSessionPrefix({
    sessionId: input.sessionId,
    tenantId: scope.tenantId,
    orgId: scope.orgId,
    namespaced: isA2TenantNamespaceEnabled(),
  })
  return `${prefix}orchestrator/${input.planId}/orchestrator.plan.json`
}

const toPlanPointer = (input: { sessionId: string; plan: OrchestratorPlan; intentText: string }) => {
  const pointer = planPointerPath({
    sessionId: input.sessionId,
    planId: input.plan.orchestratorPlanId,
  })
  const intent = input.intentText.trim()
  const maxIntent = 400
  const clippedIntent = intent.length > maxIntent ? `${intent.slice(0, maxIntent)}...` : intent
  const meta = stableJson({
    mode: input.plan.orchestratorMode,
    workers: input.plan.workers.map((item) => item.id),
    evidence: input.plan.evidencePolicy?.mode ?? "off",
    toolPolicy: input.plan.toolPolicy,
    reasons: input.plan.reasons.map((item) => item.code).slice(0, 8),
  })
  const maxMeta = 900
  const clippedMeta = meta.length > maxMeta ? `${meta.slice(0, maxMeta)}...` : meta
  const lines = [pointer]
  if (clippedIntent) {
    lines.push("", `intent:${clippedIntent}`)
  }
  lines.push("", `plan_meta:${clippedMeta}`)
  return lines.join("\n")
}

const toWorkingSetPointers = (input?: string[]) => {
  if (!input) return []
  const seen = new Set<string>()
  const list = input.filter((item) => {
    const value = item.trim()
    if (!value) return false
    if (seen.has(value)) return false
    seen.add(value)
    return true
  })
  if (list.length <= 12) return list
  return list.slice(0, 12)
}

const buildRolePack = (input: {
  sessionId: string
  plan: OrchestratorPlan
  intentText: string
  workingSetPointers: string[]
}) => {
  const policy = {
    mode: input.plan.evidencePolicy?.mode ?? "balanced",
    unknown: "deny",
  }
  const budget = {
    timeoutMs: input.plan.budgets.workerTimeoutMs,
    maxOutputTokens: input.plan.budgets.maxOutputTokens,
    maxToolCalls: input.plan.budgets.maxToolCalls,
  }
  const rolePack = LlmWorkerRolePack.parse({
    specVersion: "llm-worker-role-pack/1.0",
    planPointer: toPlanPointer({
      sessionId: input.sessionId,
      plan: input.plan,
      intentText: input.intentText,
    }),
    policy,
    budget,
    workingSet: {
      pointers: toWorkingSetPointers(input.workingSetPointers),
    },
  })
  return rolePack
}

const criticReason = (input: { workerResults: LlmWorkerResult[] }) => {
  const nonOk = input.workerResults.find((result) => result.status !== "ok")
  if (!nonOk) return
  return `worker status ${nonOk.status}`
}

const runInjectionDualPass = async (input: {
  sessionId: string
  messageId: string
  plan: OrchestratorPlan
  injected: string
  workerResults: LlmWorkerResult[]
  plannerDegraded: boolean
}) => {
  const policy = input.plan.dualPass
  if (!policy?.enabled) return { text: input.injected, degraded: false }

  const final = await runDualPass({
    draft: async () => input.injected,
    critic: async ({ draft }) => {
      const reason = criticReason({ workerResults: input.workerResults })
      if (reason) {
        const fallback = input.plannerDegraded ? "unknown-first" : "draft"
        return {
          specVersion: "dual-pass/1.0",
          stage: "critic",
          verdict: "degrade",
          reason,
          fallback,
        }
      }
      return {
        specVersion: "dual-pass/1.0",
        stage: "critic",
        verdict: "accept",
        text: draft.text,
      }
    },
    timeoutMs: policy.criticTimeoutMs,
    unknownFirst: policy.unknownFirst,
  })

  if (final.stage === "final") return { text: final.text, degraded: false }

  await writeOrchestratorDegraded({
    sessionId: input.sessionId,
    messageId: input.messageId,
    stage: "dual_pass",
    reason: `fallback=${final.degrade.fallback}; ${final.degrade.reason}`,
  })
  return { text: final.text, degraded: true }
}

const renderInjection = (input: {
  plan: OrchestratorPlan
  workerResults: LlmWorkerResult[]
  criticResult?: LlmWorkerResult
  brokerSummary?: string[]
  pointers?: Array<{ path: string; sha256: string; anchor?: Record<string, number> }>
}) => {
  const budget = 900
  const minEvidence = 3
  const maxNoteChars = 320
  const blocked = ["from_model=", "to_model=", "gate_reason="]
  const normalize = (value: string) => value.replace(/\s+/g, " ").trim()
  const summary = (value: string) => {
    const clean = value.replace(/\\/g, "/")
    const file = clean.split("/").at(-1) ?? clean
    if (clean.includes("/snippets/")) return `snippet evidence from ${file}`
    if (clean.includes("/hits/")) return `hit evidence from ${file}`
    return `artifact evidence from ${file}`
  }
  const density = (value: string) => {
    if (value.includes("/snippets/")) return 2
    if (value.includes("/hits/")) return 1
    return 0
  }
  const anchor = (value?: Record<string, number>) => stableJson(value ?? {})
  const fallback = Array.from({ length: minEvidence }, (_, index) => ({
    path: `orchestrator/fallback/${index + 1}`,
    sha256: "unknown",
    anchor: undefined,
    summary: "evidence pointer unavailable",
    density: 0,
  }))
  const evidenceBase = (input.pointers ?? []).map((item) => ({
    path: item.path,
    sha256: item.sha256,
    anchor: item.anchor,
    summary: summary(item.path),
    density: density(item.path),
  }))
  const evidence = (() => {
    if (evidenceBase.length >= minEvidence) return evidenceBase
    if (evidenceBase.length === 0) return fallback
    const extra = fallback.slice(0, minEvidence - evidenceBase.length)
    return [...evidenceBase, ...extra]
  })().sort((left, right) => right.density - left.density)

  const critic = input.criticResult ?? input.workerResults.find((item) => item.status !== "ok") ?? input.workerResults[0]
  const verdict = critic
    ? criticVerdictV2FromV1(critic)
    : criticVerdictV2FromV1(
        LlmWorkerResult.parse({
          specVersion: "llm-worker-result/1.0",
          status: "degraded",
          notes: ["critic result missing"],
        }),
      )
  const verdictJson = stableJson(verdict)

  const workerNotes = input.workerResults
    .flatMap((item) => item.notes ?? [])
    .map(normalize)
    .filter((item) => item.length > 0)
    .filter((item) => item.length <= maxNoteChars)
    .filter((item) => blocked.every((token) => !item.includes(token)))
  const notes = [...(input.brokerSummary ?? []), ...workerNotes]

  const missing =
    verdict.missing.length > 0
      ? verdict.missing.map((item) => `- ${item.requirementId}: ${normalize(item.reason)}`)
      : ["- none"]
  const instruction = [
    "- fact claims MUST map to evidence ids",
    "- claim object MUST use text (NOT statement) and include id",
    "- pointer.anchor MUST be JSON object; never string like lineStart:9,lineEnd:10",
    "- root claims JSON MUST include policyVersion",
    "- if verdict=insufficient, answer with unknown-first",
  ]

  const render = (state: { evidence: typeof evidence; notes: string[] }) => {
    const digest = state.evidence.map(
      (item, index) =>
        `- [E${index + 1}] path=${item.path} sha=${item.sha256} anchor_json=${anchor(item.anchor)} summary=${item.summary}`,
    )
    const lines = [
      "<orchestrator_evidence_v2>",
      `mode: ${input.plan.orchestratorMode}`,
      `verdict_json: ${verdictJson}`,
      "evidence_digest:",
      ...digest,
      "missing_digest:",
      ...missing,
      "instruction_to_main_brain:",
      ...instruction,
      ...(state.notes.length > 0 ? ["notes:", ...state.notes.map((item) => `- ${item}`)] : []),
      "</orchestrator_evidence_v2>",
    ]
    return lines.join("\n")
  }

  const tokens = (value: string) => Math.ceil(value.length / 4)
  const trimNotes = (state: { evidence: typeof evidence; notes: string[] }): string[] => {
    const text = render(state)
    if (tokens(text) <= budget) return state.notes
    if (state.notes.length === 0) return state.notes
    return trimNotes({
      evidence: state.evidence,
      notes: state.notes.slice(0, state.notes.length - 1),
    })
  }

  const trimEvidence = (state: { evidence: typeof evidence; notes: string[] }): typeof evidence => {
    const text = render(state)
    if (tokens(text) <= budget) return state.evidence
    if (state.evidence.length <= minEvidence) return state.evidence
    return trimEvidence({
      evidence: state.evidence.slice(0, state.evidence.length - 1),
      notes: state.notes,
    })
  }

  const trimmedNotes = trimNotes({ evidence, notes })
  const trimmedEvidence = trimEvidence({ evidence, notes: trimmedNotes })
  return render({ evidence: trimmedEvidence, notes: trimmedNotes })
}

const summarizeBroker = (input: { results: BrokerOutput["results"] }) => {
  const total = input.results.reduce((acc, item) => acc + (item.summary?.total ?? 0), 0)
  const code = input.results.reduce((acc, item) => acc + (item.summary?.code ?? 0), 0)
  const workbench = input.results.reduce((acc, item) => acc + (item.summary?.workbench ?? 0), 0)
  return [`broker: total=${total} code=${code} workbench=${workbench}`]
}

const PointerPreviewChars = 1200

const toAbsolute = (input: string) => (path.isAbsolute(input) ? input : path.join(Instance.directory, input))

const readPreview = async (input: string) => {
  if (!input) return ""
  return Bun.file(toAbsolute(input))
    .text()
    .then((value) => value.replace(/\s+/g, " ").trim().slice(0, PointerPreviewChars))
    .catch(() => "")
}

const readHits = async (input: string) => {
  if (!input) return []
  return Bun.file(toAbsolute(input))
    .json()
    .then((value) => (Array.isArray(value) ? value : []))
    .catch(() => [])
}

const withPreview = async (input: string) => {
  const text = await readPreview(input)
  if (!text) return input
  return `${input}
${text}`
}

const extractPointers = (input: BrokerOutput | undefined) => {
  if (!input) return []
  const seen = new Set<string>()
  return input.results
    .flatMap((result) => result.pointers?.topK ?? [])
    .filter((ptr) => {
      const key = `${ptr.path}:${ptr.sha256}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

const extractWorkingSetPointers = async (input: BrokerOutput | undefined) => {
  if (!input) return []

  const top = input.results
    .flatMap((result) => result.pointers?.topK ?? [])
    .filter((item) => typeof item.path === "string")
    .map((item) => item.path)
    .slice(0, 8)

  const snippetPreview = await Promise.all(
    top
      .filter((item) => item.includes("/snippets/"))
      .slice(0, 8)
      .map(withPreview),
  )

  const hitFiles = input.results
    .flatMap((result) => result.pointers?.artifacts ?? [])
    .filter((artifact) => artifact.kind === "retrieval-hits" && typeof artifact.path === "string")
    .map((artifact) => artifact.path)

  const hitRows = await Promise.all(hitFiles.map(readHits))
  const origins = hitRows
    .flatMap((rows) => rows)
    .map((item) => (typeof item?.origin?.path === "string" ? item.origin.path : ""))
    .filter((item) => item.length > 0)
    .slice(0, 8)

  const originPreview = await Promise.all(origins.map(withPreview))

  const artifacts = input.results
    .flatMap((result) => result.pointers?.artifacts ?? [])
    .filter((item) => typeof item.path === "string")
    .map((item) => item.path)
    .slice(0, 8)

  return toWorkingSetPointers([...snippetPreview, ...originPreview, ...top, ...artifacts])
}

const collectClaimsSeedPointers = (input: {
  broker?: BrokerOutput
  workingSetPointers?: string[]
}) => {
  const fromBroker = extractPointers(input.broker)
  const fromWorkingSet = parseClaimsSeedPointers(input.workingSetPointers ?? [])
  const seen = new Set<string>()
  return [...fromBroker, ...fromWorkingSet]
    .filter((item) => item.path.length > 0 && item.sha256.length > 0)
    .filter((item) => {
      const key = `${item.path}:${item.sha256}:${stableJson(item.anchor ?? {})}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 6)
}

const rerunCriticWithPointers = async (input: {
  sessionId: string
  messageId: string
  plan: OrchestratorPlan
  intentText: string
  model?: WorkerModel
  runs: WorkerEntry[]
  broker?: BrokerOutput
  workingSetPointers?: string[]
}) => {
  const critic = input.runs.find((item) => item.workerId === "evidence_critic")
  if (!critic) return input.runs
  if (critic.run.result.status === "ok") return input.runs
  if (input.workingSetPointers !== undefined) return input.runs

  const pointers = await extractWorkingSetPointers(input.broker)
  if (pointers.length === 0) return input.runs

  const planPath = planPointerPath({
    sessionId: input.sessionId,
    planId: input.plan.orchestratorPlanId,
  })
  const planPreview = await withPreview(planPath)

  const rolePack = buildRolePack({
    sessionId: input.sessionId,
    plan: input.plan,
    intentText: input.intentText,
    workingSetPointers: [...(input.workingSetPointers ?? []), planPreview, ...pointers],
  })

  const rerun = await WorkerRunner.run({
    sessionId: input.sessionId,
    messageId: input.messageId,
    workerId: "evidence_critic",
    rolePack,
    model: input.model,
  })

  return input.runs.map((item) => (item.workerId === "evidence_critic" ? { workerId: item.workerId, run: rerun } : item))
}

const TurnCacheLimit = 256

const turnCache = new Map<string, TurnResult>()

const turnCacheKey = (input: TurnInput) =>
  `${input.sessionId}:${input.messageId}:${input.plan.orchestratorPlanId}`

const rememberTurn = (input: { key: string; result: TurnResult }) => {
  turnCache.set(input.key, input.result)
  if (turnCache.size <= TurnCacheLimit) return
  const first = turnCache.keys().next().value
  if (!first) return
  turnCache.delete(first)
}

export const applyMainTools = (input: ToolGateInput): Record<string, Tool> => {
  if (input.mainTools === undefined || input.mainTools === null) return input.tools
  if (input.mainTools.length === 0) return {}
  const allowed = new Set(input.mainTools)
  const entries = Object.entries(input.tools).filter(([name]) => allowed.has(name))
  return Object.fromEntries(entries)
}

export const runOrchestratorTurn = async (input: TurnInput): Promise<TurnResult> => {
  const gatedTools = applyMainTools({ tools: input.tools, mainTools: input.plan.mainTools })
  const shouldRun = input.plan.orchestratorMode === "assist" || input.plan.orchestratorMode === "heavy"
  if (!shouldRun) {
    return { system: input.system, tools: gatedTools, degraded: false }
  }

  const cacheKey = turnCacheKey(input)
  const cached = turnCache.get(cacheKey)
  if (cached) {
    await writeOrchestratorIdempotent({
      sessionId: input.sessionId,
      messageId: input.messageId,
      planId: input.plan.orchestratorPlanId,
      idempotencyKey: cacheKey,
      fallbackPath: "cache-hit -> dual_pass.unknown-first",
    })
    return cached
  }

  const task = async () => {
    const basePointers = input.workingSetPointers
    const rolePack = buildRolePack({
      sessionId: input.sessionId,
      plan: input.plan,
      intentText: input.intentText,
      workingSetPointers: basePointers ?? [],
    })
    const workers = input.plan.workers
    const runs = await Promise.all(
      workers.map((worker) =>
        WorkerRunner.run({
          sessionId: input.sessionId,
          messageId: input.messageId,
          workerId: worker.id,
          rolePack,
          model: input.model,
        }).then((run) => ({ workerId: worker.id, run })),
      ),
    )
    const plannerDegraded = runs.some((item) => isPlannerWorker(item.workerId) && item.run.result.status !== "ok")
    const hasCritic = runs.some((item) => item.workerId === "evidence_critic")
    const criticRun = plannerDegraded && !hasCritic
      ? await WorkerRunner.run({
          sessionId: input.sessionId,
          messageId: input.messageId,
          workerId: "evidence_critic",
          rolePack,
          model: input.model,
        })
      : undefined
    const allRuns = criticRun ? [...runs, { workerId: "evidence_critic", run: criticRun }] : runs
    const preResults = allRuns.map((item) => item.run.result)
    const toolRequests = preResults.flatMap((result) => result.toolRequests ?? [])
    const broker = toolRequests.length
      ? await runToolBroker({
          sessionId: input.sessionId,
          messageId: input.messageId,
          toolRequests,
          toolPolicy: input.plan.toolPolicy,
          cycle: 1,
          abort: input.abort,
        })
      : undefined

    const finalizedRuns = await rerunCriticWithPointers({
      sessionId: input.sessionId,
      messageId: input.messageId,
      plan: input.plan,
      intentText: input.intentText,
      model: input.model,
      runs: allRuns,
      broker,
      workingSetPointers: basePointers,
    })
    const workerResults = finalizedRuns.map((item) => item.run.result)
    const strictClaims = input.features.features.hasVerificationIntent === true
    const claimsSeed = buildClaimsSeed({
      strict: strictClaims,
      pointers: collectClaimsSeedPointers({
        broker,
        workingSetPointers: basePointers,
      }),
    })
    const seedBlock = claimsSeed ? [claimsSeed] : []

    const injected = renderInjection({
      plan: input.plan,
      workerResults,
      criticResult: finalizedRuns.find((item) => item.workerId === "evidence_critic")?.run.result,
      brokerSummary: broker ? summarizeBroker({ results: broker.results }) : undefined,
      pointers: extractPointers(broker),
    })

    const dualPass = await runInjectionDualPass({
      sessionId: input.sessionId,
      messageId: input.messageId,
      plan: input.plan,
      injected,
      workerResults,
      plannerDegraded,
    })

    if (plannerDegraded && !dualPass.degraded) {
      await writeOrchestratorDegraded({
        sessionId: input.sessionId,
        messageId: input.messageId,
        stage: "planner",
        reason: "planner_degraded_fallback",
      })
      return {
        system: [...input.system, ...seedBlock, input.plan.dualPass?.unknownFirst ?? "unknown-first"],
        tools: gatedTools,
        degraded: true,
      }
    }

    return {
      system: [...input.system, dualPass.text, ...seedBlock],
      tools: gatedTools,
      degraded: dualPass.degraded,
    }
  }

  const result = await task().catch(async (error) => {
    await writeOrchestratorDegraded({
      sessionId: input.sessionId,
      messageId: input.messageId,
      stage: "turn",
      reason: errorText(error),
    })
    return {
      system: input.system,
      tools: gatedTools,
      degraded: true,
    }
  })
  rememberTurn({ key: cacheKey, result })
  return result
}

export type { TurnInput, TurnResult }
