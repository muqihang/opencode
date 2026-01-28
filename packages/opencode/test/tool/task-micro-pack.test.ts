import { describe, expect, test } from "bun:test"
import { MessageV2 } from "../../src/session/message-v2"

describe("tool.task micro-pack", () => {
  test("task output includes micro-pack pointer tag", async () => {
    const output = MessageV2.renderMicroPackPointer?.(".opencode/evidence/child/micro-pack.json")
    expect(output).toContain("micro-pack.json")
  })
})
