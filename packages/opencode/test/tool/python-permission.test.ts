import { describe, expect, test } from "bun:test"
import { PythonTool } from "../../src/tool/python"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import type { PermissionNext } from "../../src/permission/next"

const ctx = {
  sessionID: "perm",
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  metadata: () => {},
  ask: async () => {},
}

describe("tool.python permission", () => {
  test("asks once with merged capability metadata", async () => {
    const python = Bun.which("python3")
    if (!python) return

    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await PythonTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => requests.push(req),
        }
        await tool.execute(
          { script_id: "summarize-json", input_json: { ok: true }, description: "Summarize JSON" },
          testCtx,
        )
        expect(requests.length).toBe(1)
        expect(requests[0].permission).toBe("python")
        expect(requests[0].metadata).toHaveProperty("capability")
      },
    })
  })
})
