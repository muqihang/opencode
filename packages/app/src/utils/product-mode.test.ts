import { describe, expect, test } from "bun:test"
import { MODE_OPTIONS } from "./product-mode"

describe("product mode options", () => {
  test("includes base/programming/legal/marxism", () => {
    const values = MODE_OPTIONS.map((o) => o.value)
    expect(values).toContain("base")
    expect(values).toContain("programming")
    expect(values).toContain("legal")
    expect(values).toContain("marxism")
  })
})

