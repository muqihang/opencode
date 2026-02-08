import { describe, expect, test } from "bun:test"
import { modeFromScores, scoreOrchestrator } from "../../src/session/orchestrator/scorer"

describe("orchestrator scorer", () => {
  test("simple qa routes to chat", () => {
    const scores = scoreOrchestrator({
      uxMode: "fast",
      intentText: "请解释一下这段函数在做什么",
      hasFileParts: false,
      hasWriteIntent: false,
      hasExecIntent: false,
      hasVerificationIntent: false,
      intentTokensEstimate: 12,
    })

    expect(scores.complexity_score).toBeLessThan(0.3)
    expect(scores.risk_score).toBeLessThan(0.35)
    expect(modeFromScores({ uxMode: "fast", scores })).toBe("chat")
  })

  test("verification retrieval routes to assist", () => {
    const scores = scoreOrchestrator({
      uxMode: "auto",
      intentText: "请检索官方文档并给出可核验引用，确认这个 API 是否已废弃",
      hasFileParts: false,
      hasWriteIntent: false,
      hasExecIntent: false,
      hasVerificationIntent: true,
      intentTokensEstimate: 140,
    })

    expect(scores.complexity_score).toBeGreaterThanOrEqual(0.3)
    expect(scores.complexity_score).toBeLessThan(0.6)
    expect(scores.tool_need_score).toBeGreaterThanOrEqual(0.5)
    expect(modeFromScores({ uxMode: "auto", scores })).toBe("assist")
  })

  test("high risk complex request routes to heavy", () => {
    const scores = scoreOrchestrator({
      uxMode: "deep",
      intentText:
        "请根据法律与财务合规要求，制定生产数据库迁移与回滚的多步骤方案，并给出确定结论",
      hasFileParts: true,
      hasWriteIntent: true,
      hasExecIntent: true,
      hasVerificationIntent: true,
      intentTokensEstimate: 420,
    })

    expect(scores.complexity_score).toBeGreaterThanOrEqual(0.6)
    expect(scores.risk_score).toBeGreaterThanOrEqual(0.8)
    expect(modeFromScores({ uxMode: "deep", scores })).toBe("heavy")
  })
})
