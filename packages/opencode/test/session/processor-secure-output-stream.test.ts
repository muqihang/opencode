import { describe, expect, test } from "bun:test"
import {
  applyClaimsStreamMask,
  createClaimsStreamMask,
  flushClaimsStreamMask,
} from "../../src/session/processor"

describe("session processor secure-output stream mask", () => {
  test("hides claims block fragments from user-visible stream deltas", () => {
    const parts = [
      "这是前台文本。\n<assistant_claims_",
      'json>{"specVersion":"assistant-claims/1.0","claims":[{"id":"c1","kind":"fact"}]}</assistant_claims_',
      "json>\n结尾文本。",
    ]

    const list: string[] = []
    let state = createClaimsStreamMask()

    for (const part of parts) {
      const masked = applyClaimsStreamMask({ state, delta: part })
      state = masked.state
      if (masked.delta) list.push(masked.delta)
    }

    const tail = flushClaimsStreamMask(state)
    if (tail) list.push(tail)

    const visible = list.join("")
    expect(visible).toContain("这是前台文本")
    expect(visible).toContain("结尾文本")
    expect(visible).not.toContain("assistant_claims_json")
    expect(visible).not.toContain('<assistant_claims_')
    expect(visible).not.toContain('"specVersion":"assistant-claims/1.0"')
  })
})
