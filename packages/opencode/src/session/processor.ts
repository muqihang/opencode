import { MessageV2 } from "./message-v2"
import type { Tool } from "ai"
import { Log } from "@/util/log"
import { Identifier } from "@/id/id"
import { Session } from "."
import { Agent } from "@/agent/agent"
import { Snapshot } from "@/snapshot"
import { EvidenceWriter } from "@/evidence/writer"
import { SessionSummary } from "./summary"
import { runSecureOutput } from "@/secure-output"
import { Bus } from "@/bus"
import { SessionRetry } from "./retry"
import { SessionStatus } from "./status"
import { Plugin } from "@/plugin"
import type { Provider } from "@/provider/provider"
import { LLM } from "./llm"
import { Config } from "@/config/config"
import { SessionCompaction } from "./compaction"
import { PermissionNext } from "@/permission/next"
import { Question } from "@/question"
import { Flag } from "@/flag/flag"
import { writeUsageEvents } from "@/usage/events"
import { prepareOrchestratorPlan } from "./orchestrator/prepare"
import { runOrchestratorTurn } from "./orchestrator"
import { renderForkNotice, runForkTask } from "./orchestrator/fork"
import { resolveForkStrategy, resolveSecureOutputMode } from "./orchestrator/policy"
import type { OrchestratorMode } from "@/protocol/orchestrator-plan"
import { resolveHybridRoutingPolicy } from "./hybrid-routing-policy"

export type OrchestratorRollout = {
  enabled: boolean
  llmWorkers: boolean
  workerBadge: boolean
  shadowMode: boolean
  v15B1: boolean
  adaptiveTTC: boolean
  v15B2?: boolean
  pointerContextOS?: boolean
  v15A1?: boolean
  claimGraphGate?: boolean
  dualPassSynthesis?: boolean
  v16Observability?: boolean
  v16LLMWorkers?: boolean
  v16Scorer?: boolean
  v16DeepseekThinking?: boolean
  v16CacheAwarePrompt?: boolean
}

type OrchestratorRolloutFlags = {
  orchestrator: boolean
  llmWorkers: boolean
  workerBadge: boolean
  shadowMode: boolean
  orchestratorV15B1: boolean
  adaptiveTTC: boolean
  orchestratorV15B2: boolean
  pointerContextOS: boolean
  orchestratorV15A1: boolean
  claimGraphGate: boolean
  dualPassSynthesis: boolean
  orchestratorV16Observability: boolean
  orchestratorV16LLMWorkers: boolean
  orchestratorV16Scorer: boolean
  orchestratorV16DeepseekThinking: boolean
  orchestratorV16CacheAwarePrompt: boolean
}

export type OrchestratorRunGate = {
  v15B1: boolean
  adaptiveTTC: boolean
  v15B2?: boolean
  pointerContextOS?: boolean
  v15A1?: boolean
  claimGraphGate?: boolean
  dualPassSynthesis?: boolean
  v16Observability?: boolean
  v16LLMWorkers?: boolean
  v16Scorer?: boolean
  v16DeepseekThinking?: boolean
  v16CacheAwarePrompt?: boolean
}

type OrchestratorTurnShape = {
  system: string[]
  tools: Record<string, Tool>
  degraded: boolean
  retrievalMain?: {
    enabled: boolean
    coversRetrieval?: boolean
    mode: OrchestratorMode
  }
}

const withV16Rollout = <T extends object>(input: {
  base: T
  include: boolean
  enabled: boolean
  llmWorkers: boolean
  observability: boolean
  v16LLMWorkers: boolean
  scorer: boolean
  deepseekThinking: boolean
  cacheAwarePrompt: boolean
}) => {
  if (!input.include) return input.base

  const v16Observability = input.enabled && input.observability
  const v16LLMWorkers = v16Observability && input.llmWorkers && input.v16LLMWorkers
  const v16Scorer = v16LLMWorkers && input.scorer
  const v16DeepseekThinking = v16Scorer && input.deepseekThinking
  const v16CacheAwarePrompt = v16DeepseekThinking && input.cacheAwarePrompt

  return {
    ...input.base,
    v16Observability,
    v16LLMWorkers,
    v16Scorer,
    v16DeepseekThinking,
    v16CacheAwarePrompt,
  }
}

