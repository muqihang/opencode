import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { runOfflineEval } from "../../src/eval/offline"

describe("eval.offline", () => {
  test("produces stable routing/retrieval fingerprints and pointer-only capsule", async () => {
    await using tmp = await tmpdir({ git: true })
    const result = await runOfflineEval({ suite: "offline", rootDir: tmp.path })

    expect(result.kind).toBe("eval")
    expect(result.checks.routingContract.ok).toBe(true)
    expect(result.checks.retrievalDeterminism.ok).toBe(true)
    expect(result.checks.orchestratorPlanDeterminism.ok).toBe(true)
    expect(result.checks.toolBrokerNonInteractive.ok).toBe(true)
    expect(result.checks.compactionPointers.ok).toBe(true)
    expect(result.checks.evidenceChain.ok).toBe(true)
    expect(result.checks.exportEvidenceChain.ok).toBe(true)
  })
})
