import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { applyStrictReferenceCheck } from "../../src/session/reference-check"

const lines = (count: number) => Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n")

describe("strict reference-check grounding", () => {
  test("verification intent fails closed on unknown/wildcard/out-of-range references", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "docs"), { recursive: true })
        await Bun.write(path.join(dir, "docs", "policy.md"), lines(12))
      },
    })

    const checked = await applyStrictReferenceCheck({
      intentText: "please run verification and cite evidence",
      text: [
        "结论如下",
        "[evidence: unknown]",
        "[evidence: docs/*.md]",
        "[evidence: docs/policy.md:8-999]",
      ].join("\n"),
      baseDir: tmp.path,
      sessionId: "session-check",
    })

    expect(checked.blocked).toBe(true)
    expect(checked.text).toBe("unknown/evidence_insufficient")
    expect(checked.reasonCodes.includes("unknown_reference")).toBe(true)
    expect(checked.reasonCodes.includes("wildcard_reference")).toBe(true)
    expect(checked.reasonCodes.includes("line_out_of_range")).toBe(true)
  })

  test("verification intent accepts valid file:line and file:line-line references", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "docs"), { recursive: true })
        await Bun.write(path.join(dir, "docs", "policy.md"), lines(16))
      },
    })

    const text = ["证据充分", "[evidence: docs/policy.md:3]", "[evidence: docs/policy.md:8-9]"].join("\n")

    const checked = await applyStrictReferenceCheck({
      intentText: "verification summary",
      text,
      baseDir: tmp.path,
      sessionId: "session-check",
    })

    expect(checked.blocked).toBe(false)
    expect(checked.text).toBe(text)
    expect(checked.reasonCodes.length).toBe(0)
  })

  test("resume/handoff intent also fails closed on invalid references", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "notes"), { recursive: true })
        await Bun.write(path.join(dir, "notes", "handoff.md"), lines(4))
      },
    })

    const checked = await applyStrictReferenceCheck({
      intentText: "resume from handoff capsule",
      text: "[evidence: notes/handoff.md:3-99]",
      baseDir: tmp.path,
      sessionId: "session-check",
    })

    expect(checked.blocked).toBe(true)
    expect(checked.text).toBe("unknown/evidence_insufficient")
    expect(checked.reasonCodes.includes("line_out_of_range")).toBe(true)
  })

  test("normal mode escalates to strict under high-risk evidence-heavy confidence", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "docs"), { recursive: true })
        await Bun.write(path.join(dir, "docs", "policy.md"), lines(6))
      },
    })

    const checked = await applyStrictReferenceCheck({
      intentText: "请直接给最终结论",
      text: "高风险结论但未提供证据",
      baseDir: tmp.path,
      sessionId: "session-check",
      modeResolved: {
        mode: "normal",
        confidence: 0.97,
        reasonCodes: ["intent_not_verification", "high_risk", "evidence_heavy"],
        intent: "请直接给最终结论",
      },
    })

    const structured = {
      mode_resolved: checked.modeResolved.mode,
      confidence: checked.modeResolved.confidence,
      reason_codes: checked.modeResolved.reasonCodes,
    }

    expect(checked.applied).toBe(true)
    expect(checked.blocked).toBe(true)
    expect(checked.text).toBe("unknown/evidence_insufficient")
    expect(structured.mode_resolved).toBe("strict")
    expect(structured.confidence).toBeGreaterThanOrEqual(0.95)
    expect(structured.reason_codes.includes("confidence_escalated_strict")).toBe(true)
  })
})
