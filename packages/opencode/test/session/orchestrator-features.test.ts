import { describe, expect, test } from "bun:test"
import { extractFeatures, extractScores } from "../../src/session/orchestrator/features"

describe("orchestrator features", () => {
  test("detects write and exec intent", () => {
    const result = extractFeatures({
      uxMode: "fast",
      intentText: "帮我改一下 foo.ts 并运行测试",
      hasFileParts: false,
    })

    expect(result.features.hasWriteIntent).toBe(true)
    expect(result.features.hasExecIntent).toBe(true)
    expect(result.features.hasVerificationIntent).toBe(false)
  })

  test("detects verification intent", () => {
    const result = extractFeatures({
      uxMode: "auto",
      intentText: "请给引用和证据",
      hasFileParts: false,
    })

    expect(result.features.hasVerificationIntent).toBe(true)
  })

  test("negated exec phrasing does not trigger exec intent", () => {
    const result = extractFeatures({
      uxMode: "auto",
      intentText: "只做分析，不执行命令，不运行测试；请给出证据链。",
      hasFileParts: false,
    })

    expect(result.features.hasExecIntent).toBe(false)
    expect(result.features.hasVerificationIntent).toBe(true)
  })

  test("generic decision wording should not trigger exec intent", () => {
    const result = extractFeatures({
      uxMode: "auto",
      intentText: "请执行一次证据优先的业务判定，输出结论与引用。",
      hasFileParts: false,
    })

    expect(result.features.hasExecIntent).toBe(false)
    expect(result.features.hasVerificationIntent).toBe(true)
  })
  test("passes uxMode and parentSessionId", () => {
    const result = extractFeatures({
      uxMode: "deep",
      intentText: "请解释这个函数",
      hasFileParts: true,
      parentSessionId: "parent-1",
    })

    expect(result.features.uxMode).toBe("deep")
    expect(result.features.hasFileParts).toBe(true)
    expect(result.features.parentSessionId).toBe("parent-1")
    expect(result.features.intentBytes).toBeGreaterThan(0)
    expect(result.features.intentTokensEstimate).toBeGreaterThan(0)
  })

  test("file parts can activate write/exec intent for file-operation phrasing", () => {
    const intentText = "请修复我上传文件里的问题并复现结果"
    const withoutFile = extractFeatures({
      uxMode: "auto",
      intentText,
      hasFileParts: false,
    })
    const withFile = extractFeatures({
      uxMode: "auto",
      intentText,
      hasFileParts: true,
    })

    expect(withoutFile.features.hasWriteIntent).toBe(false)
    expect(withoutFile.features.hasExecIntent).toBe(false)
    expect(withFile.features.hasWriteIntent).toBe(true)
    expect(withFile.features.hasExecIntent).toBe(true)
  })

  test("extractScores returns bounded scores and boosts verification workloads", () => {
    const simple = extractScores({
      uxMode: "fast",
      intentText: "解释这个函数",
      hasFileParts: false,
    })

    const verification = extractScores({
      uxMode: "auto",
      intentText: "请检索官方文档并给出引用证据，核验这个结论",
      hasFileParts: false,
    })

    expect(simple.complexity_score).toBeGreaterThanOrEqual(0)
    expect(simple.complexity_score).toBeLessThanOrEqual(1)
    expect(simple.risk_score).toBeGreaterThanOrEqual(0)
    expect(simple.risk_score).toBeLessThanOrEqual(1)
    expect(simple.tool_need_score).toBeGreaterThanOrEqual(0)
    expect(simple.tool_need_score).toBeLessThanOrEqual(1)

    expect(verification.complexity_score).toBeGreaterThan(simple.complexity_score)
    expect(verification.tool_need_score).toBeGreaterThan(simple.tool_need_score)
  })
})
