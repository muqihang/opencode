import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { SessionWorktree } from "../../src/worktree/session"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { $ } from "bun"

describe("worktree.session", () => {
  test("creates isolated worktree under .opencode/worktrees/<sessionId>", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const workdir = await SessionWorktree.ensure({ sessionId: "session_test" })
        expect(workdir).toContain(path.join(".opencode", "worktrees", "session_test"))
        const full = path.isAbsolute(workdir) ? workdir : path.join(Instance.worktree, workdir)
        const stat = await fs.stat(full)
        expect(stat.isDirectory()).toBe(true)
      },
    })
  })

  test("falls back when repo has no commits", async () => {
    await using tmp = await tmpdir()
    await $`git init`.quiet().nothrow().cwd(tmp.path)
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const workdir = await SessionWorktree.ensure({ sessionId: "session_empty" })
        expect(workdir).toBe(Instance.directory)
      },
    })
  })
})
