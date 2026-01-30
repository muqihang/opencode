import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { toLogicalPath, toWorkdirPath } from "../../src/workdir/paths"
import { tmpdir } from "../fixture/fixture"

describe("workdir.paths", () => {
  test("maps repo paths to logical and workdir paths", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const repoPath = path.join(Instance.worktree, "src", "a.txt")
        const workdir = path.join(Instance.worktree, ".opencode", "worktrees", "S")
        expect(toLogicalPath({ repoPath })).toBe("src/a.txt")
        expect(toWorkdirPath({ repoPath, workdir })).toBe(path.join(workdir, "src", "a.txt"))
      },
    })
  })
})
