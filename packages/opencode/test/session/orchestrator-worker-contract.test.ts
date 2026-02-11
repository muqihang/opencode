import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { WorkerRunner } from "../../src/session/orchestrator/worker-runner"
import { evidenceCritic } from "../../src/session/orchestrator/workers/evidence-critic"
import { patchPlanner } from "../../src/session/orchestrator/workers/patch-planner"
import { LlmWorkerRolePack } from "../../src/protocol/llm-worker-role-pack"
import { runStructured } from "../../src/session/orchestrator/worker-llm"

const pack = (input: { pointers: string[]; planPointer?: string }) =>
  LlmWorkerRolePack.parse({
    specVersion: "llm-worker-role-pack/1.0",
    planPointer: input.planPointer ?? "orchestrator/plan-test/plan.json",
    policy: { mode: "balanced", unknown: "allow" },
    budget: { timeoutMs: 1000, maxOutputTokens: 256, maxToolCalls: 4 },
    workingSet: { pointers: input.pointers },
  })

describe("orchestrator worker runner", () => {
  test("patch planner no executable output degrades command style guidance", async () => {
    const rolePack = pack({ pointers: ["p-strategy"], planPointer: "orchestrator/patch/no-exec-plan.json" })
    const model = { providerID: "opencode", modelID: "gpt-5-nano" }

    const out = await patchPlanner(
      { rolePack, model },
      {
        run: (async () => ({
          status: "ok" as const,
          object: {
            status: "ok" as const,
            steps: ["Run bun test --bail to verify patch"],
            risks: ["No rollback coverage"],
            prerequisites: ["Plan artifacts are available"],
          },
        })) as typeof runStructured,
        resolveModel: async () => model,
      },
    )

    expect(out.status).toBe("degraded")
    expect(out.notes?.some((note) => note.includes("```"))).toBe(false)
    expect(out.notes?.some((note) => note.startsWith("steps:"))).toBe(true)
    expect(out.notes?.some((note) => note.startsWith("risks:"))).toBe(true)
    expect(out.notes?.some((note) => note.startsWith("prerequisites:"))).toBe(true)
    expect(out.notes?.some((note) => /\b(?:bun|npm|pnpm|yarn|git|cd)\b/i.test(note))).toBe(false)
  })

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



  test("degraded cache hit forces rebuild and can recover", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const count = { value: 0 }
        const rolePack = pack({ pointers: ["p-recover"], planPointer: "orchestrator/cache/recover.json" })
        const compute = async () => {
          count.value += 1
          if (count.value === 1) {
            return {
              specVersion: "llm-worker-result/1.0" as const,
              status: "degraded" as const,
              notes: ["worker degraded: timeout"],
            }
          }
          return {
            specVersion: "llm-worker-result/1.0" as const,
            status: "ok" as const,
            notes: ["recovered"],
          }
        }

        const first = await WorkerRunner.run({
          sessionId: "s-cache-recover",
          workerId: "evidence_critic",
          rolePack,
          compute,
        })
        const second = await WorkerRunner.run({
          sessionId: "s-cache-recover",
          workerId: "evidence_critic",
          rolePack,
          compute,
        })

        expect(first.result.status).toBe("degraded")
        expect(second.result.status).toBe("ok")
        expect(count.value).toBe(2)
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
    const output = await evidenceCritic(
      { rolePack },
      {
        run: (async () => ({
          status: "ok" as const,
          object: {
            status: "ok" as const,
            notes: ["need evidence"],
          },
        })) as typeof runStructured,
      },
    )

    expect(output.toolRequests?.length ?? 0).toBeGreaterThan(0)
    expect(output.toolRequests?.[0]?.kind).toBe("retrieval")
  })
})