export const resolveOrchestratorRollout = (
  config?: Config.Info,
  flags?: Partial<OrchestratorRolloutFlags>,
): OrchestratorRollout => {
  const resolved = {
    orchestrator: Flag.OPENCODE_EXPERIMENTAL_ORCHESTRATOR === true,
    llmWorkers: Flag.OPENCODE_EXPERIMENTAL_ORCHESTRATOR_LLM_WORKERS === true,
    workerBadge: Flag.OPENCODE_EXPERIMENTAL_ORCHESTRATOR_WORKER_BADGE === true,
    shadowMode: Flag.OPENCODE_EXPERIMENTAL_ORCHESTRATOR_SHADOW_MODE === true,
    orchestratorV15B1: Flag.OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V15_B1 === true,
    adaptiveTTC: Flag.OPENCODE_EXPERIMENTAL_ADAPTIVE_TTC === true,
    orchestratorV15B2: Flag.OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V15_B2 === true,
    pointerContextOS: Flag.OPENCODE_EXPERIMENTAL_POINTER_CONTEXT_OS === true,
    orchestratorV15A1: Flag.OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V15_A1 === true,
    claimGraphGate: Flag.OPENCODE_EXPERIMENTAL_CLAIM_GRAPH_GATE === true,
    dualPassSynthesis: Flag.OPENCODE_EXPERIMENTAL_DUAL_PASS_SYNTHESIS === true,
    orchestratorV16Observability: Flag.OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V16_OBSERVABILITY === true,
    orchestratorV16LLMWorkers: Flag.OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V16_LLM_WORKERS === true,
    orchestratorV16Scorer: Flag.OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V16_SCORER === true,
    orchestratorV16DeepseekThinking: Flag.OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V16_DEEPSEEK_THINKING === true,
    orchestratorV16CacheAwarePrompt: Flag.OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V16_CACHE_AWARE_PROMPT === true,
    ...flags,
  }

  const b2 =
    flags?.orchestratorV15B2 !== undefined ||
    flags?.pointerContextOS !== undefined ||
    config?.experimental?.orchestrator_v15_b2 !== undefined ||
    config?.experimental?.pointer_context_os !== undefined ||
    resolved.orchestratorV15B2 === true ||
    resolved.pointerContextOS === true
  const a1 =
    flags?.orchestratorV15A1 !== undefined ||
    flags?.claimGraphGate !== undefined ||
    flags?.dualPassSynthesis !== undefined ||
    resolved.orchestratorV15A1 === true ||
    resolved.claimGraphGate === true ||
    resolved.dualPassSynthesis === true
  const v16 =
    flags?.orchestratorV16Observability !== undefined ||
    flags?.orchestratorV16LLMWorkers !== undefined ||
    flags?.orchestratorV16Scorer !== undefined ||
    flags?.orchestratorV16DeepseekThinking !== undefined ||
    flags?.orchestratorV16CacheAwarePrompt !== undefined ||
    config?.experimental?.orchestrator_v16_observability !== undefined ||
    config?.experimental?.orchestrator_v16_llm_workers !== undefined ||
    config?.experimental?.orchestrator_v16_scorer !== undefined ||
    config?.experimental?.orchestrator_v16_deepseek_thinking !== undefined ||
    config?.experimental?.orchestrator_v16_cache_aware_prompt !== undefined ||
    resolved.orchestratorV16Observability === true ||
    resolved.orchestratorV16LLMWorkers === true ||
    resolved.orchestratorV16Scorer === true ||
    resolved.orchestratorV16DeepseekThinking === true ||
    resolved.orchestratorV16CacheAwarePrompt === true

  const v16Observability = config?.experimental?.orchestrator_v16_observability ?? resolved.orchestratorV16Observability
  const v16LLMWorkers = config?.experimental?.orchestrator_v16_llm_workers ?? resolved.orchestratorV16LLMWorkers
  const v16Scorer = config?.experimental?.orchestrator_v16_scorer ?? resolved.orchestratorV16Scorer
  const v16DeepseekThinking =
    config?.experimental?.orchestrator_v16_deepseek_thinking ?? resolved.orchestratorV16DeepseekThinking
  const v16CacheAwarePrompt =
    config?.experimental?.orchestrator_v16_cache_aware_prompt ?? resolved.orchestratorV16CacheAwarePrompt

  const enabled = (config?.experimental?.orchestrator ?? resolved.orchestrator) === true
  if (!enabled) {
    const base = {
      enabled: false,
      llmWorkers: false,
      workerBadge: false,
      shadowMode: false,
      v15B1: false,
      adaptiveTTC: false,
    }
    if (!b2) {
      return withV16Rollout({
        base,
        include: v16,
        enabled: false,
        llmWorkers: false,
        observability: v16Observability,
        v16LLMWorkers,
        scorer: v16Scorer,
        deepseekThinking: v16DeepseekThinking,
        cacheAwarePrompt: v16CacheAwarePrompt,
      })
    }

    const b2Base = {
      ...base,
      v15B2: false,
      pointerContextOS: false,
    }
    if (!a1) {
      return withV16Rollout({
        base: b2Base,
        include: v16,
        enabled: false,
        llmWorkers: false,
        observability: v16Observability,
        v16LLMWorkers,
        scorer: v16Scorer,
        deepseekThinking: v16DeepseekThinking,
        cacheAwarePrompt: v16CacheAwarePrompt,
      })
    }

    return withV16Rollout({
      base: {
        ...b2Base,
        v15A1: false,
        claimGraphGate: false,
        dualPassSynthesis: false,
      },
      include: v16,
      enabled: false,
      llmWorkers: false,
      observability: v16Observability,
      v16LLMWorkers,
      scorer: v16Scorer,
      deepseekThinking: v16DeepseekThinking,
      cacheAwarePrompt: v16CacheAwarePrompt,
    })
  }

  const llmWorkers = config?.experimental?.orchestrator_llm_workers ?? resolved.llmWorkers
  const workerBadge = config?.experimental?.orchestrator_worker_badge ?? resolved.workerBadge
  const shadowMode = config?.experimental?.orchestrator_shadow_mode ?? resolved.shadowMode
  const v15B1 = config?.experimental?.orchestrator_v15_b1 ?? resolved.orchestratorV15B1

  if (!v15B1) {
    const base = {
      enabled,
      llmWorkers,
      workerBadge,
      shadowMode,
      v15B1: false,
      adaptiveTTC: false,
    }
    if (!b2) {
      return withV16Rollout({
        base,
        include: v16,
        enabled,
        llmWorkers,
        observability: v16Observability,
        v16LLMWorkers,
        scorer: v16Scorer,
        deepseekThinking: v16DeepseekThinking,
        cacheAwarePrompt: v16CacheAwarePrompt,
      })
    }

    const b2Base = {
      ...base,
      v15B2: false,
      pointerContextOS: false,
    }
    if (!a1) {
      return withV16Rollout({
        base: b2Base,
        include: v16,
        enabled,
        llmWorkers,
        observability: v16Observability,
        v16LLMWorkers,
        scorer: v16Scorer,
        deepseekThinking: v16DeepseekThinking,
        cacheAwarePrompt: v16CacheAwarePrompt,
      })
    }

    return withV16Rollout({
      base: {
        ...b2Base,
        v15A1: false,
        claimGraphGate: false,
        dualPassSynthesis: false,
      },
      include: v16,
      enabled,
      llmWorkers,
      observability: v16Observability,
      v16LLMWorkers,
      scorer: v16Scorer,
      deepseekThinking: v16DeepseekThinking,
      cacheAwarePrompt: v16CacheAwarePrompt,
    })
  }

  const adaptiveTTC = config?.experimental?.adaptive_ttc ?? resolved.adaptiveTTC
  const v15B2 = config?.experimental?.orchestrator_v15_b2 ?? resolved.orchestratorV15B2

  if (!v15B2) {
    const base = {
      enabled,
      llmWorkers,
      workerBadge,
      shadowMode,
      v15B1,
      adaptiveTTC,
    }
    if (!b2) {
      return withV16Rollout({
        base,
        include: v16,
        enabled,
        llmWorkers,
        observability: v16Observability,
        v16LLMWorkers,
        scorer: v16Scorer,
        deepseekThinking: v16DeepseekThinking,
        cacheAwarePrompt: v16CacheAwarePrompt,
      })
    }

    const b2Base = {
      ...base,
      v15B2: false,
      pointerContextOS: false,
    }
    if (!a1) {
      return withV16Rollout({
        base: b2Base,
        include: v16,
        enabled,
        llmWorkers,
        observability: v16Observability,
        v16LLMWorkers,
        scorer: v16Scorer,
        deepseekThinking: v16DeepseekThinking,
        cacheAwarePrompt: v16CacheAwarePrompt,
      })
    }

    return withV16Rollout({
      base: {
        ...b2Base,
        v15A1: false,
        claimGraphGate: false,
        dualPassSynthesis: false,
      },
      include: v16,
      enabled,
      llmWorkers,
      observability: v16Observability,
      v16LLMWorkers,
      scorer: v16Scorer,
      deepseekThinking: v16DeepseekThinking,
      cacheAwarePrompt: v16CacheAwarePrompt,
    })
  }

  const pointerContextOS = config?.experimental?.pointer_context_os ?? resolved.pointerContextOS

  if (!b2) {
    const base = {
      enabled,
      llmWorkers,
      workerBadge,
      shadowMode,
      v15B1,
      adaptiveTTC,
    }
    if (!a1) {
      return withV16Rollout({
        base,
        include: v16,
        enabled,
        llmWorkers,
        observability: v16Observability,
        v16LLMWorkers,
        scorer: v16Scorer,
        deepseekThinking: v16DeepseekThinking,
        cacheAwarePrompt: v16CacheAwarePrompt,
      })
    }

    return withV16Rollout({
      base: {
        ...base,
        v15A1: false,
        claimGraphGate: false,
        dualPassSynthesis: false,
      },
      include: v16,
      enabled,
      llmWorkers,
      observability: v16Observability,
      v16LLMWorkers,
      scorer: v16Scorer,
      deepseekThinking: v16DeepseekThinking,
      cacheAwarePrompt: v16CacheAwarePrompt,
    })
  }

  const v15A1 = resolved.orchestratorV15A1
  const claimGraphGate = v15A1 && resolved.claimGraphGate
  const dualPassSynthesis = v15A1 && resolved.dualPassSynthesis

  if (!a1) {
    return withV16Rollout({
      base: {
        enabled,
        llmWorkers,
        workerBadge,
        shadowMode,
        v15B1,
        adaptiveTTC,
        v15B2,
        pointerContextOS,
      },
      include: v16,
      enabled,
      llmWorkers,
      observability: v16Observability,
      v16LLMWorkers,
      scorer: v16Scorer,
      deepseekThinking: v16DeepseekThinking,
      cacheAwarePrompt: v16CacheAwarePrompt,
    })
  }

  return withV16Rollout({
    base: {
      enabled,
      llmWorkers,
      workerBadge,
      shadowMode,
      v15B1,
      adaptiveTTC,
      v15B2,
      pointerContextOS,
      v15A1,
      claimGraphGate,
      dualPassSynthesis,
    },
    include: v16,
    enabled,
    llmWorkers,
    observability: v16Observability,
    v16LLMWorkers,
    scorer: v16Scorer,
    deepseekThinking: v16DeepseekThinking,
    cacheAwarePrompt: v16CacheAwarePrompt,
  })
}


