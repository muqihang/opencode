import { describe, expect, test } from "bun:test"
import path from "path"
import { PythonTool } from "../../src/tool/python"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { EventV1 } from "../../src/protocol/event"

const ctx = {
  sessionID: "python_test",
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  metadata: () => {},
  ask: async () => {},
}

describe("tool.python", () => {
  test("runs built-in script via sandbox", async () => {
    const python = Bun.which("python3")
    if (!python) return

    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await PythonTool.init()
        const result = await tool.execute(
          {
            script_id: "summarize-json",
            input_json: { ok: true },
            description: "Summarize JSON",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output_artifact).toBeDefined()

        const eventsPath = path.join(Instance.worktree, ".opencode", "evidence", ctx.sessionID, "events.jsonl")
        const text = await Bun.file(eventsPath).text()
        const types = text
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => EventV1.parse(JSON.parse(line)).type)
        expect(types).toContain("tool.started")
        expect(types).toContain("tool.completed")
      },
    })
  })
})
