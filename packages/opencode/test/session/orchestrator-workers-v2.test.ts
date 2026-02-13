import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { LlmWorkerResult } from "../../src/protocol/llm-worker-result"
import { LlmWorkerRolePack } from "../../src/protocol/llm-worker-role-pack"
import { extractFeatures } from "../../src/session/orchestrator/features"
import { buildPlan } from "../../src/session/orchestrator/plan"
import { WorkerSpec } from "../../src/session/orchestrator/worker-spec"
import { patchPlanner } from "../../src/session/orchestrator/workers/patch-planner"
import { buildWorkerSystemPrompt, WorkerPromptRegistry } from "../../src/session/orchestrator/workers/prompt-registry"
import { retrievalPlanner } from "../../src/session/orchestrator/workers/retrieval-planner"
import { runStructured } from "../../src/session/orchestrator/worker-llm"
import { tmpdir } from "../fixture/fixture"

const pack = (input: { pointers: string[]; planPointer?: string }) =>
  LlmWorkerRolePack.parse({
    specVersion: "llm-worker-role-pack/1.0",
    planPointer: input.planPointer ?? "orchestrator/workers-v2/plan.json",
    policy: { mode: "balanced", unknown: "allow" },
    budget: { timeoutMs: 1200, maxOutputTokens: 320, maxToolCalls: 4 },
    workingSet: { pointers: input.pointers },
  })

const model = {
  providerID: "opencode",
  modelID: "gpt-5-nano",
}