export const executeOrchestratorTurnByRollout = async (input: {
  rollout: OrchestratorRollout
  base: Pick<OrchestratorTurnShape, "system" | "tools">
  run: (gate: OrchestratorRunGate) => Promise<OrchestratorTurnShape>
}): Promise<OrchestratorTurnShape> => {
  if (!input.rollout.enabled) {
    return {
      system: input.base.system,
      tools: input.base.tools,
      degraded: false,
    }
  }

  if (!input.rollout.llmWorkers) {
    return {
      system: input.base.system,
      tools: input.base.tools,
      degraded: false,
    }
  }

  const v15B2 = input.rollout.v15B1 && input.rollout.v15B2 === true
  const pointerContextOS = v15B2 && input.rollout.pointerContextOS === true
  const hasA1 =
    input.rollout.v15A1 !== undefined ||
    input.rollout.claimGraphGate !== undefined ||
    input.rollout.dualPassSynthesis !== undefined
  const v15A1 = v15B2 && input.rollout.v15A1 === true
  const claimGraphGate = v15A1 && input.rollout.claimGraphGate === true
  const dualPassSynthesis = v15A1 && input.rollout.dualPassSynthesis === true
  const gateBase =
    input.rollout.v15B2 === undefined && input.rollout.pointerContextOS === undefined
      ? {
          v15B1: input.rollout.v15B1,
          adaptiveTTC: input.rollout.v15B1 && input.rollout.adaptiveTTC,
        }
      : {
          v15B1: input.rollout.v15B1,
          adaptiveTTC: input.rollout.v15B1 && input.rollout.adaptiveTTC,
          v15B2,
          pointerContextOS,
        }
  const gateA1 =
    !hasA1
      ? gateBase
      : {
          ...gateBase,
          v15A1,
          claimGraphGate,
          dualPassSynthesis,
        }
  const hasV16 =
    input.rollout.v16Observability !== undefined ||
    input.rollout.v16LLMWorkers !== undefined ||
    input.rollout.v16Scorer !== undefined ||
    input.rollout.v16DeepseekThinking !== undefined ||
    input.rollout.v16CacheAwarePrompt !== undefined
  const v16Observability = input.rollout.enabled && input.rollout.v16Observability === true
  const v16LLMWorkers = v16Observability && input.rollout.llmWorkers && input.rollout.v16LLMWorkers === true
  const v16Scorer = v16LLMWorkers && input.rollout.v16Scorer === true
  const v16DeepseekThinking = v16Scorer && input.rollout.v16DeepseekThinking === true
  const v16CacheAwarePrompt = v16DeepseekThinking && input.rollout.v16CacheAwarePrompt === true
  const gate =
    !hasV16
      ? gateA1
      : {
          ...gateA1,
          v16Observability,
          v16LLMWorkers,
          v16Scorer,
          v16DeepseekThinking,
          v16CacheAwarePrompt,
        }

  const result = await input.run(gate)
  if (!input.rollout.shadowMode) return result

  return {
    system: input.base.system,
    tools: input.base.tools,
    degraded: false,
  }
}

