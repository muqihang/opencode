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

const timeout = 150_000

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

        const replay = await runOrchestratorTurn({
          sessionId,
          messageId: "m-adaptive-breaker-observe-2",
          abort: new AbortController().signal,
          plan: prepared.plan,
          features: prepared.features,
          intentText: prepared.intentText,
          system: [],
          tools,
        })

        expect(replay).toEqual(turn)

        expect(typeof turn.degraded).toBe("boolean")
        const events = await EvidenceReader.readEvents(sessionId, { cursor: 0 })
        const degraded = events.events.find(
          (item) =>
            item.type === "orchestrator.degraded" &&
            (item.data?.["stage"] === "adaptive_ttc" || item.data?.["stage"] === "adaptive_ttc_breaker") &&
            String(item.data?.["reason"] ?? "").includes("adaptive.ttc.degrade_2_to_1") &&
            String(item.data?.["reason"] ?? "").includes("adaptive.ttc.breaker.active"),
        )

        expect(Boolean(degraded)).toBe(true)
        expect(String(degraded?.data?.["reason"] ?? "").includes("adaptive.ttc.degrade_2_to_1")).toBe(true)
        expect(String(degraded?.data?.["reason"] ?? "").includes("adaptive.ttc.breaker.active")).toBe(true)

        const idem = events.events.find(
          (item) => item.type === "orchestrator.idempotent" && item.data?.["messageId"] === "m-adaptive-breaker-observe-2",
        )

        expect(Boolean(idem)).toBe(true)
        expect(String(idem?.data?.["decision"] ?? "")).toBe("reuse_cached_turn")
        expect(String(idem?.data?.["idempotencyKey"] ?? "")).toBe(
          `${sessionId}:m-adaptive-breaker-observe-2:${prepared.plan.orchestratorPlanId}`,
        )

        const planned = events.events.find(
          (item) => item.type === "orchestrator.planned" && item.data?.["messageId"] === "m-adaptive-breaker-observe-2",
        )
        expect(Boolean(planned)).toBe(true)
        expect(planned?.data?.["specVersion"]).toBe("progress-ledger/1.0")
        expect(planned?.data?.["decision"]).toBe("stop")
        expect(String(planned?.data?.["stopReason"] ?? "").length > 0).toBe(true)
        expect(typeof planned?.data?.["evidence_gain_per_cycle"]).toBe("number")

        const zeroGainStop =
          Number(planned?.data?.["evidence_gain_per_cycle"]) <= 0 &&
          Number(planned?.data?.["newEvidenceCount"]) === 0 &&
          Number(planned?.data?.["coverageGain"]) === 0 &&
          Number(planned?.data?.["duplicateProbeRate"]) >= 1
        expect(zeroGainStop).toBe(true)

        const manifest = await EvidenceReader.readManifest(sessionId)
        const planEntry = manifest.entries.find(
          (item) => item.kind === "orchestrator-plan" && item.path.includes(prepared.plan.orchestratorPlanId),
        )
        expect(Boolean(planEntry)).toBe(true)
        const planFile = path.join(fixture.path, planEntry!.path)
        const plan = await Bun.file(planFile).json()
        expect(Array.isArray(plan.reasons)).toBe(true)
        expect(plan.reasons.some((item: { code: string }) => item.code === "adaptive.ttc.breaker.active")).toBe(true)
        expect(plan.reasons.some((item: { code: string }) => item.code === "adaptive.ttc.breaker.trip")).toBe(true)
      },
    })
  }, { timeout })

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
  }, { timeout })
})
