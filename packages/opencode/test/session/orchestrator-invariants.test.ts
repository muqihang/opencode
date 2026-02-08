import { describe, expect, test } from "bun:test"
import path from "path"
import {
  V15_CORE_INVARIANTS,
  auditInvariantSpecs,
  auditV15CoreInvariants,
  type InvariantAuditReport,
  type InvariantId,
} from "../../src/session/orchestrator/invariants"

const rootDir = path.resolve(import.meta.dir, "..", "..")
const reportPromise = auditV15CoreInvariants({ rootDir })

const pick = (report: InvariantAuditReport, id: InvariantId) => report.results.find((item) => item.id === id)

const expectSatisfied = (report: InvariantAuditReport, id: InvariantId) => {
  const row = pick(report, id)
  expect(row).toBeDefined()
  expect(row?.status).toBe("已满足")
  expect((row?.evidencePaths.length ?? 0) > 0).toBe(true)
}

describe("orchestrator v1.5 core invariants", () => {
  test("contains exactly 14 invariants", () => {
    expect(V15_CORE_INVARIANTS.length).toBe(14)
  })

  test("I1 orchestratorMode=chat must keep zero workers", async () => {
    expectSatisfied(await reportPromise, "I1")
  })

  test("I2 workers must route tool requests through broker", async () => {
    expectSatisfied(await reportPromise, "I2")
  })

  test("I3 tool broker remains non-interactive", async () => {
    expectSatisfied(await reportPromise, "I3")
  })

  test("I4 bounceMax must not exceed 1", async () => {
    expectSatisfied(await reportPromise, "I4")
  })

  test("I5 tool results are pointerized into artifacts", async () => {
    expectSatisfied(await reportPromise, "I5")
  })

  test("I6 mainTools tri-state semantics stay stable", async () => {
    expectSatisfied(await reportPromise, "I6")
  })

  test("I7 unknown-first remains enforced baseline", async () => {
    expectSatisfied(await reportPromise, "I7")
  })

  test("I8 unsupported claims cannot bypass deterministic gate", async () => {
    expectSatisfied(await reportPromise, "I8")
  })

  test("I9 plugin cannot replace core control flow", async () => {
    expectSatisfied(await reportPromise, "I9")
  })

  test("I10 core policy precedence dominates plugin policy", async () => {
    expectSatisfied(await reportPromise, "I10")
  })

  test("I11 side-effect intents must fork sub session", async () => {
    expectSatisfied(await reportPromise, "I11")
  })

  test("I12 cache key contains schema and versioned policy dimensions", async () => {
    expectSatisfied(await reportPromise, "I12")
  })

  test("I13 each turn keeps traceId and replay contract", async () => {
    expectSatisfied(await reportPromise, "I13")
  })

  test("I14 plugin compatibility matrix check is required", async () => {
    expectSatisfied(await reportPromise, "I14")
  })

  test("reports 未满足 when evidence token is missing", async () => {
    const report = await auditInvariantSpecs({
      rootDir,
      specs: [
        {
          id: "I1",
          title: "probe failure",
          probes: [
            {
              path: "src/session/orchestrator/plan.ts",
              note: "missing token should fail",
              includes: ["__token_that_will_never_exist__"],
            },
          ],
        },
      ],
    })

    expect(report.summary.total).toBe(1)
    expect(report.summary.unsatisfied).toBe(1)
    expect(report.results[0]?.status).toBe("未满足")
  })
})
