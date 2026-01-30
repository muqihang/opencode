import { describe, expect, test } from "bun:test"
import path from "path"
import { WriteTool } from "../../src/tool/write"
import { Instance } from "../../src/project/instance"
import { SessionWorktree } from "../../src/worktree/session"
import { EvidenceManifest } from "../../src/protocol/evidence-manifest"
import { tmpdir } from "../fixture/fixture"

const ctx = {
  sessionID: "s1",
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  metadata: () => {},
  ask: async () => {},
}

describe("tool.write workdir", () => {
  test("isolated mode writes to session workdir and captures changeset", async () => {
    await using fixture = await tmpdir({
      git: true,
      config: {
        workdir: { primary: "isolated", child: "isolated" },
      },
    })

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const tool = await WriteTool.init()
        const target = path.join(fixture.path, "hello.txt")
        await tool.execute({ filePath: target, content: "hi" }, ctx)

        const workdir = await SessionWorktree.ensure({ sessionId: ctx.sessionID })
        const isolatedPath = path.join(workdir, "hello.txt")
        const sharedPath = path.join(fixture.path, "hello.txt")
        expect(await Bun.file(isolatedPath).exists()).toBe(true)
        expect(await Bun.file(sharedPath).exists()).toBe(false)

        const manifestPath = path.join(
          Instance.worktree,
          ".opencode",
          "evidence",
          ctx.sessionID,
          "manifest.json",
        )
        const manifest = EvidenceManifest.parse(JSON.parse(await Bun.file(manifestPath).text()))
        const patchEntry = manifest.entries.find((entry) => entry.kind === "worktree-patch")
        const changesEntry = manifest.entries.find((entry) => entry.kind === "worktree-changeset")
        expect(patchEntry).toBeDefined()
        expect(changesEntry).toBeDefined()
      },
    })
  })
})
