import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { LlmWorkerResult } from "../../src/protocol/llm-worker-result"
import { LlmWorkerRolePack } from "../../src/protocol/llm-worker-role-pack"
import { extractFeatures } from "../../src/session/orchestrator/features"
import { buildPlan } from "../../src/session/orchestrator/plan"
import { WorkerSpec } from "../../src/session/orchestrator/worker-spec"
import { patchPlanner } from "../../src/session/orchestrator/workers/patch-planner"
import { retrievalPlanner } from "../../src/session/orchestrator/workers/retrieval-planner"
import { tmpdir } from "../fixture/fixture"

const pack = (input: { pointers: string[]; planPointer?: string }) =>
  LlmWorkerRolePack.parse({
    specVersion: "llm-worker-role-pack/1.0",
    planPointer: input.planPointer ?? "orchestrator/workers-v2/plan.json",
    policy: { mode: "balanced", unknown: "allow" },
    budget: { timeoutMs: 1200, maxOutputTokens: 320, maxToolCalls: 4 },
    workingSet: { pointers: input.pointers },
  })

describe("orchestrator workers v2", () => {
  test("retrieval_planner output is valid", async () => {
    const rolePack = pack({ pointers: [], planPointer: "orchestrator/retrieval-planner/plan.json" })
    const out = await retrievalPlanner({ rolePack })
    const result = LlmWorkerResult.parse(out)

    expect(result.status).toBe("ok")
    expect(result.toolRequests?.[0]).toEqual({
      kind: "retrieval",
      input: "orchestrator/retrieval-planner/plan.json",
    })
  })

  test("patch_planner output is valid", async () => {
    const rolePack = pack({ pointers: ["ptr-a"], planPointer: "orchestrator/patch-planner/plan.json" })
    const out = await patchPlanner({ rolePack })
    const result = LlmWorkerResult.parse(out)

    expect(result.status).toBe("ok")
    expect(result.notes?.length ?? 0).toBeGreaterThan(0)
  })

  test("planner workers do not perform direct side effects", async () => {
    await using fixture = await tmpdir({ git: true })
    const marker = `${fixture.path}/marker.txt`
    await Bun.write(marker, "keep")
    const rolePack = pack({ pointers: [], planPointer: "orchestrator/no-side-effects/plan.json" })

    await retrievalPlanner({ rolePack })
    await patchPlanner({ rolePack })

    const after = await Bun.file(marker).text()
    expect(after).toBe("keep")
  })

  test("worker spec registers planner workers", () => {
    expect(WorkerSpec.get("retrieval_planner")?.id).toBe("retrieval_planner")
    expect(WorkerSpec.get("patch_planner")?.id).toBe("patch_planner")
  })

  test("plan mounts planner workers by orchestrator mode", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const assistFeatures = extractFeatures({
          uxMode: "auto",
          intentText: "请先检索证据并验证结论",
          hasFileParts: false,
        })
        const heavyFeatures = extractFeatures({
          uxMode: "deep",
          intentText: `请做深度分析 ${"context ".repeat(640)}`,
          hasFileParts: false,
        })

        const assist = await buildPlan({
          sessionId: "s-workers-v2-assist",
          messageId: "m-workers-v2-assist",
          features: assistFeatures,
          toolsetFingerprint: "toolset-workers-v2-assist",
        })
        const heavy = await buildPlan({
          sessionId: "s-workers-v2-heavy",
          messageId: "m-workers-v2-heavy",
          features: heavyFeatures,
          toolsetFingerprint: "toolset-workers-v2-heavy",
        })

        expect(assist.plan.orchestratorMode).toBe("assist")
        expect(assist.plan.workers.map((item) => item.id)).toEqual(["retrieval_planner", "evidence_critic"])
        expect(heavy.plan.orchestratorMode).toBe("heavy")
        expect(heavy.plan.workers.map((item) => item.id)).toEqual(["retrieval_planner", "patch_planner"])
      },
    })
  })
})
