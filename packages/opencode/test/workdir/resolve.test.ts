import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { mapLogicalToWorkdirPath, resolveWorkdirMode, resolveWorkdirPath } from "../../src/workdir/resolve"
import { tmpdir } from "../fixture/fixture"

describe("workdir.resolve", () => {
  test("resolves policy and workdir paths", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        workdir: { primary: "shared", child: "isolated" },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const primary = await resolveWorkdirMode({ kind: "primary" })
        const child = await resolveWorkdirMode({ kind: "child" })
        expect(primary).toBe("shared")
        expect(child).toBe("isolated")

        const sessionId = "s1"
        const isolated = await resolveWorkdirPath({ sessionId, mode: "isolated" })
        const shared = await resolveWorkdirPath({ sessionId, mode: "shared" })
        const expected = path.join(Instance.worktree, ".opencode", "worktrees", sessionId)
        expect(isolated).toBe(expected)
        expect(shared).toBe(Instance.worktree)

        const logical = "src/a.txt"
        const mapped = mapLogicalToWorkdirPath({ logicalPath: logical, workdir: isolated })
        expect(mapped).toBe(path.resolve(isolated, logical))
      },
    })
  })
})
