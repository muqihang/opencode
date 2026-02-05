import { describe, expect, test } from "bun:test"
import { resolveForkStrategy } from "../../src/session/orchestrator/policy"

describe("resolveForkStrategy", () => {
  test("defaults to auto when no product mode and no env", () => {
    expect(resolveForkStrategy({ product: undefined, env: undefined })).toBe("auto")
  })

  test("programming mode defaults to suggest", () => {
    expect(resolveForkStrategy({ product: { mode: "programming" }, env: undefined })).toBe("suggest")
  })

  test("explicit product forkStrategy overrides mode default", () => {
    expect(resolveForkStrategy({ product: { mode: "programming", forkStrategy: "auto" }, env: undefined })).toBe("auto")
  })

  test("legal mode honors explicit off", () => {
    expect(resolveForkStrategy({ product: { mode: "legal", forkStrategy: "off" }, env: "auto" })).toBe("off")
  })
})

