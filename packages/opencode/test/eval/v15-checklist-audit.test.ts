import { describe, expect, test } from "bun:test"
import path from "path"
import { runV15ChecklistAudit } from "../../script/v15-checklist-audit"
import type { InvariantAuditReport } from "../../src/session/orchestrator/invariants"

const rootDir = path.resolve(import.meta.dir, "..", "..")

describe("v1.5 checklist audit script", () => {
  test("prints checklist with 已满足 and evidence paths", async () => {
    const logs: string[] = []
    const result = await runV15ChecklistAudit({
      rootDir,
      write: (text) => {
        logs.push(text)
      },
    })

    expect(result.audit.summary.total).toBe(14)
    expect(result.output.includes("证据路径")).toBe(true)
    expect(result.output.includes("已满足")).toBe(true)
    expect(logs.length).toBe(1)
    expect(result.exitCode).toBe(0)
  })

  test("returns non-zero when any invariant is 未满足", async () => {
    const failing: InvariantAuditReport = {
      summary: {
        total: 1,
        satisfied: 0,
        unsatisfied: 1,
      },
      results: [
        {
          id: "I1",
          title: "orchestratorMode=chat 必须 0 worker",
          status: "未满足",
          evidencePaths: ["src/session/orchestrator/plan.ts"],
          probes: [
            {
              path: "src/session/orchestrator/plan.ts",
              note: "forced failure",
              ok: false,
              exists: true,
              missingIncludes: ["missing"],
              hitExcludes: [],
            },
          ],
        },
      ],
    }

    const result = await runV15ChecklistAudit({
      rootDir,
      write: () => {},
      collect: async () => failing,
    })

    expect(result.exitCode).toBe(1)
    expect(result.output.includes("未满足")).toBe(true)
    expect(result.output.includes("证据路径")).toBe(true)
  })
})
