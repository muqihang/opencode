import { describe, expect, test } from "bun:test"
import { tool, jsonSchema, type Tool } from "ai"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { EvidenceReader } from "../../src/evidence/reader"
import { Bus } from "../../src/bus"
import { extractFeatures } from "../../src/session/orchestrator/features"
import { buildPlan } from "../../src/session/orchestrator/plan"
import { runOrchestratorTurn } from "../../src/session/orchestrator"
import { OrchestratorEvent } from "../../src/session/orchestrator/event"

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

describe("orchestrator integration v2 rollout", () => {
  test("flags matrix keeps subordinate flags invalid when orchestrator is off", async () => {
    const cases = [
      {
        flags: {
          orchestrator: false,
          llmWorkers: true,
          workerBadge: true,
          shadowMode: true,
        },
        expected: {
          enabled: false,
          llmWorkers: false,
          workerBadge: false,
          shadowMode: false,
        },
      },
      {
        flags: {
          orchestrator: true,
          llmWorkers: false,
          workerBadge: false,
          shadowMode: false,
        },
        expected: {
          enabled: true,
          llmWorkers: false,
          workerBadge: false,
          shadowMode: false,
        },
      },
      {
        flags: {
          orchestrator: true,
          llmWorkers: false,
          workerBadge: true,
          shadowMode: false,
        },
        expected: {
          enabled: true,
          llmWorkers: false,
          workerBadge: true,
          shadowMode: false,
        },
      },
      {
        flags: {
          orchestrator: true,
          llmWorkers: true,
          workerBadge: true,
          shadowMode: true,
        },
        expected: {
          enabled: true,
          llmWorkers: true,
          workerBadge: true,
          shadowMode: true,
        },
      },
    ]

    for (const item of cases) {
      const mod = await loadProcessor()
      const rollout = mod.resolveOrchestratorRollout(undefined, item.flags)
      expect(rollout).toEqual(item.expected)
    }
  })

  test("workers off skips worker execution and keeps base output", async () => {
    const mod = await loadProcessor()
    const baseTools = { read: makeTool(), write: makeTool(), bash: makeTool() }
    const base = { system: ["base"], tools: baseTools }
    const rollout = {
      enabled: true,
      llmWorkers: false,
      workerBadge: false,
      shadowMode: false,
    }
    let calls = 0

    const result = await mod.executeOrchestratorTurnByRollout({
      rollout,
      base,
      run: async () => {
        calls += 1
        return {
          system: ["base", "<orchestrator>injected</orchestrator>"],
          tools: { read: makeTool() },
          degraded: true,
        }
      },
    })

    expect(calls).toBe(0)
    expect(result.system).toEqual(base.system)
    expect(Object.keys(result.tools).sort()).toEqual(["bash", "read", "write"])
    expect(result.degraded).toBe(false)
  })

  test("shadow mode runs workers with lifecycle evidence but does not inject output", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const mod = await loadProcessor()
        const sessionId = "s-orchestrator-shadow"
        const messageId = "m-orchestrator-shadow"
        const intentText = "请先检索证据并验证结论"
        const features = extractFeatures({
          uxMode: "auto",
          intentText,
          hasFileParts: false,
        })
        const plan = await buildPlan({
          sessionId,
          messageId,
          features,
          toolsetFingerprint: "toolset-orchestrator-shadow",
        }).then((item) => item.plan)

        expect(plan.orchestratorMode).toBe("assist")
        expect(plan.toolPolicy.allowed.includes("retrieval")).toBe(true)
        expect(plan.toolPolicy.allowed.includes("write")).toBe(false)
        expect(plan.toolPolicy.allowed.includes("exec")).toBe(false)
        expect(plan.toolPolicy.allowed.includes("ask")).toBe(false)

        const baseTools = { read: makeTool(), write: makeTool(), bash: makeTool() }
        const base = { system: ["<base>system</base>"], tools: baseTools }

        const lifecycle: string[] = []
        const unsub = Bus.subscribe(OrchestratorEvent.WorkerLifecycle, (event) => {
          if (event.properties.sessionID !== sessionId) return
          lifecycle.push(event.properties.phase)
        })

        const result = await mod.executeOrchestratorTurnByRollout({
          rollout: {
            enabled: true,
            llmWorkers: true,
            workerBadge: true,
            shadowMode: true,
          },
          base,
          run: async () =>
            runOrchestratorTurn({
              sessionId,
              messageId,
              abort: new AbortController().signal,
              plan,
              features,
              intentText,
              system: base.system,
              tools: base.tools,
            }),
        })

        unsub()

        expect(result.system).toEqual(base.system)
        expect(Object.keys(result.tools).sort()).toEqual(["bash", "read", "write"])
        expect(result.degraded).toBe(false)

        expect(lifecycle.length).toBeGreaterThan(0)
        const events = await EvidenceReader.readEvents(sessionId, { cursor: 0 })
        const brokerCalls = events.events.filter((event) => event.type === "tool_broker.requested")
        expect(brokerCalls.length).toBeGreaterThan(0)
      },
    })
  })

  test("workers on and shadow off keeps orchestrator injection", async () => {
    const mod = await loadProcessor()
    const baseTools = { read: makeTool(), write: makeTool(), bash: makeTool() }
    const base = { system: ["base"], tools: baseTools }
    let calls = 0

    const result = await mod.executeOrchestratorTurnByRollout({
      rollout: {
        enabled: true,
        llmWorkers: true,
        workerBadge: false,
        shadowMode: false,
      },
      base,
      run: async () => {
        calls += 1
        return {
          system: ["base", "<orchestrator>injected</orchestrator>"],
          tools: { read: makeTool() },
          degraded: false,
        }
      },
    })

    expect(calls).toBe(1)
    expect(result.system).toContain("<orchestrator>injected</orchestrator>")
    expect(Object.keys(result.tools)).toEqual(["read"])
  })
})
