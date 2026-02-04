import { describe, expect, test } from "bun:test"
import { tool, jsonSchema, type Tool } from "ai"
import { applyMainTools } from "../../src/session/orchestrator"

const makeTool = (): Tool =>
  tool({
    description: "test tool",
    inputSchema: jsonSchema({ type: "object", properties: {} }),
    execute: async () => ({ output: "", title: "", metadata: {} }),
  })

describe("orchestrator mainTools gating", () => {
  test("undefined or null keeps tools unchanged", () => {
    const tools = { read: makeTool(), write: makeTool() }
    const snapshot = Object.keys(tools).sort()

    const resultUndefined = applyMainTools({ tools, mainTools: undefined })
    expect(Object.keys(resultUndefined).sort()).toEqual(snapshot)
    expect(Object.keys(tools).sort()).toEqual(snapshot)

    const resultNull = applyMainTools({ tools, mainTools: null })
    expect(Object.keys(resultNull).sort()).toEqual(snapshot)
    expect(Object.keys(tools).sort()).toEqual(snapshot)
  })

  test("empty list disables all tools", () => {
    const tools = { read: makeTool(), write: makeTool() }
    const result = applyMainTools({ tools, mainTools: [] })
    expect(Object.keys(result)).toEqual([])
    expect(Object.keys(tools).sort()).toEqual(["read", "write"])
  })

  test("allowlist intersects without adding tools", () => {
    const tools = { read: makeTool(), write: makeTool() }
    const result = applyMainTools({ tools, mainTools: ["read", "glob"] })
    expect(Object.keys(result)).toEqual(["read"])
    expect(Object.keys(tools).sort()).toEqual(["read", "write"])
  })
})
