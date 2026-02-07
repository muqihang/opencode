import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { extractFeatures } from "../../src/session/orchestrator/features"
import { buildPlan } from "../../src/session/orchestrator/plan"
import { tmpdir } from "../fixture/fixture"

const deep = (n: number) => `请深度分析并给出方案 ${"context ".repeat(n)}`

describe("adaptive ttc policy", () => {
  test("default keeps worker=2 for assist", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const features = extractFeatures({
          uxMode: "auto",
          intentText: "请引用证据并验证结论",
          hasFileParts: false,
        })

        const out = await buildPlan({
          sessionId: "s-adaptive-policy-default",
          messageId: "m-adaptive-policy-default",
          features,
          toolsetFingerprint: "toolset-adaptive-policy-default",
        })

        expect(out.plan.orchestratorMode).toBe("assist")
        expect(out.plan.workers.length).toBe(2)
        expect(out.plan.reasons.some((item) => item.code === "adaptive.ttc.default_2")).toBe(true)
      },
    })
  })

  test("deep + high complexity + budget allows worker=3", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const features = extractFeatures({
          uxMode: "deep",
          intentText: deep(640),
          hasFileParts: false,
        })

        const out = await buildPlan({
          sessionId: "s-adaptive-policy-scale",
          messageId: "m-adaptive-policy-scale",
          features,
          toolsetFingerprint: "toolset-adaptive-policy-scale",
        })

        expect(out.plan.orchestratorMode).toBe("heavy")
        expect(out.plan.workers.length).toBe(3)
        expect(out.plan.workers.map((item) => item.id)).toEqual(["retrieval_planner", "patch_planner", "evidence_critic"])
        expect(out.plan.reasons.some((item) => item.code === "adaptive.ttc.scale_3")).toBe(true)
      },
    })
  })

  test("deep + high complexity without budget downgrades back to worker=2", async () => {
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
          sessionId: "s-adaptive-policy-budget",
          messageId: "m-adaptive-policy-budget",
          features,
          toolsetFingerprint: "toolset-adaptive-policy-budget",
        })

        expect(out.plan.orchestratorMode).toBe("heavy")
        expect(out.plan.workers.length).toBe(2)
        expect(out.plan.reasons.some((item) => item.code === "adaptive.ttc.scale_blocked_budget")).toBe(true)
        expect(out.plan.reasons.some((item) => item.code === "adaptive.ttc.degrade_3_to_2")).toBe(true)
      },
    })
  })
})