export namespace SessionProcessor {
  const DOOM_LOOP_THRESHOLD = 3
  const log = Log.create({ service: "session.processor" })

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
        actor: "orchestrator:processor",
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

  export type Info = Awaited<ReturnType<typeof create>>
  export type Result = Awaited<ReturnType<Info["process"]>>

  export function create(input: {
    assistantMessage: MessageV2.Assistant
    sessionID: string
    model: Provider.Model
    abort: AbortSignal
  }) {
    const toolcalls: Record<string, MessageV2.ToolPart> = {}
    let snapshot: string | undefined
    let blocked = false
    let attempt = 0
    let needsCompaction = false

    const result = {
      get message() {
        return input.assistantMessage
      },
      partFromToolCall(toolCallID: string) {
        return toolcalls[toolCallID]
      },
      async process(streamInput: LLM.StreamInput) {
        log.info("process")
        needsCompaction = false
        const config = await Config.get()
        const shouldBreak = config.experimental?.continue_loop_on_deny !== true
        const rollout = resolveOrchestratorRollout(config)
        const orchestrator = await (async () => {
          if (!rollout.enabled) return { enabled: false as const }
          if (input.assistantMessage.agent !== "build") return { enabled: false as const }
          if (streamInput.agent.mode !== "primary") return { enabled: false as const }
          const session = await Session.get(input.sessionID).catch(() => undefined)
          const uxMode = Flag.OPENCODE_ORCHESTRATOR_UX_MODE ?? "auto"
          const prepared = await prepareOrchestratorPlan({
            sessionId: input.sessionID,
            messageId: streamInput.user.id,
            uxMode,
            messages: streamInput.messages,
            tools: streamInput.tools,
            parentSessionId: session?.parentID,
          })
          return {
            enabled: true as const,
            degraded: false as const,
            plan: prepared.plan,
            features: prepared.features,
            toolsetFingerprint: prepared.toolsetFingerprint,
            intentText: prepared.intentText,
            session,
          }
        })().catch(async (error) => {
          await writeOrchestratorDegraded({
            sessionId: input.sessionID,
            messageId: streamInput.user.id,
            stage: "plan",
            reason: errorText(error),
          })
          return { enabled: true as const, degraded: true as const }
        })
        const orchestratorTurn: OrchestratorTurnShape = await (async () => {
          const base = { system: streamInput.system, tools: streamInput.tools }
          if (!orchestrator.enabled) {
            return {
              ...base,
              degraded: false,
              retrievalMain: {
                enabled: false,
                mode: "chat" as OrchestratorMode,
              },
            }
          }
          if (orchestrator.degraded) {
            return {
              ...base,
              degraded: true,
              retrievalMain: {
                enabled: false,
                mode: "chat" as OrchestratorMode,
              },
            }
          }
          const main = {
            enabled: false,
            mode: "chat" as OrchestratorMode,
          }
          const runAssistBeforeFork =
            orchestrator.plan.orchestratorMode === "fork" &&
            orchestrator.features.features.hasVerificationIntent === true &&
            orchestrator.plan.workers.length > 0
          const turn = await executeOrchestratorTurnByRollout({
            rollout,
            base,
            run: async (gate) =>
              (main.enabled = true,
              main.mode = runAssistBeforeFork ? "assist" : orchestrator.plan.orchestratorMode,
              runOrchestratorTurn({
                sessionId: input.sessionID,
                messageId: streamInput.user.id,
                abort: input.abort,
                plan: runAssistBeforeFork
                  ? {
                      ...orchestrator.plan,
                      orchestratorMode: "assist",
                    }
                  : orchestrator.plan,
                features: orchestrator.features,
                intentText: orchestrator.intentText,
                system: streamInput.system,
                tools: streamInput.tools,
                workingSetPointers: gate.pointerContextOS ? undefined : [],
                model: {
                  providerID: streamInput.model.providerID,
                  modelID: streamInput.model.id,
                },
              })),
          })
          return {
            ...turn,
            retrievalMain: main,
          }
        })().catch(async (error) => {
          await writeOrchestratorDegraded({
            sessionId: input.sessionID,
            messageId: streamInput.user.id,
            stage: "turn",
            reason: errorText(error),
          })
          return {
            system: streamInput.system,
            tools: streamInput.tools,
            degraded: true,
            retrievalMain: {
              enabled: false,
              mode: "chat" as OrchestratorMode,
            },
          }
        })
        const forkNotice = await (async () => {
          if (!orchestrator.enabled) return
          if (orchestrator.degraded) return
          if (orchestrator.plan.orchestratorMode !== "fork") return
          const strategy = resolveForkStrategy({
            product: config.product,
            env: Flag.OPENCODE_ORCHESTRATOR_FORK_STRATEGY,
          })
          const session = orchestrator.session ?? (await Session.get(input.sessionID).catch(() => undefined))
          if (!session) return
          const agent = await Agent.get(input.assistantMessage.agent)
          const prompt = orchestrator.intentText
            ? `请在子会话完成以下任务：${orchestrator.intentText}`
            : "请在子会话完成写入或执行任务。"
          const task = {
            description: "orchestrator task",
            subagentType: "general",
            prompt,
          }
          if (strategy === "suggest" || strategy === "off") {
            return renderForkNotice({
              mode: strategy,
              description: task.description,
              subagentType: task.subagentType,
              prompt: task.prompt,
            })
          }

          const result = await runForkTask({
            sessionId: input.sessionID,
            assistantMessageId: input.assistantMessage.id,
            agent,
            session,
            model: {
              providerID: input.model.providerID,
              id: input.model.id,
              api: input.model.api,
            },
            abort: input.abort,
            task,
          })
          if (result.status === "degraded") return result.notice
          return
        })().catch(async (error) => {
          await writeOrchestratorDegraded({
            sessionId: input.sessionID,
            messageId: input.assistantMessage.id,
            stage: "fork_task",
            reason: errorText(error),
          })
          return undefined
        })
        while (true) {
          try {
            let currentText: MessageV2.TextPart | undefined
            let reasoningMap: Record<string, MessageV2.ReasoningPart> = {}
            const routingPolicy = resolveHybridRoutingPolicy({
              strategy: config.experimental?.retrieval_hybrid_strategy,
              gate: config.experimental?.retrieval_hybrid_compensation_gate,
              rollback: config.experimental?.retrieval_hybrid_rollback,
              envStrategy: Flag.OPENCODE_RETRIEVAL_HYBRID_STRATEGY,
              envGate: Flag.OPENCODE_RETRIEVAL_HYBRID_COMPENSATION_GATE,
              envRollback: Flag.OPENCODE_RETRIEVAL_HYBRID_ROLLBACK,
            })
            const orchestratedInput = {
              ...streamInput,
              system: forkNotice ? [...orchestratorTurn.system, forkNotice] : orchestratorTurn.system,
              tools: orchestratorTurn.tools,
              retrievalRoute: {
                policy: routingPolicy,
                main: {
                  source: "orchestrator" as const,
                  enabled: orchestratorTurn.retrievalMain?.enabled ?? false,
                  coversRetrieval: orchestratorTurn.retrievalMain?.coversRetrieval,
                  mode: orchestratorTurn.retrievalMain?.mode ?? "chat",
                  degraded: orchestratorTurn.degraded,
                },
              },
            }
            const stream = await LLM.stream(orchestratedInput)

            for await (const value of stream.fullStream) {
              input.abort.throwIfAborted()
              switch (value.type) {
                case "start":
                  SessionStatus.set(input.sessionID, { type: "busy" })
                  break

                case "reasoning-start":
                  if (value.id in reasoningMap) {
                    continue
                  }
                  reasoningMap[value.id] = {
                    id: Identifier.ascending("part"),
                    messageID: input.assistantMessage.id,
                    sessionID: input.assistantMessage.sessionID,
                    type: "reasoning",
                    text: "",
                    time: {
                      start: Date.now(),
                    },
                    metadata: value.providerMetadata,
                  }
                  break

                case "reasoning-delta":
                  if (value.id in reasoningMap) {
                    const part = reasoningMap[value.id]
                    part.text += value.text
                    if (value.providerMetadata) part.metadata = value.providerMetadata
                    if (part.text) await Session.updatePart({ part, delta: value.text })
                  }
                  break

                case "reasoning-end":
                  if (value.id in reasoningMap) {
                    const part = reasoningMap[value.id]
                    part.text = part.text.trimEnd()

                    part.time = {
                      ...part.time,
                      end: Date.now(),
                    }
                    if (value.providerMetadata) part.metadata = value.providerMetadata
                    await Session.updatePart(part)
                    delete reasoningMap[value.id]
                  }
                  break

                case "tool-input-start":
                  const part = await Session.updatePart({
                    id: toolcalls[value.id]?.id ?? Identifier.ascending("part"),
                    messageID: input.assistantMessage.id,
                    sessionID: input.assistantMessage.sessionID,
                    type: "tool",
                    tool: value.toolName,
                    callID: value.id,
                    state: {
                      status: "pending",
                      input: {},
                      raw: "",
                    },
                  })
                  toolcalls[value.id] = part as MessageV2.ToolPart
                  break

                case "tool-input-delta":
                  break

                case "tool-input-end":
                  break

                case "tool-call": {
                  const match = toolcalls[value.toolCallId]
                  if (match) {
                    const part = await Session.updatePart({
                      ...match,
                      tool: value.toolName,
                      state: {
                        status: "running",
                        input: value.input,
                        time: {
                          start: Date.now(),
                        },
                      },
                      metadata: value.providerMetadata,
                    })
                    toolcalls[value.toolCallId] = part as MessageV2.ToolPart

                    const parts = await MessageV2.parts(input.assistantMessage.id)
                    const lastThree = parts.slice(-DOOM_LOOP_THRESHOLD)

                    if (
                      lastThree.length === DOOM_LOOP_THRESHOLD &&
                      lastThree.every(
                        (p) =>
                          p.type === "tool" &&
                          p.tool === value.toolName &&
                          p.state.status !== "pending" &&
                          JSON.stringify(p.state.input) === JSON.stringify(value.input),
                      )
                    ) {
                      const agent = await Agent.get(input.assistantMessage.agent)
                      await PermissionNext.ask({
                        permission: "doom_loop",
                        patterns: [value.toolName],
                        sessionID: input.assistantMessage.sessionID,
                        metadata: {
                          tool: value.toolName,
                          input: value.input,
                        },
                        always: [value.toolName],
                        ruleset: agent.permission,
                      })
                    }
                  }
                  break
                }
                case "tool-result": {
                  const match = toolcalls[value.toolCallId]
                  if (match && match.state.status === "running") {
                    await Session.updatePart({
                      ...match,
                      state: {
                        status: "completed",
                        input: value.input ?? match.state.input,
                        output: value.output.output,
                        metadata: value.output.metadata,
                        title: value.output.title,
                        time: {
                          start: match.state.time.start,
                          end: Date.now(),
                        },
                        attachments: value.output.attachments,
                      },
                    })

                    delete toolcalls[value.toolCallId]
                  }
                  break
                }

                case "tool-error": {
                  const match = toolcalls[value.toolCallId]
                  if (match && match.state.status === "running") {
                    await Session.updatePart({
                      ...match,
                      state: {
                        status: "error",
                        input: value.input ?? match.state.input,
                        error: (value.error as any).toString(),
                        time: {
                          start: match.state.time.start,
                          end: Date.now(),
                        },
                      },
                    })

                    if (
                      value.error instanceof PermissionNext.RejectedError ||
                      value.error instanceof Question.RejectedError
                    ) {
                      blocked = shouldBreak
                    }
                    delete toolcalls[value.toolCallId]
                  }
                  break
                }
                case "error":
                  throw value.error

                case "start-step":
                  snapshot = await Snapshot.track()
                  await Session.updatePart({
                    id: Identifier.ascending("part"),
                    messageID: input.assistantMessage.id,
                    sessionID: input.sessionID,
                    snapshot,
                    type: "step-start",
                  })
                  break

                case "finish-step":
                  const usage = Session.getUsage({
                    model: input.model,
                    usage: value.usage,
                    metadata: value.providerMetadata,
                    flags: {
                      openaiChatCachedTokens: Flag.OPENCODE_EXPERIMENTAL_OPENAI_CHAT_CACHED_TOKENS === true,
                    },
                  })
                  input.assistantMessage.finish = value.finishReason
                  input.assistantMessage.cost += usage.cost
                  input.assistantMessage.tokens = usage.tokens
                  await Session.updatePart({
                    id: Identifier.ascending("part"),
                    reason: value.finishReason,
                    snapshot: await Snapshot.track(),
                    messageID: input.assistantMessage.id,
                    sessionID: input.assistantMessage.sessionID,
                    type: "step-finish",
                    tokens: usage.tokens,
                    cost: usage.cost,
                  })
                  await Session.updateMessage(input.assistantMessage)
                  await (async () => {
                    const writer = await EvidenceWriter.open({ sessionId: input.sessionID })
                    const messageId = input.assistantMessage.parentID ?? input.assistantMessage.id
                    await writeUsageEvents({
                      writer,
                      ts: new Date().toISOString(),
                      sessionId: input.sessionID,
                      messageId,
                      model: {
                        providerID: input.model.providerID,
                        id: input.model.id,
                        api: { npm: input.model.api.npm, id: input.model.api.id },
                      },
                      usage: value.usage as unknown as Record<string, unknown>,
                      metadata: value.providerMetadata,
                      tokens: usage.tokens,
                      flags: {
                        openaiChatCachedTokens: Flag.OPENCODE_EXPERIMENTAL_OPENAI_CHAT_CACHED_TOKENS === true,
                      },
                      providerRaw: {
                        enabled: Flag.OPENCODE_EXPERIMENTAL_USAGE_PROVIDER_RAW_ARTIFACT === true,
                      },
                    })
                  })()
                  if (snapshot) {
                    const patch = await Snapshot.patch(snapshot)
                    if (patch.files.length) {
                      await Session.updatePart({
                        id: Identifier.ascending("part"),
                        messageID: input.assistantMessage.id,
                        sessionID: input.sessionID,
                        type: "patch",
                        hash: patch.hash,
                        files: patch.files,
                      })
                    }
                    snapshot = undefined
                  }
                  SessionSummary.summarize({
                    sessionID: input.sessionID,
                    messageID: input.assistantMessage.parentID,
                  })
                  const trig = await SessionCompaction.trigger({ tokens: usage.tokens, model: input.model })
                  if (trig) needsCompaction = true
                  break

                case "text-start":
                  currentText = {
                    id: Identifier.ascending("part"),
                    messageID: input.assistantMessage.id,
                    sessionID: input.assistantMessage.sessionID,
                    type: "text",
                    text: "",
                    time: {
                      start: Date.now(),
                    },
                    metadata: value.providerMetadata,
                  }
                  break

                case "text-delta":
                  if (currentText) {
                    currentText.text += value.text
                    if (value.providerMetadata) currentText.metadata = value.providerMetadata
                    if (currentText.text)
                      await Session.updatePart({
                        part: currentText,
                        delta: value.text,
                      })
                  }
                  break

                case "text-end":
                  if (currentText) {
                    currentText.text = currentText.text.trimEnd()
                    const textOutput = await Plugin.trigger(
                      "experimental.text.complete",
                      {
                        sessionID: input.sessionID,
                        messageID: input.assistantMessage.id,
                        partID: currentText.id,
                      },
                      { text: currentText.text },
                    )
                    currentText.text = textOutput.text

                    const gated = await (async () => {
                      if (input.assistantMessage.summary) return { ok: false as const }
                      if (currentText.synthetic) return { ok: false as const }
                      if (input.assistantMessage.agent !== "build") return { ok: false as const }
                      const orchestratorEnabled = orchestrator.enabled && !orchestrator.degraded
                      const secureMode = resolveSecureOutputMode({
                        enabled: orchestratorEnabled,
                        plan: orchestratorEnabled ? orchestrator.plan : undefined,
                      })
                      if (!secureMode) return { ok: false as const }

                      return runSecureOutput({
                        sessionId: input.sessionID,
                        messageId: input.assistantMessage.id,
                        mode: secureMode,
                        budget: { timeMs: 8000, maxScripts: 4 },
                        text: currentText.text,
                        ctx: {
                          sessionID: input.sessionID,
                          messageID: input.assistantMessage.id,
                          callID: "",
                          agent: input.assistantMessage.agent,
                          abort: input.abort,
                          metadata: () => {},
                          ask: async () => {},
                        },
                      })
                        .then((value) => ({ ok: true as const, value }))
                        .catch(() => ({ ok: false as const }))
                    })()

                    if (gated.ok) {
                      currentText.text = gated.value.text
                    }

                    currentText.time = {
                      start: Date.now(),
                      end: Date.now(),
                    }
                    if (value.providerMetadata) currentText.metadata = value.providerMetadata
                    await Session.updatePart(currentText)
                  }
                  currentText = undefined
                  break

                case "finish":
                  break

                default:
                  log.info("unhandled", {
                    ...value,
                  })
                  continue
              }
              if (needsCompaction) break
            }
          } catch (e: any) {
            log.error("process", {
              error: e,
              stack: JSON.stringify(e.stack),
            })
            const error = MessageV2.fromError(e, { providerID: input.model.providerID })
            const retry = SessionRetry.retryable(error)
            if (retry !== undefined) {
              attempt++
              const delay = SessionRetry.delay(attempt, error.name === "APIError" ? error : undefined)
              SessionStatus.set(input.sessionID, {
                type: "retry",
                attempt,
                message: retry,
                next: Date.now() + delay,
              })
              await SessionRetry.sleep(delay, input.abort).catch(() => {})
              continue
            }
            input.assistantMessage.error = error
            Bus.publish(Session.Event.Error, {
              sessionID: input.assistantMessage.sessionID,
              error: input.assistantMessage.error,
            })
          }
          if (snapshot) {
            const patch = await Snapshot.patch(snapshot)
            if (patch.files.length) {
              await Session.updatePart({
                id: Identifier.ascending("part"),
                messageID: input.assistantMessage.id,
                sessionID: input.sessionID,
                type: "patch",
                hash: patch.hash,
                files: patch.files,
              })
            }
            snapshot = undefined
          }
          const p = await MessageV2.parts(input.assistantMessage.id)
          for (const part of p) {
            if (part.type === "tool" && part.state.status !== "completed" && part.state.status !== "error") {
              await Session.updatePart({
                ...part,
                state: {
                  ...part.state,
                  status: "error",
                  error: "Tool execution aborted",
                  time: {
                    start: Date.now(),
                    end: Date.now(),
                  },
                },
              })
            }
          }
          input.assistantMessage.time.completed = Date.now()
          await Session.updateMessage(input.assistantMessage)
          if (needsCompaction) return "compact"
          if (blocked) return "stop"
          if (input.assistantMessage.error) return "stop"
          return "continue"
        }
      },
    }
    return result
  }
}
