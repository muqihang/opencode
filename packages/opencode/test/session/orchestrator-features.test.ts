import { describe, expect, test } from "bun:test"
import { extractFeatures } from "../../src/session/orchestrator/features"

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
})
