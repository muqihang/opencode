import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import {
  applyClaimsStreamMask,
  createClaimsStreamMask,
  flushClaimsStreamMask,
  resolveFrontendTextDelta,
} from "../../src/session/processor"
import { applyStrictReferenceCheck } from "../../src/session/reference-check"
import { tmpdir } from "../fixture/fixture"

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

  test("non-secure stream still masks claims block from frontend deltas", () => {
    const parts = [
      "回答开头。\n<assistant_claims_",
      'json>{"specVersion":"assistant-claims/1.0","claims":[{"id":"c1","kind":"fact","text":"x"}]}</assistant_claims_',
      "json>\n回答结尾。",
    ]

    const list: string[] = []
    let state = createClaimsStreamMask()

    for (const part of parts) {
      const masked = resolveFrontendTextDelta({
        secureMode: null,
        synthetic: false,
        state,
        delta: part,
      })
      state = masked.state
      if (masked.delta) list.push(masked.delta)
    }

    const tail = flushClaimsStreamMask(state)
    if (tail) list.push(tail)

    const visible = list.join("")
    expect(visible).toContain("回答开头")
    expect(visible).toContain("回答结尾")
    expect(visible).not.toContain("assistant_claims_json")
    expect(visible).not.toContain('"specVersion":"assistant-claims/1.0"')
  })

  test("strict reference-check returns structured mode_resolved fields", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "docs"), { recursive: true })
        await Bun.write(path.join(dir, "docs", "proof.md"), "a\nb\n")
      },
    })

    const checked = await applyStrictReferenceCheck({
      intentText: "summary with evidence",
      text: "[evidence: docs/proof.md:1]",
      baseDir: tmp.path,
      sessionId: "session-mode-resolved",
    })

    expect(checked.applied).toBe(true)
    expect(typeof checked.modeResolved.mode).toBe("string")
    expect(typeof checked.modeResolved.confidence).toBe("number")
    expect(Array.isArray(checked.modeResolved.reasonCodes)).toBe(true)
    expect(typeof checked.modeResolved.intent).toBe("string")
  })
})
