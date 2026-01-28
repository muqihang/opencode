import { describe, expect, test } from "bun:test"
import { BashTool } from "../../src/tool/bash"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("tool.bash approval consolidation", () => {
  test("asks at most once per execution", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await BashTool.init()
        const calls: any[] = []
        const ctx = {
          sessionID: "perm_once",
          messageID: "",
          callID: "",
          agent: "build",
          abort: AbortSignal.any([]),
          metadata: () => {},
          ask: async (req: any) => calls.push(req),
        }
        await tool.execute(
          { command: "cat /tmp", description: "Read temp dir (permission merge)" },
          ctx,
        )
        expect(calls.length).toBe(1)
        expect(calls[0].permission).toBe("bash")
        expect(calls[0].metadata).toHaveProperty("external_directories")
        expect(calls[0].metadata).toHaveProperty("bash_patterns")
      },
    })
  })
})
