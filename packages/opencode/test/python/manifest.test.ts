import { describe, expect, test } from "bun:test"
import { ScriptRegistry } from "../../src/python/registry"

describe("python.scripts manifest", () => {
  test("manifest includes summarize-json with sha256", async () => {
    const manifest = await ScriptRegistry.manifest()
    const entry = manifest.find((x) => x.id === "summarize-json")
    expect(entry).toBeDefined()
    expect(entry!.sha256.length).toBe(64)
  })

  test("manifest includes toolbelt scripts", async () => {
    const manifest = await ScriptRegistry.manifest()
    const scriptIds = ["citation-check", "doc-quote-anchor", "table-check", "redaction-scan"]
    for (const id of scriptIds) {
      const entry = manifest.find((item) => item.id === id)
      expect(entry).toBeDefined()
      expect(entry!.sha256.length).toBe(64)
      expect(entry!.path.endsWith(".py")).toBe(true)
    }
  })
})
