import { describe, expect, test } from "bun:test"
import { tool, jsonSchema, type Tool } from "ai"

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

describe("orchestrator v1.5 b2 flags integration", () => {
  test("flags matrix keeps b2/pointer switches gated by orchestrator + b1 + b2", async () => {
    const cases = [
      {
        flags: {
          orchestrator: false,
          llmWorkers: true,
          workerBadge: true,
          shadowMode: true,
          orchestratorV15B1: true,
          adaptiveTTC: true,
          orchestratorV15B2: true,
          pointerContextOS: true,
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
        },
      },
      {
        flags: {
          orchestrator: true,
          llmWorkers: true,
          workerBadge: false,
          shadowMode: false,
          orchestratorV15B1: false,
          adaptiveTTC: true,
          orchestratorV15B2: true,
          pointerContextOS: true,
        },
        expected: {
          enabled: true,
          llmWorkers: true,
          workerBadge: false,
          shadowMode: false,
          v15B1: false,
          adaptiveTTC: false,
          v15B2: false,
          pointerContextOS: false,
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
          orchestratorV15B2: false,
          pointerContextOS: true,
        },
        expected: {
          enabled: true,
          llmWorkers: true,
          workerBadge: true,
          shadowMode: false,
          v15B1: true,
          adaptiveTTC: true,
          v15B2: false,
          pointerContextOS: false,
        },
      },
      {
        flags: {
          orchestrator: true,
          llmWorkers: true,
          workerBadge: true,
          shadowMode: true,
          orchestratorV15B1: true,
          adaptiveTTC: true,
          orchestratorV15B2: true,
          pointerContextOS: false,
        },
        expected: {
          enabled: true,
          llmWorkers: true,
          workerBadge: true,
          shadowMode: true,
          v15B1: true,
          adaptiveTTC: true,
          v15B2: true,
          pointerContextOS: false,
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
        },
      },
    ]

    for (const item of cases) {
      const mod = await loadProcessor()
      const rollout = mod.resolveOrchestratorRollout(undefined, item.flags)
      expect(rollout).toEqual(item.expected)
    }
  })

  test("config rollback can disable b2 immediately even if pointer flag is on", async () => {
    const mod = await loadProcessor()
    const rollout = mod.resolveOrchestratorRollout(
      {
        experimental: {
          orchestrator_llm_workers: true,
          orchestrator_worker_badge: true,
          orchestrator_shadow_mode: false,
          orchestrator_v15_b1: true,
          adaptive_ttc: true,
          orchestrator_v15_b2: false,
          pointer_context_os: true,
        },
      },
      {
        orchestrator: true,
        llmWorkers: true,
        workerBadge: true,
        shadowMode: false,
        orchestratorV15B1: true,
        adaptiveTTC: true,
        orchestratorV15B2: true,
        pointerContextOS: true,
      },
    )

    expect(rollout).toEqual({
      enabled: true,
      llmWorkers: true,
      workerBadge: true,
      shadowMode: false,
      v15B1: true,
      adaptiveTTC: true,
      v15B2: false,
      pointerContextOS: false,
    })
  })

  test("execute wires b2/pointer gate into runner while keeping degrade semantics", async () => {
    const mod = await loadProcessor()
    const base = {
      system: ["base"],
      tools: { read: makeTool(), write: makeTool(), bash: makeTool() },
    }
    const state: {
      calls: number
      gate?: {
        v15B1: boolean
        adaptiveTTC: boolean
        v15B2: boolean
        pointerContextOS: boolean
      }
    } = {
      calls: 0,
    }

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
      },
      base,
      run: async (gate: { v15B1: boolean; adaptiveTTC: boolean; v15B2: boolean; pointerContextOS: boolean }) => {
        state.calls += 1
        state.gate = gate
        return {
          system: ["base", "<orchestrator>injected</orchestrator>"],
          tools: { read: makeTool() },
          degraded: true,
        }
      },
    })

    expect(state.calls).toBe(1)
    expect(state.gate).toEqual({
      v15B1: true,
      adaptiveTTC: true,
      v15B2: true,
      pointerContextOS: true,
    })
    expect(result.degraded).toBe(true)
    expect(result.system).toContain("<orchestrator>injected</orchestrator>")
  })

  test("shadow mode still falls back to base output under b2 gates", async () => {
    const mod = await loadProcessor()
    const base = {
      system: ["base"],
      tools: { read: makeTool(), write: makeTool(), bash: makeTool() },
    }

    const result = await mod.executeOrchestratorTurnByRollout({
      rollout: {
        enabled: true,
        llmWorkers: true,
        workerBadge: false,
        shadowMode: true,
        v15B1: true,
        adaptiveTTC: true,
        v15B2: true,
        pointerContextOS: true,
      },
      base,
      run: async () => {
        return {
          system: ["base", "<orchestrator>injected</orchestrator>"],
          tools: { read: makeTool() },
          degraded: true,
        }
      },
    })

    expect(result.system).toEqual(base.system)
    expect(Object.keys(result.tools).sort()).toEqual(["bash", "read", "write"])
    expect(result.degraded).toBe(false)
  })
})
