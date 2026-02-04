import { describe, expect, test } from "bun:test"
import path from "path"
import { GrepTool } from "../../src/tool/grep"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

const ctx = {
  sessionID: "test",
  messageID: "",
  callID: "call_grep_pointers",
  agent: "build",
  abort: AbortSignal.any([]),
  metadata: () => {},
  ask: async () => {},
}

describe("tool.grep pointers", () => {
  test("writes hits artifact and returns pointer output", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "notes.txt"), "alpha needle beta")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const grep = await GrepTool.init()
        const result = await grep.execute(
          {
            pattern: "needle",
            path: tmp.path,
            outputFormat: "pointers",
          },
          ctx,
        )

        const parsed = JSON.parse(result.output)
        const pointer = parsed.pointers[0]
        expect(pointer.path).toContain(".opencode/artifacts/test/grep/")

        const artifactPath = path.isAbsolute(pointer.path)
          ? pointer.path
          : path.join(tmp.path, pointer.path)
        const artifactText = await Bun.file(artifactPath).text()
        const artifactJson = JSON.parse(artifactText)
        expect(artifactJson.specVersion).toBe("grep-hits/1.0")

        expect(result.metadata.matches).toBeGreaterThan(0)
      },
    })
  })
})
