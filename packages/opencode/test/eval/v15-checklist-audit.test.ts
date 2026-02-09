import { describe, expect, test } from "bun:test"
import path from "path"
import { runV15ChecklistAudit } from "../../script/v15-checklist-audit"
import type { InvariantAuditReport } from "../../src/session/orchestrator/invariants"

const rootDir = path.resolve(import.meta.dir, "..", "..")

describe("v1.6 closeout audit script", () => {
  test("prints milestone status, unmet items, and evidence paths", async () => {
    const logs: string[] = []
    const result = await runV15ChecklistAudit({
      rootDir,
      write: (text) => {
        logs.push(text)
      },
    })

    expect(result.audit.summary.total).toBe(14)
    expect(result.output.includes("里程碑状态")).toBe(true)
    expect(result.output.includes("未满足项")).toBe(true)
    expect(result.output.includes("证据路径")).toBe(true)
    expect(logs.length).toBe(1)
    const expected = result.audit.summary.unsatisfied > 0 ? 1 : 0
    expect(result.exitCode).toBe(expected)
  })

  test("renders milestone rollup and evidence index", async () => {
    const sample: InvariantAuditReport = {
      summary: {
        total: 2,
        satisfied: 1,
        unsatisfied: 1,
      },
      results: [
        {
          id: "I1",
          title: "orchestratorMode=chat 必须 0 worker",
          status: "已满足",
          evidencePaths: ["src/session/orchestrator/plan.ts"],
          probes: [
            {
              path: "src/session/orchestrator/plan.ts",
              note: "ok",
              ok: true,
              exists: true,
              missingIncludes: [],
              hitExcludes: [],
            },
          ],
        },
        {
          id: "I13",
          title: "每 turn 必须有 traceId 且事件可回放",
          status: "未满足",
          evidencePaths: [],
          probes: [
            {
              path: "src/evidence/writer.ts",
              note: "missing",
              ok: false,
              exists: true,
              missingIncludes: ["traceId"],
              hitExcludes: [],
            },
          ],
        },
      ],
    }

    const result = await runV15ChecklistAudit({
      rootDir,
      write: () => {},
      collect: async () => sample,
    })

    expect(result.output.includes("M1 可观测稳定化: 未满足")).toBe(true)
    expect(result.output.includes("M2 双规划器 LLM 化: 未满足")).toBe(true)
    expect(result.output.includes("## 证据路径索引")).toBe(true)
    expect(result.output.includes("src/session/orchestrator/plan.ts")).toBe(true)
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
    expect(result.output.includes("未满足项")).toBe(true)
    expect(result.output.includes("证据路径")).toBe(true)
  })
})
