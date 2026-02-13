import { describe, expect, test } from "bun:test"
import { Bus } from "../../src/bus"
import { EvidenceReader } from "../../src/evidence/reader"
import { Instance } from "../../src/project/instance"
import { LlmWorkerRolePack } from "../../src/protocol/llm-worker-role-pack"
import { OrchestratorEvent } from "../../src/session/orchestrator/event"
import { WorkerRunner } from "../../src/session/orchestrator/worker-runner"
import { tmpdir } from "../fixture/fixture"

const pack = (input: { pointers: string[]; planPointer?: string }) =>
  LlmWorkerRolePack.parse({
    specVersion: "llm-worker-role-pack/1.0",
    planPointer: input.planPointer ?? "orchestrator/plan-events/plan.json",
    policy: { mode: "balanced", unknown: "allow" },
    budget: { timeoutMs: 1000, maxOutputTokens: 256, maxToolCalls: 4 },
    workingSet: { pointers: input.pointers },
  })

describe("orchestrator worker runner lifecycle events", () => {
  test("emits planned/running/completed on success", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const sessionID = "s-events-success"
        const workerID = "evidence_critic"
        const rolePack = pack({ pointers: ["ptr-1"], planPointer: "orchestrator/plan-events-success/plan.json" })
        const events: Array<{
          phase: string
          messageID?: string
          messageId?: string
          planID?: string
          planId?: string
          workerID?: string
          workerId?: string
        }> = []
        const unsub = Bus.subscribe(OrchestratorEvent.WorkerLifecycle, (event) => {
          if (event.properties.sessionID !== sessionID) return
          if (event.properties.workerID !== workerID) return
          events.push({
            phase: event.properties.phase,
            messageID: event.properties.messageID,
            messageId: event.properties.messageId,
            planID: event.properties.planID,
            planId: event.properties.planId,
            workerID: event.properties.workerID,
            workerId: event.properties.workerId,
          })
        })

        const output = await WorkerRunner.run({
          sessionId: sessionID,
          messageId: "m-events-success",
          workerId: workerID,
          rolePack,
          compute: async () => ({
            specVersion: "llm-worker-result/1.0",
            status: "ok",
            notes: ["ok"],
          }),
        })

        unsub()

        expect(output.result.status).toBe("ok")
        expect(events.map((item) => item.phase)).toEqual(["planned", "running", "completed"])
        expect(events[0]?.messageID).toBe("m-events-success")
        expect(events[0]?.messageId).toBe("m-events-success")
        expect(events[0]?.planID).toBe("plan-events-success")
        expect(events[0]?.planId).toBe("plan-events-success")
        expect(events[0]?.workerID).toBe(workerID)
        expect(events[0]?.workerId).toBe(workerID)
      },
    })
  })

  test("emits degraded phase when compute fails", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const sessionID = "s-events-degraded"
        const workerID = "evidence_critic"
        const rolePack = pack({ pointers: ["ptr-1"], planPointer: "orchestrator/plan-events-degraded/plan.json" })
        const events: Array<{ phase: string; reason?: string }> = []
        const unsub = Bus.subscribe(OrchestratorEvent.WorkerLifecycle, (event) => {
          if (event.properties.sessionID !== sessionID) return
          if (event.properties.workerID !== workerID) return
          events.push({
            phase: event.properties.phase,
            reason: event.properties.reason,
          })
        })

        const output = await WorkerRunner.run({
          sessionId: sessionID,
          messageId: "m-events-degraded",
          workerId: workerID,
          rolePack,
          compute: async () => {
            throw new Error("compute boom")
          },
        })

        unsub()

        expect(output.result.status).toBe("degraded")
        expect(events.map((item) => item.phase)).toEqual(["planned", "running", "degraded"])
        expect(events[2]?.reason).toBe("worker_compute_failed")
      },
    })
  })

  test("cache hit event includes cache metadata", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const sessionID = "s-events-cache"
        const workerID = "evidence_critic"
        const rolePack = pack({ pointers: ["ptr-1"], planPointer: "orchestrator/plan-events-cache/plan.json" })
        const events: Array<{ phase: string; cache?: { status: string; tier: string } }> = []
        const unsub = Bus.subscribe(OrchestratorEvent.WorkerLifecycle, (event) => {
          if (event.properties.sessionID !== sessionID) return
          if (event.properties.workerID !== workerID) return
          events.push({
            phase: event.properties.phase,
            cache: event.properties.cache,
          })
        })

        await WorkerRunner.run({
          sessionId: sessionID,
          messageId: "m-events-cache",
          workerId: workerID,
          rolePack,
          compute: async () => ({
            specVersion: "llm-worker-result/1.0",
            status: "ok",
            notes: ["ok"],
          }),
        })

        await WorkerRunner.run({
          sessionId: sessionID,
          messageId: "m-events-cache",
          workerId: workerID,
          rolePack,
          compute: async () => ({
            specVersion: "llm-worker-result/1.0",
            status: "ok",
            notes: ["ok"],
          }),
        })

        unsub()

        const completed = events.filter((item) => item.phase === "completed")
        const hit = completed.find((item) => item.cache?.status === "hit")
        expect(hit?.cache?.tier === "memory" || hit?.cache?.tier === "disk").toBe(true)
      },
    })
  })

  test("writes lifecycle events into evidence for replay", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const sessionID = "s-events-evidence"
        const workerID = "evidence_critic"
        const messageID = "m-events-evidence"
        const rolePack = pack({ pointers: ["ptr-1"], planPointer: "orchestrator/plan-events-evidence/plan.json" })

        await WorkerRunner.run({
          sessionId: sessionID,
          messageId: messageID,
          workerId: workerID,
          rolePack,
          compute: async () => ({
            specVersion: "llm-worker-result/1.0",
            status: "ok",
            notes: ["ok"],
          }),
        })

        const evidence = await EvidenceReader.readEvents(sessionID, { cursor: 0, limit: 200 })
        const lifecycle = evidence.events.filter((item) => item.type === "orchestrator.worker.lifecycle")

        expect(lifecycle.length).toBeGreaterThanOrEqual(3)
        expect(lifecycle.every((item) => item.data?.messageID === messageID)).toBe(true)
        expect(lifecycle.every((item) => item.data?.messageId === messageID)).toBe(true)
        expect(lifecycle.every((item) => item.data?.planID === "plan-events-evidence")).toBe(true)
        expect(lifecycle.every((item) => item.data?.planId === "plan-events-evidence")).toBe(true)
        expect(lifecycle.every((item) => item.data?.workerID === workerID)).toBe(true)
        expect(lifecycle.every((item) => item.data?.workerId === workerID)).toBe(true)
      },
    })
  })

  test("unknown worker emits skipped", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const sessionID = "s-events-skip"
        const rolePack = pack({ pointers: ["ptr-1"], planPointer: "orchestrator/plan-events-skip/plan.json" })
        const phases: string[] = []
        const unsub = Bus.subscribe(OrchestratorEvent.WorkerLifecycle, (event) => {
          if (event.properties.sessionID !== sessionID) return
          phases.push(event.properties.phase)
        })

        const output = await WorkerRunner.run({
          sessionId: sessionID,
          messageId: "m-events-skip",
          workerId: "unknown_worker",
          rolePack,
        })

        unsub()

        expect(output.result.status).toBe("degraded")
        expect(phases).toEqual(["planned", "skipped"])
      },
    })
  })

  test("invalid role pack emits degraded lifecycle", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const sessionID = "s-events-invalid"
        const phases: string[] = []
        const unsub = Bus.subscribe(OrchestratorEvent.WorkerLifecycle, (event) => {
          if (event.properties.sessionID !== sessionID) return
          phases.push(event.properties.phase)
        })

        const bad = {
          specVersion: "llm-worker-role-pack/1.0",
          planPointer: "orchestrator/plan-events-invalid/plan.json",
          policy: { mode: "balanced", unknown: "allow" },
          budget: { timeoutMs: 1000, maxOutputTokens: 256, maxToolCalls: 4 },
          workingSet: {},
        }

        const output = await WorkerRunner.run({
          sessionId: sessionID,
          messageId: "m-events-invalid",
          workerId: "evidence_critic",
          rolePack: bad as unknown as LlmWorkerRolePack,
        })

        unsub()

        expect(output.result.status).toBe("degraded")
        expect(phases).toEqual(["planned", "degraded"])
      },
    })
  })

