import { describe, expect, test } from "bun:test"
import { evaluateOfflineGate } from "../../src/eval/offline-gate"

describe("eval.offline gate", () => {
  test("passes when metrics satisfy fixed thresholds including baseline floor", () => {
    const result = evaluateOfflineGate({
      unsupportedClaimRate: 0.05,
      unknownPrecision: 0.85,
      citationIntegrity: 0.95,
      taskCompletion: 0.87,
      baselineTaskCompletion: 0.9,
    })

    expect(result.specVersion).toBe("offline-eval/1.0")
    expect(result.passed).toBe(true)
    expect(result.checks.taskCompletion.ok).toBe(true)
    expect(result.checks.taskCompletion.threshold).toBe(0.87)
  })

  test("fails when any fixed threshold is violated", () => {
    const result = evaluateOfflineGate({
      unsupportedClaimRate: 0.051,
      unknownPrecision: 0.84,
      citationIntegrity: 0.949,
      taskCompletion: 0.869,
      baselineTaskCompletion: 0.9,
    })

    expect(result.passed).toBe(false)
    expect(result.checks.unsupportedClaimRate.ok).toBe(false)
    expect(result.checks.unknownPrecision.ok).toBe(false)
    expect(result.checks.citationIntegrity.ok).toBe(false)
    expect(result.checks.taskCompletion.ok).toBe(false)
  })
})
