import { describe, expect, test } from "bun:test"
import { Bus } from "../../src/bus"
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
        const events: Array<{ phase: string; messageID?: string; planID: string }> = []
        const unsub = Bus.subscribe(OrchestratorEvent.WorkerLifecycle, (event) => {
          if (event.properties.sessionID !== sessionID) return
          if (event.properties.workerID !== workerID) return
          events.push({
            phase: event.properties.phase,
            messageID: event.properties.messageID,
            planID: event.properties.planID,
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
        expect(events[0]?.planID).toBe("plan-events-success")
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
        expect(events[2]?.reason?.includes("compute boom")).toBe(true)
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
})
