import { describe, expect, test } from "bun:test"
import { traceIdForMessageId } from "../../src/util/turn-trace"

describe("turn-trace", () => {
  test("traceIdForMessageId returns stable 16-byte hex", () => {
    const a = traceIdForMessageId("message_1")
    const b = traceIdForMessageId("message_1")
    const c = traceIdForMessageId("message_2")
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a).toMatch(/^[0-9a-f]{32}$/i)
  })
})
