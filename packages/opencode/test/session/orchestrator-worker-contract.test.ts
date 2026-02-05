import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { WorkerRunner } from "../../src/session/orchestrator/worker-runner"
import { evidenceCritic } from "../../src/session/orchestrator/workers/evidence-critic"
import { LlmWorkerRolePack } from "../../src/protocol/llm-worker-role-pack"

const pack = (input: { pointers: string[]; planPointer?: string }) =>
  LlmWorkerRolePack.parse({
    specVersion: "llm-worker-role-pack/1.0",
    planPointer: input.planPointer ?? "orchestrator/plan-test/plan.json",
    policy: { mode: "balanced", unknown: "allow" },
    budget: { timeoutMs: 1000, maxOutputTokens: 256, maxToolCalls: 4 },
    workingSet: { pointers: input.pointers },
  })

describe("orchestrator worker runner", () => {
  test("cache hit avoids recompute", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const count = { value: 0 }
        const rolePack = pack({ pointers: ["p1"], planPointer: "orchestrator/cache/plan.json" })
        const compute = async () => {
          count.value += 1
          return {
            specVersion: "llm-worker-result/1.0" as const,
            status: "ok" as const,
            notes: ["cached"],
          }
        }

        const first = await WorkerRunner.run({
          sessionId: "s-cache",
          workerId: "evidence_critic",
          rolePack,
          compute,
        })
        const second = await WorkerRunner.run({
          sessionId: "s-cache",
          workerId: "evidence_critic",
          rolePack,
          compute,
        })

        expect(first.result.status).toBe("ok")
        expect(second.result.status).toBe("ok")
        expect(count.value).toBe(1)
      },
    })
  })

  test("verifier degrades unsafe notes", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const rolePack = pack({ pointers: ["p2"], planPointer: "orchestrator/verify/plan.json" })
        const compute = async () => ({
          specVersion: "llm-worker-result/1.0" as const,
          status: "ok" as const,
          notes: ["```bad```"],
        })

        const output = await WorkerRunner.run({
          sessionId: "s-verify",
          workerId: "evidence_critic",
          rolePack,
          compute,
        })

        expect(output.result.status).toBe("degraded")
        expect(output.result.notes?.some((note) => note.includes("```"))).toBe(false)
      },
    })
  })

  test("evidence_critic requests retrieval when working set empty", async () => {
    const rolePack = pack({ pointers: [], planPointer: "orchestrator/empty/plan.json" })
    const output = await evidenceCritic(rolePack)

    expect(output.toolRequests?.length ?? 0).toBeGreaterThan(0)
    expect(output.toolRequests?.[0]?.kind).toBe("retrieval")
  })
})
