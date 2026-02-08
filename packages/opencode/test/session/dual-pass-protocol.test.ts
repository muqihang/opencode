import { describe, expect, test } from "bun:test"
import { DualPassCritic, DualPassDraft, DualPassFinal } from "../../src/protocol/dual-pass"

describe("dual-pass protocol", () => {
  test("parses draft -> critic -> final", () => {
    const draft = DualPassDraft.parse({
      specVersion: "dual-pass/1.0",
      stage: "draft",
      text: "draft answer",
    })

    const critic = DualPassCritic.parse({
      specVersion: "dual-pass/1.0",
      stage: "critic",
      verdict: "accept",
      text: "final answer",
    })

    const final = DualPassFinal.parse({
      specVersion: "dual-pass/1.0",
      stage: "final",
      text: critic.text ?? draft.text,
    })

    expect(draft.stage).toBe("draft")
    expect(critic.verdict).toBe("accept")
    expect(final.stage).toBe("final")
    expect(final.text).toBe("final answer")
  })

  test("degrade frame requires reason + fallback", () => {
    expect(() =>
      DualPassFinal.parse({
        specVersion: "dual-pass/1.0",
        stage: "degrade",
        text: "draft answer",
      }),
    ).toThrow()

    const parsed = DualPassFinal.parse({
      specVersion: "dual-pass/1.0",
      stage: "degrade",
      text: "draft answer",
      degrade: {
        from: "critic",
        reason: "critic timeout",
        fallback: "draft",
      },
    })

    expect(parsed.stage).toBe("degrade")
    if (parsed.stage !== "degrade") throw new Error("expected degrade stage")
    expect(parsed.degrade.fallback).toBe("draft")
  })
})
