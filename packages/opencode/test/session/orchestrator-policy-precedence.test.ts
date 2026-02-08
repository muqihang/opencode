import { describe, expect, test } from "bun:test"
import { mergePolicyPrecedence } from "../../src/session/orchestrator/policy"

describe("orchestrator policy precedence", () => {
  test("uses fixed priority core > tenant > plugin > runtime hint", () => {
    const result = mergePolicyPrecedence({
      core: {
        alpha: "deny",
      },
      tenant: {
        alpha: "allow",
        beta: "deny",
      },
      plugin: {
        alpha: "allow",
        beta: "allow",
        gamma: "deny",
      },
      runtimeHint: {
        alpha: "allow",
        beta: "allow",
        gamma: "allow",
        delta: "ask",
      },
    })

    expect(result.policy).toEqual({
      alpha: "deny",
      beta: "deny",
      gamma: "deny",
      delta: "ask",
    })
  })

  test("emits auditable reason when plugin loosens core deny", () => {
    const result = mergePolicyPrecedence({
      core: {
        "tool.exec": "deny",
      },
      plugin: {
        "tool.exec": "allow",
      },
    })

    expect(result.reasons.length).toBe(1)
    expect(result.reasons[0]?.code).toBe("policy_conflict_denied")
    expect(result.reasons[0]?.key).toBe("tool.exec")
    expect(result.reasons[0]?.winner).toBe("core")
  })

  test("does not emit conflict when plugin tightens runtime hint", () => {
    const result = mergePolicyPrecedence({
      plugin: {
        "tool.read": "deny",
      },
      runtimeHint: {
        "tool.read": "allow",
      },
    })

    expect(result.policy["tool.read"]).toBe("deny")
    expect(result.reasons).toEqual([])
  })
})
