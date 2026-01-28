import { describe, expect, test } from "bun:test"
import path from "path"
import { PythonTool } from "../../src/tool/python"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("tool.python env evidence", () => {
  test("writes python version artifact", async () => {
    const python = Bun.which("python3")
    if (!python) return
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await PythonTool.init()
        const ctx = {
          sessionID: "env",
          messageID: "",
          callID: "",
          agent: "build",
          abort: AbortSignal.any([]),
          metadata: () => {},
          ask: async () => {},
        }
        await tool.execute(
          { script_id: "summarize-json", input_json: { ok: true }, description: "Summarize JSON" },
          ctx,
        )
        const versionPath = path.join(
          Instance.worktree,
          ".opencode",
          "artifacts",
          "env",
          "python",
          "python-version.txt",
        )
        const exists = await Bun.file(versionPath).exists()
        expect(exists).toBe(true)
      },
    })
  })
})
