import { describe, expect, test } from "bun:test"
import { evaluateOfflineGate } from "../../src/eval/offline-gate"

describe("eval.offline gate", () => {
  test("passes when metrics satisfy fixed thresholds including baseline floor", () => {
    const result = evaluateOfflineGate({
      unsupportedClaimRate: 0.05,
      unknownPrecision: 0.85,
      citationIntegrity: 0.95,
      keyClaimEvidenceIntegrity: 1,
      cacheHitRatio: 0.7,
      taskCompletion: 0.87,
      baselineTaskCompletion: 0.9,
    })

    expect(result.specVersion).toBe("offline-eval/1.0")
    expect(result.passed).toBe(true)
    expect(result.checks.taskCompletion.ok).toBe(true)
    expect(result.checks.taskCompletion.threshold).toBe(0.87)
    expect(result.checks.keyClaimEvidenceIntegrity.ok).toBe(true)
    expect(result.checks.cacheHitRatio.ok).toBe(true)
  })

  test("fails when any fixed threshold is violated", () => {
    const result = evaluateOfflineGate({
      unsupportedClaimRate: 0.051,
      unknownPrecision: 0.84,
      citationIntegrity: 0.949,
      keyClaimEvidenceIntegrity: 0.99,
      cacheHitRatio: 0.69,
      taskCompletion: 0.869,
      baselineTaskCompletion: 0.9,
    })

    expect(result.passed).toBe(false)
    expect(result.checks.unsupportedClaimRate.ok).toBe(false)
    expect(result.checks.unknownPrecision.ok).toBe(false)
    expect(result.checks.citationIntegrity.ok).toBe(false)
    expect(result.checks.keyClaimEvidenceIntegrity.ok).toBe(false)
    expect(result.checks.cacheHitRatio.ok).toBe(false)
    expect(result.checks.taskCompletion.ok).toBe(false)
  })

  test("fails when key claims are missing evidence", () => {
    const result = evaluateOfflineGate({
      unsupportedClaimRate: 0.03,
      unknownPrecision: 0.91,
      citationIntegrity: 0.97,
      keyClaimEvidenceIntegrity: 0.95,
      cacheHitRatio: 0.9,
      taskCompletion: 0.89,
      baselineTaskCompletion: 0.9,
    })

    expect(result.passed).toBe(false)
    expect(result.checks.keyClaimEvidenceIntegrity.ok).toBe(false)
    expect(result.checks.keyClaimEvidenceIntegrity.threshold).toBe(1)
  })

  test("downgrades cache hit ratio to warning when cache gate disabled", () => {
    const result = evaluateOfflineGate({
      unsupportedClaimRate: 0.03,
      unknownPrecision: 0.91,
      citationIntegrity: 0.97,
      keyClaimEvidenceIntegrity: 1,
      cacheHitRatio: 0.4,
      taskCompletion: 0.89,
      baselineTaskCompletion: 0.9,
      enforceCacheHitRatio: false,
    })

    expect(result.passed).toBe(true)
    expect(result.checks.cacheHitRatio.ok).toBe(false)
    expect(result.checks.cacheHitRatio.status).toBe("warn")
  })

  test("fails nightly gate when sample count is below minimum", () => {
    const result = evaluateOfflineGate({
      unsupportedClaimRate: 0.03,
      unknownPrecision: 0.91,
      citationIntegrity: 0.97,
      keyClaimEvidenceIntegrity: 1,
      cacheHitRatio: 0.9,
      taskCompletion: 0.89,
      baselineTaskCompletion: 0.9,
      sampleCount: 49,
      minSampleCount: 50,
    })

    expect(result.passed).toBe(false)
    expect(result.checks.sampleCount.ok).toBe(false)
    expect(result.checks.sampleCount.threshold).toBe(50)
  })

  test("passes nightly gate when sample count reaches minimum", () => {
    const result = evaluateOfflineGate({
      unsupportedClaimRate: 0.03,
      unknownPrecision: 0.91,
      citationIntegrity: 0.97,
      keyClaimEvidenceIntegrity: 1,
      cacheHitRatio: 0.9,
      taskCompletion: 0.89,
      baselineTaskCompletion: 0.9,
      sampleCount: 50,
      minSampleCount: 50,
    })

    expect(result.passed).toBe(true)
    expect(result.checks.sampleCount.ok).toBe(true)
    expect(result.checks.sampleCount.threshold).toBe(50)
  })
})
