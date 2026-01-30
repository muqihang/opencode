import { describe, expect, test } from "bun:test"
import path from "path"
import { BashTool } from "../../src/tool/bash"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionWorktree } from "../../src/worktree/session"
import { tmpdir } from "../fixture/fixture"

const ctx = {
  sessionID: "",
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  metadata: () => {},
  ask: async () => {},
}

describe("tool.bash workdir policy", () => {
  test("primary shared uses project worktree, child isolated uses session worktree", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        workdir: { primary: "shared", child: "isolated" },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()

        const primary = await Session.create({})
        const primaryCtx = { ...ctx, sessionID: primary.id }
        await bash.execute(
          { command: "echo ok > primary.txt", description: "write primary" },
          primaryCtx,
        )
        const primaryShared = path.join(Instance.worktree, "primary.txt")
        const primaryIsolated = path.join(
          await SessionWorktree.ensure({ sessionId: primary.id }),
          "primary.txt",
        )
        expect(await Bun.file(primaryShared).exists()).toBe(true)
        expect(await Bun.file(primaryIsolated).exists()).toBe(false)

        const child = await Session.create({ parentID: primary.id })
        const childCtx = { ...ctx, sessionID: child.id }
        await bash.execute(
          { command: "echo ok > child.txt", description: "write child" },
          childCtx,
        )
        const childShared = path.join(Instance.worktree, "child.txt")
        const childIsolated = path.join(
          await SessionWorktree.ensure({ sessionId: child.id }),
          "child.txt",
        )
        expect(await Bun.file(childShared).exists()).toBe(false)
        expect(await Bun.file(childIsolated).exists()).toBe(true)
      },
    })
  })
})
