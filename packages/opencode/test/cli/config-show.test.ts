import { describe, expect, test } from "bun:test"
import { renderConfig } from "../../src/cli/cmd/config"

describe("cli.config", () => {
  test("renderConfig returns valid JSON", () => {
    const input = { foo: "bar" }
    const out = renderConfig(input)
    const parsed = JSON.parse(out) as { foo: string }
    expect(parsed.foo).toBe("bar")
  })
})
