import { describe, expect, test } from "bun:test"
import { MessageV2 } from "../../src/session/message-v2"

describe("tool.task micro-pack policy", () => {
  test("micro-pack output includes merge_policy tag", async () => {
    const output = MessageV2.renderMicroPackPointer?.(".opencode/evidence/child/micro-pack.json")
    expect(output).toContain("merge_policy: micro-only")
  })
})
