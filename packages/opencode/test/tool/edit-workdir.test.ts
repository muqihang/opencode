import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import path from "path"
import { EditTool } from "../../src/tool/edit"
import { Instance } from "../../src/project/instance"
import { SessionWorktree } from "../../src/worktree/session"
import { FileTime } from "../../src/file/time"
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

describe("tool.edit workdir", () => {
  test("isolated mode edits in session workdir and captures changeset", async () => {
    await using fixture = await tmpdir({
      git: true,
      config: {
        workdir: { primary: "isolated", child: "isolated" },
      },
    })

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const repoPath = path.join(fixture.path, "tracked.txt")
        await Bun.write(repoPath, "before")
        await $`git add tracked.txt`.cwd(fixture.path).quiet()
        await $`git commit -m "tracked"`.cwd(fixture.path).quiet()
        const workdir = await SessionWorktree.ensure({ sessionId: ctx.sessionID })
        FileTime.read(ctx.sessionID, path.join(workdir, "tracked.txt"))

        const tool = await EditTool.init()
        await tool.execute(
          {
            filePath: repoPath,
            oldString: "before",
            newString: "after",
          },
          ctx,
        )

        const isolatedPath = path.join(workdir, "tracked.txt")
        expect(await Bun.file(isolatedPath).text()).toBe("after")
        expect(await Bun.file(repoPath).text()).toBe("before")

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
