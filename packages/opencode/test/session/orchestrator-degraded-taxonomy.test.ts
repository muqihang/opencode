import { describe, expect, test } from "bun:test"
import { EvidenceReader } from "../../src/evidence/reader"
import { buildPlan } from "../../src/session/orchestrator/plan"
import { extractFeatures } from "../../src/session/orchestrator/features"
import { writeOrchestratorArtifacts } from "../../src/session/orchestrator/writer"
import { normalizeOrchestratorDegraded } from "../../src/session/orchestrator/degraded-taxonomy"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("orchestrator degraded taxonomy", () => {
  test("adaptive_ttc degraded event exposes fallback dag fields", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionId = "session-orch-taxonomy-adaptive"
        const messageId = "msg-orch-taxonomy-adaptive"
        const features = extractFeatures({
          uxMode: "deep",
          intentText: "请先核验证据后回答",
          hasFileParts: false,
        })
        const built = await buildPlan({
          sessionId,
          messageId,
          features,
          toolsetFingerprint: "toolset-taxonomy-adaptive",
        })

        const plan = {
          ...built.plan,
          reasons: [
            ...built.plan.reasons,
            { code: "adaptive.ttc.degrade_2_to_1", message: "forced degrade" },
            { code: "adaptive.ttc.breaker.active", message: "forced breaker active" },
            { code: "adaptive.ttc.fallback.unknown_first", message: "forced unknown-first" },
          ],
        }

        await writeOrchestratorArtifacts({
          sessionId,
          plan,
          features,
        })

        const events = await EvidenceReader.readEvents(sessionId, { cursor: 0 })
        const degraded = events.events.find(
          (event) => event.type === "orchestrator.degraded" && event.data?.["stage"] === "adaptive_ttc",
        )

        expect(Boolean(degraded)).toBe(true)
        expect(String(degraded?.data?.["reason"] ?? "").includes("adaptive.ttc.breaker.active")).toBe(true)

        const structured = (degraded?.data ?? {}) as Record<string, unknown>
        expect(Array.isArray(structured["reason_codes"])).toBe(true)
        expect((structured["reason_codes"] as unknown[]).length > 0).toBe(true)
        expect(typeof structured["failure_class"]).toBe("string")
        expect(typeof structured["failure_code"]).toBe("string")
        expect(typeof structured["fallback_from"]).toBe("string")
        expect(typeof structured["fallback_to"]).toBe("string")
        expect(typeof structured["fallback_edge"]).toBe("string")
        expect(typeof structured["retryable"]).toBe("boolean")

        expect(structured["fallback_from"]).toBe("adaptive_ttc_breaker")
        expect(structured["fallback_to"]).toBe("dual_pass_unknown_first")
        expect(structured["fallback_edge"]).toBe("stop")
      },
    })
  })

  test("dual_pass reasons are split and deduplicated into reason_codes", () => {
    const out = normalizeOrchestratorDegraded({
      stage: "dual_pass",
      reason: "fallback=unknown-first; worker status degraded; worker status degraded",
    })

    expect(out.reason_codes).toEqual(["fallback.unknown_first", "worker_status_degraded"])
    expect(out.failure_class).toBe("dual_pass")
    expect(out.fallback_from).toBe("dual_pass_critic")
    expect(out.fallback_to).toBe("dual_pass_unknown_first")
    expect(out.fallback_edge).toBe("degrade")
    expect(out.retryable).toBe(true)
  })

  test("stage fallback rules are stable for processor stages", () => {
    const plan = normalizeOrchestratorDegraded({ stage: "plan", reason: "runtime failure" })
    const turn = normalizeOrchestratorDegraded({ stage: "turn", reason: "runtime failure" })
    const fork = normalizeOrchestratorDegraded({ stage: "fork_task", reason: "runtime failure" })

    expect(plan.failure_class).toBe("plan")
    expect(plan.fallback_from).toBe("plan_builder")
    expect(plan.fallback_to).toBe("orchestrator_bypass")
    expect(plan.fallback_edge).toBe("error")
    expect(plan.retryable).toBe(true)

    expect(turn.failure_class).toBe("turn")
    expect(turn.fallback_from).toBe("orchestrator_turn")
    expect(turn.fallback_to).toBe("pass_through")
    expect(turn.fallback_edge).toBe("error")
    expect(turn.retryable).toBe(true)

    expect(fork.failure_class).toBe("fork_task")
    expect(fork.fallback_from).toBe("fork_task")
    expect(fork.fallback_to).toBe("fork_notice_skip")
    expect(fork.fallback_edge).toBe("error")
    expect(fork.retryable).toBe(true)
  })
})
