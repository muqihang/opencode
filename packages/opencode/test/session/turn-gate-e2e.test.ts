import { describe, expect, test } from "bun:test"
import { tool, jsonSchema, type Tool } from "ai"
import { extractA1Features } from "../../src/session/orchestrator/features"

const loadProcessor = async () => {
  const suffix = crypto.randomUUID()
  return import(`../../src/session/processor.ts?${suffix}`)
}

const makeTool = (): Tool =>
  tool({
    description: "test tool",
    inputSchema: jsonSchema({ type: "object", properties: {} }),
    execute: async () => ({ output: "", title: "", metadata: {} }),
  })

describe("turn gate e2e", () => {
  test("A1 flags remain gated by orchestrator + b1 + b2 + a1", async () => {
    const cases = [
      {
        flags: {
          orchestrator: false,
          llmWorkers: true,
          workerBadge: true,
          shadowMode: false,
          orchestratorV15B1: true,
          adaptiveTTC: true,
          orchestratorV15B2: true,
          pointerContextOS: true,
          orchestratorV15A1: true,
          claimGraphGate: true,
          dualPassSynthesis: true,
        },
        expected: {
          enabled: false,
          llmWorkers: false,
          workerBadge: false,
          shadowMode: false,
          v15B1: false,
          adaptiveTTC: false,
          v15B2: false,
          pointerContextOS: false,
          v15A1: false,
          claimGraphGate: false,
          dualPassSynthesis: false,
        },
      },
      {
        flags: {
          orchestrator: true,
          llmWorkers: true,
          workerBadge: true,
          shadowMode: false,
          orchestratorV15B1: true,
          adaptiveTTC: true,
          orchestratorV15B2: true,
          pointerContextOS: true,
          orchestratorV15A1: false,
          claimGraphGate: true,
          dualPassSynthesis: true,
        },
        expected: {
          enabled: true,
          llmWorkers: true,
          workerBadge: true,
          shadowMode: false,
          v15B1: true,
          adaptiveTTC: true,
          v15B2: true,
          pointerContextOS: true,
          v15A1: false,
          claimGraphGate: false,
          dualPassSynthesis: false,
        },
      },
      {
        flags: {
          orchestrator: true,
          llmWorkers: true,
          workerBadge: true,
          shadowMode: false,
          orchestratorV15B1: true,
          adaptiveTTC: true,
          orchestratorV15B2: true,
          pointerContextOS: true,
          orchestratorV15A1: true,
          claimGraphGate: true,
          dualPassSynthesis: false,
        },
        expected: {
          enabled: true,
          llmWorkers: true,
          workerBadge: true,
          shadowMode: false,
          v15B1: true,
          adaptiveTTC: true,
          v15B2: true,
          pointerContextOS: true,
          v15A1: true,
          claimGraphGate: true,
          dualPassSynthesis: false,
        },
      },
      {
        flags: {
          orchestrator: true,
          llmWorkers: true,
          workerBadge: true,
          shadowMode: false,
          orchestratorV15B1: true,
          adaptiveTTC: true,
          orchestratorV15B2: true,
          pointerContextOS: true,
          orchestratorV15A1: true,
          claimGraphGate: true,
          dualPassSynthesis: true,
        },
        expected: {
          enabled: true,
          llmWorkers: true,
          workerBadge: true,
          shadowMode: false,
          v15B1: true,
          adaptiveTTC: true,
          v15B2: true,
          pointerContextOS: true,
          v15A1: true,
          claimGraphGate: true,
          dualPassSynthesis: true,
        },
      },
    ]

    for (const item of cases) {
      const mod = await loadProcessor()
      const rollout = mod.resolveOrchestratorRollout(undefined, item.flags)
      expect(rollout).toEqual(item.expected)
    }
  })

  test("v16 rollout flags keep dependency ordering in resolve + run gate", async () => {
    const mod = await loadProcessor()
    const base = {
      system: ["base"],
      tools: { read: makeTool(), write: makeTool(), bash: makeTool() },
    }
    const state: {
      gate?: {
        v15B1: boolean
        adaptiveTTC: boolean
        v15B2: boolean
        pointerContextOS: boolean
        v15A1: boolean
        claimGraphGate: boolean
        dualPassSynthesis: boolean
        v16Observability: boolean
        v16LLMWorkers: boolean
        v16Scorer: boolean
        v16DeepseekThinking: boolean
        v16CacheAwarePrompt: boolean
      }
    } = {}

    const rollout = mod.resolveOrchestratorRollout(undefined, {
      orchestrator: true,
      llmWorkers: true,
      workerBadge: true,
      shadowMode: false,
      orchestratorV15B1: true,
      adaptiveTTC: true,
      orchestratorV15B2: false,
      pointerContextOS: false,
      orchestratorV15A1: false,
      claimGraphGate: false,
      dualPassSynthesis: false,
      orchestratorV16Observability: true,
      orchestratorV16LLMWorkers: true,
      orchestratorV16Scorer: false,
      orchestratorV16DeepseekThinking: true,
      orchestratorV16CacheAwarePrompt: true,
    })

    expect(rollout).toMatchObject({
      enabled: true,
      llmWorkers: true,
      v15B1: true,
      adaptiveTTC: true,
      v15B2: false,
      pointerContextOS: false,
      v15A1: false,
      claimGraphGate: false,
      dualPassSynthesis: false,
      v16Observability: true,
      v16LLMWorkers: true,
      v16Scorer: false,
      v16DeepseekThinking: false,
      v16CacheAwarePrompt: false,
    })

    await mod.executeOrchestratorTurnByRollout({
      rollout,
      base,
      run: async (gate: {
        v15B1: boolean
        adaptiveTTC: boolean
        v15B2: boolean
        pointerContextOS: boolean
        v15A1: boolean
        claimGraphGate: boolean
        dualPassSynthesis: boolean
        v16Observability: boolean
        v16LLMWorkers: boolean
        v16Scorer: boolean
        v16DeepseekThinking: boolean
        v16CacheAwarePrompt: boolean
      }) => {
        state.gate = gate
        return {
          system: ["base", "<orchestrator>v16</orchestrator>"],
          tools: { read: makeTool() },
          degraded: false,
        }
      },
    })

    expect(state.gate).toEqual({
      v15B1: true,
      adaptiveTTC: true,
      v15B2: false,
      pointerContextOS: false,
      v15A1: false,
      claimGraphGate: false,
      dualPassSynthesis: false,
      v16Observability: true,
      v16LLMWorkers: true,
      v16Scorer: false,
      v16DeepseekThinking: false,
      v16CacheAwarePrompt: false,
    })
  })

  test("execute passes turn gate switches to the runner", async () => {
    const mod = await loadProcessor()
    const base = {
      system: ["base"],
      tools: { read: makeTool(), write: makeTool(), bash: makeTool() },
    }
    const state: {
      gate?: {
        v15B1: boolean
        adaptiveTTC: boolean
        v15B2: boolean
        pointerContextOS: boolean
        v15A1: boolean
        claimGraphGate: boolean
        dualPassSynthesis: boolean
      }
    } = {}

    const result = await mod.executeOrchestratorTurnByRollout({
      rollout: {
        enabled: true,
        llmWorkers: true,
        workerBadge: true,
        shadowMode: false,
        v15B1: true,
        adaptiveTTC: true,
        v15B2: true,
        pointerContextOS: true,
        v15A1: true,
        claimGraphGate: true,
        dualPassSynthesis: true,
      },
      base,
      run: async (gate: {
        v15B1: boolean
        adaptiveTTC: boolean
        v15B2: boolean
        pointerContextOS: boolean
        v15A1: boolean
        claimGraphGate: boolean
        dualPassSynthesis: boolean
      }) => {
        state.gate = gate
        return {
          system: ["base", "<orchestrator>turn_gate</orchestrator>"],
          tools: { read: makeTool() },
          degraded: true,
        }
      },
    })

    expect(state.gate).toEqual({
      v15B1: true,
      adaptiveTTC: true,
      v15B2: true,
      pointerContextOS: true,
      v15A1: true,
      claimGraphGate: true,
      dualPassSynthesis: true,
    })
    expect(result.degraded).toBe(true)
    expect(result.system).toContain("<orchestrator>turn_gate</orchestrator>")
  })

  test("A1 feature extraction detects high-risk citation tasks", () => {
    const result = extractA1Features({
      intentText: "请依据法律条款给出结论并提供可核验引用",
      hasFileParts: false,
    })

    expect(result.highRisk).toBe(true)
    expect(result.requiresCitation).toBe(true)
    expect(result.dualPassCandidate).toBe(true)
  })
})
