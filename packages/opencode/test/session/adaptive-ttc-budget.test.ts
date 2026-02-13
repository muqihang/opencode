import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { extractFeatures } from "../../src/session/orchestrator/features"
import { buildPlan } from "../../src/session/orchestrator/plan"
import { tmpdir } from "../fixture/fixture"

const deep = (n: number) => `请深度分析并给出方案 ${"context ".repeat(n)}`

describe("adaptive ttc budget gate", () => {
  test("budget breach degrades 3 -> 2 first", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const features = extractFeatures({
          uxMode: "deep",
          intentText: deep(950),
          hasFileParts: false,
        })

        const out = await buildPlan({
          sessionId: "s-adaptive-budget-first",
          messageId: "m-adaptive-budget-first",
          features,
          toolsetFingerprint: "toolset-adaptive-budget-first",
        })

        expect(out.plan.orchestratorMode).toBe("heavy")
        expect(out.plan.workers.length).toBe(2)
        expect(out.plan.reasons.some((item) => item.code === "adaptive.ttc.degrade_3_to_2")).toBe(true)
        expect(out.plan.reasons.some((item) => item.code === "adaptive.ttc.early_stop")).toBe(true)
        expect(out.plan.reasons.some((item) => item.code === "adaptive.ttc.guard.budget")).toBe(true)
      },
    })
  })

  test("consecutive budget breach degrades 2 -> 1", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const features = extractFeatures({
          uxMode: "deep",
          intentText: deep(950),
          hasFileParts: false,
        })

        await buildPlan({
          sessionId: "s-adaptive-budget-streak",
          messageId: "m-adaptive-budget-streak-1",
          features,
          toolsetFingerprint: "toolset-adaptive-budget-streak",
        })

        const out = await buildPlan({
          sessionId: "s-adaptive-budget-streak",
          messageId: "m-adaptive-budget-streak-2",
          features,
          toolsetFingerprint: "toolset-adaptive-budget-streak",
        })

        expect(out.plan.orchestratorMode).toBe("heavy")
        expect(out.plan.workers.length).toBe(1)
        expect(out.plan.reasons.some((item) => item.code === "adaptive.ttc.degrade_2_to_1")).toBe(true)
        expect(out.plan.reasons.some((item) => item.code === "adaptive.ttc.breaker.active")).toBe(true)
        expect(out.plan.reasons.some((item) => item.code === "adaptive.ttc.breaker.trip")).toBe(true)
        expect(out.plan.reasons.some((item) => item.code === "adaptive.ttc.early_stop")).toBe(true)
      },
    })
  })

  test("budget recovery returns to worker=3 and keeps worker floor", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const high = extractFeatures({
          uxMode: "deep",
          intentText: deep(950),
          hasFileParts: false,
        })
        const low = extractFeatures({
          uxMode: "deep",
          intentText: deep(640),
          hasFileParts: false,
        })

        await buildPlan({
          sessionId: "s-adaptive-budget-recover",
          messageId: "m-adaptive-budget-recover-1",
          features: high,
          toolsetFingerprint: "toolset-adaptive-budget-recover",
        })

        const degraded = await buildPlan({
          sessionId: "s-adaptive-budget-recover",
          messageId: "m-adaptive-budget-recover-2",
          features: high,
          toolsetFingerprint: "toolset-adaptive-budget-recover",
        })

        const recovered = await buildPlan({
          sessionId: "s-adaptive-budget-recover",
          messageId: "m-adaptive-budget-recover-3",
          features: low,
          toolsetFingerprint: "toolset-adaptive-budget-recover",
        })

        expect(degraded.plan.workers.length).toBeGreaterThanOrEqual(1)
        expect(recovered.plan.workers.length).toBe(3)
        expect(recovered.plan.reasons.some((item) => item.code === "adaptive.ttc.breaker.recover")).toBe(true)
      },
    })
  })

  test("message rerun over maxRerun triggers stop", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const features = extractFeatures({
          uxMode: "deep",
          intentText: deep(950),
          hasFileParts: false,
        })

        await buildPlan({
          sessionId: "s-adaptive-budget-max-rerun",
          messageId: "m-adaptive-budget-max-rerun",
          features,
          toolsetFingerprint: "toolset-adaptive-budget-max-rerun-a",
        })

        await buildPlan({
          sessionId: "s-adaptive-budget-max-rerun",
          messageId: "m-adaptive-budget-max-rerun",
          features,
          toolsetFingerprint: "toolset-adaptive-budget-max-rerun-b",
        })

        const out = await buildPlan({
          sessionId: "s-adaptive-budget-max-rerun",
          messageId: "m-adaptive-budget-max-rerun",
          features,
          toolsetFingerprint: "toolset-adaptive-budget-max-rerun-c",
        })

        const budget = out.plan.budgets as Record<string, unknown>
        expect(budget["maxRerun"]).toBe(1)
        expect(out.plan.reasons.some((item) => item.code === "adaptive.ttc.max_rerun.stop")).toBe(true)
        expect(out.plan.reasons.some((item) => item.code === "adaptive.ttc.breaker.active")).toBe(true)
        expect(out.plan.workers.length).toBe(1)
      },
    })
  })
})
