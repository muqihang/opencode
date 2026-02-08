import type { Tool } from "ai"
import { EvidenceWriter } from "@/evidence/writer"
import { LlmWorkerRolePack } from "@/protocol/llm-worker-role-pack"
import { LlmWorkerResult } from "@/protocol/llm-worker-result"
import { OrchestratorPlan } from "@/protocol/orchestrator-plan"
import { OrchestratorFeatures } from "@/protocol/orchestrator-features"
import { WorkerRunner } from "./worker-runner"
import { isPlannerWorker } from "./worker-spec"
import { runDualPass } from "./dual-pass"
import { runToolBroker } from "./tool-broker"

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

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

const writeOrchestratorDegraded = async (input: {
  sessionId: string
  messageId: string
  stage: string
  reason: string
}) => {
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
      },
      redaction: { applied: true, policyVersion: "v1" },
    })
    .catch(() => {})
}

const toPlanPointer = (input: { sessionId: string; plan: OrchestratorPlan; intentText: string }) => {
  const base = [".opencode", "artifacts", input.sessionId, "orchestrator", input.plan.orchestratorPlanId].join("/")
  const pointer = `${base}/orchestrator.plan.json`
  const intent = input.intentText.trim()
  if (!intent) return pointer
  const max = 400
  const clipped = intent.length > max ? `${intent.slice(0, max)}...` : intent
  return `${pointer}\n\nintent:${clipped}`
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
  brokerSummary?: string[]
  pointers?: string[]
}) => {
  const notes = input.workerResults.flatMap((result) => result.notes ?? []).slice(0, 2)
  const pointerLines = (input.pointers ?? []).slice(0, 3)
  const brokerLines = input.brokerSummary ?? []

  const lines = [
    "<orchestrator>",
    `mode: ${input.plan.orchestratorMode}`,
    ...brokerLines,
    ...(notes.length > 0 ? ["notes:", ...notes.map((note) => `- ${note}`)] : []),
    ...(pointerLines.length > 0 ? ["pointers:", ...pointerLines.map((ptr) => `- ${ptr}`)] : []),
    "</orchestrator>",
  ]
  return lines.join("\n")
}

const summarizeBroker = (input: { results: Awaited<ReturnType<typeof runToolBroker>>["results"] }) => {
  const total = input.results.reduce((acc, item) => acc + (item.summary?.total ?? 0), 0)
  const code = input.results.reduce((acc, item) => acc + (item.summary?.code ?? 0), 0)
  const workbench = input.results.reduce((acc, item) => acc + (item.summary?.workbench ?? 0), 0)
  return [`broker: total=${total} code=${code} workbench=${workbench}`]
}

const extractPointers = (input: Awaited<ReturnType<typeof runToolBroker>> | undefined) => {
  if (!input) return []
  const pointers = input.results.flatMap((result) => result.pointers?.topK ?? [])
  return pointers.map((ptr) => `${ptr.path}`)
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

  const task = async () => {
    const rolePack = buildRolePack({
      sessionId: input.sessionId,
      plan: input.plan,
      intentText: input.intentText,
      workingSetPointers: input.workingSetPointers ?? [],
    })
    const workers = input.plan.workers
    const runs = await Promise.all(
      workers.map((worker) =>
        WorkerRunner.run({
          sessionId: input.sessionId,
          messageId: input.messageId,
          workerId: worker.id,
          rolePack,
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
        })
      : undefined
    const allRuns = criticRun ? [...runs, { workerId: "evidence_critic", run: criticRun }] : runs
    const workerResults = allRuns.map((item) => item.run.result)
    const toolRequests = workerResults.flatMap((result) => result.toolRequests ?? [])
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

    const injected = renderInjection({
      plan: input.plan,
      workerResults,
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
        system: [...input.system, input.plan.dualPass?.unknownFirst ?? "unknown-first"],
        tools: gatedTools,
        degraded: true,
      }
    }

    return {
      system: [...input.system, dualPass.text],
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
  return result
}

export type { TurnInput, TurnResult }
