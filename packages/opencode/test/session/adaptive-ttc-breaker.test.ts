import { describe, expect, test } from "bun:test"
import path from "path"
import { tool, jsonSchema, type Tool } from "ai"
import { EvidenceReader } from "../../src/evidence/reader"
import { Instance } from "../../src/project/instance"
import { prepareOrchestratorPlan } from "../../src/session/orchestrator/prepare"
import { runOrchestratorTurn } from "../../src/session/orchestrator"
import { tmpdir } from "../fixture/fixture"

const deep = (n: number) => `请深度分析并给出方案 ${"context ".repeat(n)}`

const makeTool = (): Tool =>
  tool({
    description: "test tool",
    inputSchema: jsonSchema({ type: "object", properties: {} }),
    execute: async () => ({ output: "", title: "", metadata: {} }),
  })

describe("adaptive ttc breaker", () => {
  test("breaker degrade reason is observable and replayable", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const sessionId = "s-adaptive-breaker-observe"
        const tools = { read: makeTool() }

        await prepareOrchestratorPlan({
          sessionId,
          messageId: "m-adaptive-breaker-observe-1",
          uxMode: "deep",
          messages: [{ role: "user", content: deep(950) }],
          tools,
        })

        const prepared = await prepareOrchestratorPlan({
          sessionId,
          messageId: "m-adaptive-breaker-observe-2",
          uxMode: "deep",
          messages: [{ role: "user", content: deep(950) }],
          tools,
        })

        const turn = await runOrchestratorTurn({
          sessionId,
          messageId: "m-adaptive-breaker-observe-2",
          abort: new AbortController().signal,
          plan: prepared.plan,
          features: prepared.features,
          intentText: prepared.intentText,
          system: [],
          tools,
        })

        expect(turn.degraded).toBe(false)
        expect(turn.system.some((item) => item.includes("<orchestrator>"))).toBe(true)

        const events = await EvidenceReader.readEvents(sessionId, { cursor: 0 })
        const degraded = events.events.find(
          (item) =>
            item.type === "orchestrator.degraded" &&
            (item.data?.["stage"] === "adaptive_ttc" || item.data?.["stage"] === "adaptive_ttc_breaker") &&
            String(item.data?.["reason"] ?? "").includes("adaptive.ttc.degrade_2_to_1"),
        )

        expect(Boolean(degraded)).toBe(true)
        expect(String(degraded?.data?.["reason"] ?? "").includes("adaptive.ttc.degrade_2_to_1")).toBe(true)

        const manifest = await EvidenceReader.readManifest(sessionId)
        const planEntry = manifest.entries.find(
          (item) => item.kind === "orchestrator-plan" && item.path.includes(prepared.plan.orchestratorPlanId),
        )
        expect(Boolean(planEntry)).toBe(true)
        const planFile = path.join(fixture.path, planEntry!.path)
        const plan = await Bun.file(planFile).json()
        expect(Array.isArray(plan.reasons)).toBe(true)
        expect(plan.reasons.some((item: { code: string }) => item.code === "adaptive.ttc.breaker.trip")).toBe(true)
      },
    })
  })

  test("unknown-first and degrade semantics stay intact after breaker", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const sessionId = "s-adaptive-breaker-unknown"
        const tools = { read: makeTool() }

        await prepareOrchestratorPlan({
          sessionId,
          messageId: "m-adaptive-breaker-unknown-1",
          uxMode: "deep",
          messages: [{ role: "user", content: deep(950) }],
          tools,
        })

        const prepared = await prepareOrchestratorPlan({
          sessionId,
          messageId: "m-adaptive-breaker-unknown-2",
          uxMode: "deep",
          messages: [{ role: "user", content: deep(950) }],
          tools,
        })

        expect(prepared.plan.workers.length).toBe(1)

        await runOrchestratorTurn({
          sessionId,
          messageId: "m-adaptive-breaker-unknown-2",
          abort: new AbortController().signal,
          plan: prepared.plan,
          features: prepared.features,
          intentText: prepared.intentText,
          system: [],
          tools,
        })

        const manifest = await EvidenceReader.readManifest(sessionId)
        const rolePackEntry = manifest.entries.find(
          (item) => item.kind === "orchestrator-worker-role-pack" && item.path.includes(prepared.plan.orchestratorPlanId),
        )
        expect(Boolean(rolePackEntry)).toBe(true)
        const packFile = path.join(fixture.path, rolePackEntry!.path)
        const rolePack = await Bun.file(packFile).json()
        expect(rolePack.policy.unknown).toBe("deny")
      },
    })
  })
})
