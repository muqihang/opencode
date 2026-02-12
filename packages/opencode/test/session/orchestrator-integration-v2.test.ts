import { describe, expect, test } from "bun:test"
import { tool, jsonSchema, type Tool } from "ai"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { EvidenceReader } from "../../src/evidence/reader"
import { Bus } from "../../src/bus"
import { extractFeatures } from "../../src/session/orchestrator/features"
import { buildPlan } from "../../src/session/orchestrator/plan"
import { runOrchestratorTurn } from "../../src/session/orchestrator"
import { WorkerRunner } from "../../src/session/orchestrator/worker-runner"
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


const rolloutFlags = (
  input: Partial<{
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
  }>,
) => ({
  orchestrator: false,
  llmWorkers: false,
  workerBadge: false,
  shadowMode: false,
  orchestratorV15B1: false,
  adaptiveTTC: false,
  orchestratorV15B2: false,
  pointerContextOS: false,
  orchestratorV15A1: false,
  claimGraphGate: false,
  dualPassSynthesis: false,
  ...input,
})

describe("orchestrator integration v2 rollout", () => {
  test("flags matrix keeps subordinate flags invalid when orchestrator is off", async () => {
    const cases = [
      {
        flags: rolloutFlags({
          orchestrator: false,
          llmWorkers: true,
          workerBadge: true,
          shadowMode: true,
        }),
        expected: {
          enabled: false,
          llmWorkers: false,
          workerBadge: false,
          shadowMode: false,
          v15B1: false,
          adaptiveTTC: false,
        },
      },
      {
        flags: rolloutFlags({
          orchestrator: true,
          llmWorkers: false,
          workerBadge: false,
          shadowMode: false,
        }),
        expected: {
          enabled: true,
          llmWorkers: false,
          workerBadge: false,
          shadowMode: false,
          v15B1: false,
          adaptiveTTC: false,
        },
      },
      {
        flags: rolloutFlags({
          orchestrator: true,
          llmWorkers: false,
          workerBadge: true,
          shadowMode: false,
        }),
        expected: {
          enabled: true,
          llmWorkers: false,
          workerBadge: true,
          shadowMode: false,
          v15B1: false,
          adaptiveTTC: false,
        },
      },
      {
        flags: rolloutFlags({
          orchestrator: true,
          llmWorkers: true,
          workerBadge: true,
          shadowMode: true,
        }),
        expected: {
          enabled: true,
          llmWorkers: true,
          workerBadge: true,
          shadowMode: true,
          v15B1: false,
          adaptiveTTC: false,
        },
      },
    ]

    for (const item of cases) {
      const mod = await loadProcessor()
      const rollout = mod.resolveOrchestratorRollout(undefined, item.flags)
      expect(rollout).toMatchObject(item.expected)
    }
  })

  test("planner degraded fallback", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const sessionId = "s-planner-degraded-fallback"
        const messageId = "m-planner-degraded-fallback"
        const features = extractFeatures({
          uxMode: "deep",
          intentText: `请做深度分析 ${"context ".repeat(640)}`,
          hasFileParts: false,
        })
        const built = await buildPlan({
          sessionId,
          messageId,
          features,
          toolsetFingerprint: "toolset-planner-degraded-fallback",
        }).then((item) => item.plan)

        const plan = {
          ...built,
          workers: built.workers.filter((item) => item.id !== "evidence_critic"),
          dualPass: {
            enabled: true,
            criticTimeoutMs: 120,
            unknownFirst: "unknown-first",
          },
        }

        const original = WorkerRunner.run
        const calls: string[] = []

        WorkerRunner.run = (async (input) => {
          calls.push(input.workerId)
          if (input.workerId === "evidence_critic") {
            return {
              result: {
                specVersion: "llm-worker-result/1.0",
                status: "ok",
                notes: ["critic reviewed degraded planners"],
              },
              cache: { status: "miss", tier: "none" },
            }
          }

          return {
            result: {
              specVersion: "llm-worker-result/1.0",
              status: "degraded",
              notes: ["planner degraded"],
              toolRequests: [{ kind: "retrieval", input: "fallback" }],
            },
            cache: { status: "miss", tier: "none" },
          }
        }) as typeof WorkerRunner.run

        try {
          const result = await runOrchestratorTurn({
            sessionId,
            messageId,
            abort: new AbortController().signal,
            plan,
            features,
            intentText: "请继续",
            system: ["base"],
            tools: { read: makeTool() },
          })

          expect(calls.includes("evidence_critic")).toBe(true)
          expect(result.degraded).toBe(true)
          expect(result.system[result.system.length - 1]).toBe("unknown-first")

          const events = await EvidenceReader.readEvents(sessionId, { cursor: 0 })
          const broker = events.events.filter((event) => event.type === "tool_broker.requested")
          const dualPass = events.events.find(
            (event) =>
              event.type === "orchestrator.degraded" &&
              event.data?.stage === "dual_pass" &&
              String(event.data?.reason ?? "").includes("fallback=unknown-first"),
          )
          const planner = events.events.find(
            (event) =>
              event.type === "orchestrator.degraded" &&
              event.data?.stage === "planner" &&
              String(event.data?.reason ?? "").includes("planner_degraded_fallback"),
          )
          expect(broker.length).toBeGreaterThan(0)
          expect(Boolean(dualPass)).toBe(true)
          expect(Boolean(planner)).toBe(false)
        } finally {
          WorkerRunner.run = original
        }
      },
    })
  })

  test("degraded critic can recover after broker pointers are available", async () => {
    await using fixture = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(`${dir}/docs/policy/risk-policy.md`, "block list: SY\n")
        await Bun.write(`${dir}/data/cases/case_risk_sy.json`, '{"case_id":"RISK-007","country":"SY"}\n')
      },
    })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const sessionId = "s-critic-recover"
        const messageId = "m-critic-recover"
        const features = extractFeatures({
          uxMode: "auto",
          intentText: "请做证据审查并给结论",
          hasFileParts: false,
        })
        const built = await buildPlan({
          sessionId,
          messageId,
          features,
          toolsetFingerprint: "toolset-critic-recover",
        }).then((item) => item.plan)

        const plan = {
          ...built,
          dualPass: {
            enabled: true,
            criticTimeoutMs: 120,
            unknownFirst: "unknown-first",
          },
        }

        const original = WorkerRunner.run
        const calls: Array<{ workerId: string; pointers: number }> = []

        WorkerRunner.run = (async (input) => {
          calls.push({ workerId: input.workerId, pointers: input.rolePack.workingSet.pointers.length })
          if (input.workerId === "retrieval_planner") {
            return {
              result: {
                specVersion: "llm-worker-result/1.0",
                status: "ok",
                notes: ["planner requested retrieval"],
                toolRequests: [{ kind: "retrieval", input: "read docs/policy/risk-policy.md" }],
              },
              cache: { status: "miss", tier: "none" },
            }
          }

          if (input.workerId === "evidence_critic" && input.rolePack.workingSet.pointers.length === 0) {
            return {
              result: {
                specVersion: "llm-worker-result/1.0",
                status: "degraded",
                notes: ["need evidence pointers"],
                toolRequests: [{ kind: "retrieval", input: "read docs/policy/risk-policy.md" }],
              },
              cache: { status: "miss", tier: "none" },
            }
          }

          if (input.workerId === "evidence_critic") {
            return {
              result: {
                specVersion: "llm-worker-result/1.0",
                status: "ok",
                notes: ["evidence reviewed with pointers"],
              },
              cache: { status: "miss", tier: "none" },
            }
          }

          return {
            result: {
              specVersion: "llm-worker-result/1.0",
              status: "ok",
            },
            cache: { status: "miss", tier: "none" },
          }
        }) as typeof WorkerRunner.run

        try {
          const result = await runOrchestratorTurn({
            sessionId,
            messageId,
            abort: new AbortController().signal,
            plan,
            features,
            intentText: "请做证据审查并给结论",
            system: ["base"],
            tools: { read: makeTool() },
          })

          const criticCalls = calls.filter((item) => item.workerId === "evidence_critic")
          const events = await EvidenceReader.readEvents(sessionId, { cursor: 0 })
          const turnFail = events.events.filter((event) => event.type === "orchestrator.degraded" && event.data?.stage === "turn")
          const broker = events.events.filter((event) => event.type === "tool_broker.requested")

          expect(criticCalls.length).toBeGreaterThan(1)
          expect(criticCalls.some((item) => item.pointers > 0)).toBe(true)
          expect(result.degraded).toBe(false)
          expect(result.system[result.system.length - 1]).not.toBe("unknown-first")
          expect(turnFail.length).toBe(0)
          expect(broker.length).toBeGreaterThan(0)
        } finally {
          WorkerRunner.run = original
        }
      },
    })
  })

  test("explicit empty working set disables pointer-context recovery", async () => {
    await using fixture = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(`${dir}/docs/policy/risk-policy.md`, "block list: SY\n")
        await Bun.write(`${dir}/data/cases/case_risk_sy.json`, '{"case_id":"RISK-007","country":"SY"}\n')
      },
    })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const sessionId = "s-critic-recover-off"
        const messageId = "m-critic-recover-off"
        const features = extractFeatures({
          uxMode: "auto",
          intentText: "请做证据审查并给结论",
          hasFileParts: false,
        })
        const built = await buildPlan({
          sessionId,
          messageId,
          features,
          toolsetFingerprint: "toolset-critic-recover-off",
        }).then((item) => item.plan)

        const plan = {
          ...built,
          dualPass: {
            enabled: true,
            criticTimeoutMs: 120,
            unknownFirst: "unknown-first",
          },
        }

        const original = WorkerRunner.run
        const calls: Array<{ workerId: string; pointers: number }> = []

        WorkerRunner.run = (async (input) => {
          calls.push({ workerId: input.workerId, pointers: input.rolePack.workingSet.pointers.length })
          if (input.workerId === "retrieval_planner") {
            return {
              result: {
                specVersion: "llm-worker-result/1.0",
                status: "ok",
                notes: ["planner requested retrieval"],
                toolRequests: [{ kind: "retrieval", input: "read docs/policy/risk-policy.md" }],
              },
              cache: { status: "miss", tier: "none" },
            }
          }

          if (input.workerId === "evidence_critic" && input.rolePack.workingSet.pointers.length === 0) {
            return {
              result: {
                specVersion: "llm-worker-result/1.0",
                status: "degraded",
                notes: ["need evidence pointers"],
                toolRequests: [{ kind: "retrieval", input: "read docs/policy/risk-policy.md" }],
              },
              cache: { status: "miss", tier: "none" },
            }
          }

          if (input.workerId === "evidence_critic") {
            return {
              result: {
                specVersion: "llm-worker-result/1.0",
                status: "ok",
                notes: ["evidence reviewed with pointers"],
              },
              cache: { status: "miss", tier: "none" },
            }
          }

          return {
            result: {
              specVersion: "llm-worker-result/1.0",
              status: "ok",
            },
            cache: { status: "miss", tier: "none" },
          }
        }) as typeof WorkerRunner.run

        try {
          const result = await runOrchestratorTurn({
            sessionId,
            messageId,
            abort: new AbortController().signal,
            plan,
            features,
            intentText: "请做证据审查并给结论",
            system: ["base"],
            tools: { read: makeTool() },
            workingSetPointers: [],
          })

          const criticCalls = calls.filter((item) => item.workerId === "evidence_critic")

          expect(criticCalls.length).toBe(1)
          expect(criticCalls[0]?.pointers).toBe(0)
          expect(result.degraded).toBe(true)
        } finally {
          WorkerRunner.run = original
        }
      },
    })
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
      v15B1: false,
      adaptiveTTC: false,
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
    await using fixture = await tmpdir({
      git: true,
      config: {
        experimental: {
          orchestrator_worker_timeout_ms: 2000,
        },
      },
    })
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
            v15B1: false,
            adaptiveTTC: false,
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
  }, 30000)

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
        v15B1: false,
        adaptiveTTC: false,
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