describe("orchestrator workers v2", () => {
  test("planner prompt templates are versioned in registry", () => {
    expect(WorkerPromptRegistry.retrieval_planner.version).toBe("v1")
    expect(WorkerPromptRegistry.patch_planner.version).toBe("v1")
    expect(WorkerPromptRegistry.evidence_critic.version).toBe("v1")
  })

  test("retrieval_planner output is valid", async () => {
    const rolePack = pack({ pointers: [], planPointer: "orchestrator/retrieval-planner/plan.json" })
    const seen: string[] = []
    const out = await retrievalPlanner(
      { rolePack, model },
      {
        run: (async (req) => {
          const data = req as { messages: Array<{ role: string; content: string }> }
          const system = data.messages.find((item) => item.role === "system")
          seen.push(system?.content ?? "")

          return {
            status: "ok" as const,
            object: {
              status: "ok" as const,
              notes: ["retrieval planned"],
              toolRequests: [{ kind: "retrieval" as const, input: rolePack.planPointer }],
            },
          }
        }) as typeof runStructured,
      },
    )
    const result = LlmWorkerResult.parse(out)

    expect(result.status).toBe("ok")
    expect(result.toolRequests?.[0]).toEqual({
      kind: "retrieval",
      input: "orchestrator/retrieval-planner/plan.json",
    })
    expect(seen[0]).toBe(buildWorkerSystemPrompt("retrieval_planner"))
    expect(seen[0]).toContain("template_version=v1")
  })

  test("retrieval planner llm fallback", async () => {
    const rolePack = pack({ pointers: [], planPointer: "orchestrator/retrieval-planner/fallback.json" })
    const out = await retrievalPlanner(
      { rolePack, model },
      {
        run: (async () => ({
          status: "degraded",
          reason: "schema",
          object: {
            status: "degraded" as const,
            notes: ["worker degraded: schema"],
          },
        })) as typeof runStructured,
      },
    )

    expect(out.status).toBe("degraded")
    expect(out.toolRequests?.[0]).toEqual({
      kind: "retrieval",
      input: "orchestrator/retrieval-planner/fallback.json",
    })
    expect(out.notes?.some((item) => item.includes("worker degraded: schema"))).toBe(true)
  })

  test("retrieval planner normalizes deepseek drift output", async () => {
    const rolePack = pack({ pointers: [], planPointer: "orchestrator/retrieval-planner/primary.json" })
    const out = await retrievalPlanner(
      { rolePack, model },
      {
        run: (async () => ({
          status: "ok" as const,
          object: {
            status: "needs_more",
            notes: "need more context",
            tool_requests: [{ type: "retrieval", query: "cross-check policy evidence", confidence: 0.2 }],
            trace: "deepseek-r1",
          },
        })) as typeof runStructured,
      },
    )

    expect(out.status).toBe("degraded")
    expect(out.notes?.some((item) => item.includes("need more context"))).toBe(true)
    expect(out.notes?.some((item) => item.includes("schema invalid"))).toBe(false)
    expect(out.toolRequests).toEqual([{ kind: "retrieval", input: "cross-check policy evidence" }])
  })

  test("retrieval planner normalizes camelCase status and object tool request", async () => {
    const rolePack = pack({ pointers: [], planPointer: "orchestrator/retrieval-planner/primary.json" })
    const out = await retrievalPlanner(
      { rolePack, model },
      {
        run: (async () => ({
          status: "ok" as const,
          object: {
            status: "needsMore",
            notes: ["need more context"],
            tool_requests: { type: "retrieval", query: "cross-check policy evidence", confidence: 0.2 },
            trace: "deepseek-r2",
          },
        })) as typeof runStructured,
      },
    )

    expect(out.status).toBe("degraded")
    expect(out.notes?.some((item) => item.includes("schema invalid"))).toBe(false)
    expect(out.toolRequests).toEqual([{ kind: "retrieval", input: "cross-check policy evidence" }])
  })

  test("patch_planner output is valid", async () => {
    const rolePack = pack({ pointers: ["ptr-a"], planPointer: "orchestrator/patch-planner/plan.json" })
    const seen: string[] = []
    const out = await patchPlanner(
      { rolePack, model },
      {
        run: (async (req) => {
          const data = req as { messages: Array<{ role: string; content: string }> }
          const system = data.messages.find((item) => item.role === "system")
          seen.push(system?.content ?? "")

          return {
            status: "ok" as const,
            object: {
              status: "ok" as const,
              steps: ["Analyze target files and define edit order."],
              risks: ["Policy drift might invalidate the planned patch scope."],
              prerequisites: ["Role pack pointers are available before drafting edits."],
            },
          }
        }) as typeof runStructured,
      },
    )
    const result = LlmWorkerResult.parse(out)

    expect(result.status).toBe("ok")
    expect(result.notes?.some((item) => item.startsWith("steps:"))).toBe(true)
    expect(result.notes?.some((item) => item.startsWith("risks:"))).toBe(true)
    expect(result.notes?.some((item) => item.startsWith("prerequisites:"))).toBe(true)
    expect(result.notes?.some((item) => item.includes("```"))).toBe(false)
    expect(result.notes?.some((item) => /\b(?:bun|npm|pnpm|yarn|git)\b/i.test(item))).toBe(false)
    expect(seen[0]).toBe(buildWorkerSystemPrompt("patch_planner"))
    expect(seen[0]).toContain("template_version=v1")
  })

  test("planner workers do not perform direct side effects", async () => {
    await using fixture = await tmpdir({ git: true })
    const marker = `${fixture.path}/marker.txt`
    await Bun.write(marker, "keep")
    const rolePack = pack({ pointers: [], planPointer: "orchestrator/no-side-effects/plan.json" })

    await retrievalPlanner(
      { rolePack, model },
      {
        run: (async () => ({
          status: "ok" as const,
          object: {
            status: "ok" as const,
            notes: ["retrieval planned"],
            toolRequests: [{ kind: "retrieval" as const, input: rolePack.planPointer }],
          },
        })) as typeof runStructured,
      },
    )
    await patchPlanner(
      { rolePack, model },
      {
        run: (async () => ({
          status: "ok" as const,
          object: {
            status: "ok" as const,
            steps: ["Outline file-level patch strategy without execution details."],
            risks: ["Scope ambiguity can impact patch precision."],
            prerequisites: ["Policy and evidence pointers are loaded before planning."],
          },
        })) as typeof runStructured,
      },
    )

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
        expect(heavy.plan.workers.map((item) => item.id)).toEqual([
          "retrieval_planner",
          "patch_planner",
          "evidence_critic",
        ])
      },
    })
  })
})
