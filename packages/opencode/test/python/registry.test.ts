import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { ScriptRegistry } from "../../src/python/registry"

describe("python.registry", () => {
  test("resolves built-in script id", async () => {
    await Instance.provide({
      directory: path.join(__dirname, "../.."),
      fn: async () => {
        const script = await ScriptRegistry.resolve({ scriptId: "summarize-json" })
        expect(script.id).toBe("summarize-json")
        expect(script.sha256.length).toBe(64)
        expect(script.path.endsWith("summarize-json.py")).toBe(true)
      },
    })
  })

  test("project scripts require explicit config flag", async () => {
    await using tmp = await tmpdir({ config: { python: { allowProjectScripts: false } } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await fs.mkdir(path.join(tmp.path, ".opencode", "scripts"), { recursive: true })
        await Bun.write(path.join(tmp.path, ".opencode", "scripts", "hello.py"), "print('hi')")
        await expect(ScriptRegistry.resolve({ scriptId: "project:hello" })).rejects.toThrow(
          "allowProjectScripts",
        )
      },
    })
  })
})