test("degraded lifecycle includes model route observability fields", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const sessionID = "s-events-route"
        const workerID = "evidence_critic"
        const rolePack = pack({ pointers: ["ptr-1"], planPointer: "orchestrator/plan-events-route/plan.json" })
        const events: Array<{
          phase: string
          reason?: string
          fromModel?: string
          toModel?: string
          gateReason?: string
          routeFromModel?: string
          routeToModel?: string
          routeGateReason?: string
          summary?: string
        }> = []
        const unsub = Bus.subscribe(OrchestratorEvent.WorkerLifecycle, (event) => {
          if (event.properties.sessionID !== sessionID) return
          if (event.properties.workerID !== workerID) return
          events.push({
            phase: event.properties.phase,
            reason: event.properties.reason,
            fromModel: event.properties.fromModel,
            toModel: event.properties.toModel,
            gateReason: event.properties.gateReason,
            routeFromModel: event.properties.routeFromModel,
            routeToModel: event.properties.routeToModel,
            routeGateReason: event.properties.routeGateReason,
            summary: event.properties.summary,
          })
        })

        const output = await WorkerRunner.run({
          sessionId: sessionID,
          messageId: "m-events-route",
          workerId: workerID,
          rolePack,
          compute: async () => ({
            specVersion: "llm-worker-result/1.0",
            status: "degraded",
            notes: [
              "worker degraded: error",
              "from_model=openai/gpt-5",
              "to_model=opencode/gpt-5-nano",
              "gate_reason=error_degraded",
            ],
          }),
        })

        unsub()

        expect(output.result.status).toBe("degraded")
        const degraded = events.find((item) => item.phase === "degraded")
        expect(degraded?.reason).toBe("worker_degraded")
        expect(degraded?.summary).toBe("worker degraded: error")
        expect(degraded?.fromModel).toBe("openai/gpt-5")
        expect(degraded?.toModel).toBe("opencode/gpt-5-nano")
        expect(degraded?.gateReason).toBe("error_degraded")
        expect(degraded?.routeFromModel).toBe("openai/gpt-5")
        expect(degraded?.routeToModel).toBe("opencode/gpt-5-nano")
        expect(degraded?.routeGateReason).toBe("error_degraded")

        const evidence = await EvidenceReader.readEvents(sessionID, { cursor: 0, limit: 200 })
        const lifecycle = evidence.events.filter((item) => item.type === "orchestrator.worker.lifecycle")
        const record = lifecycle
          .map((item) => item.data)
          .find((item) => item?.phase === "degraded" && item?.workerID === workerID)
        expect(record?.fromModel).toBe("openai/gpt-5")
        expect(record?.toModel).toBe("opencode/gpt-5-nano")
        expect(record?.gateReason).toBe("error_degraded")
        expect(record?.routeFromModel).toBe("openai/gpt-5")
        expect(record?.routeToModel).toBe("opencode/gpt-5-nano")
        expect(record?.routeGateReason).toBe("error_degraded")
      },
    })
  })
})
