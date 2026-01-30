import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import path from "path"
import { Instance } from "../../src/project/instance"
import { SessionWorktree } from "../../src/worktree/session"
import { EvidenceWriter } from "../../src/evidence/writer"
import { captureWorktreePatch } from "../../src/worktree/changes"
import { EvidencePack } from "../../src/protocol/evidence-pack"
import { finalizeChildSession } from "../../src/session/finalizer"
import { tmpdir } from "../fixture/fixture"

function baseDir() {
  return Instance.worktree === "/" ? Instance.directory : Instance.worktree
}

function markerPath(parentSessionId: string, childSessionId: string) {
  return path.join(
    baseDir(),
    ".opencode",
    "artifacts",
    parentSessionId,
    "worktree",
    "merged",
    `${childSessionId}.json`,
  )
}

describe("session child finalizer", () => {
  test("merges child changeset, writes marker, and is idempotent", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        await Bun.write(path.join(fixture.path, "hello.txt"), "base")
        await $`git add hello.txt`.cwd(fixture.path).quiet()
        await $`git commit -m "base"`.cwd(fixture.path).quiet()

        const parentSessionId = "ses_parent_finalizer"
        const childSessionId = "ses_child_finalizer"
        const childWorkdir = await SessionWorktree.ensure({ sessionId: childSessionId })
        await Bun.write(path.join(childWorkdir, "hello.txt"), "child")

        const childWriter = await EvidenceWriter.open({ sessionId: childSessionId })
        await captureWorktreePatch({
          workdir: childWorkdir,
          sessionId: childSessionId,
          writer: childWriter,
        })

        const result = await finalizeChildSession({ parentSessionId, childSessionId })
        expect(result.status).toBe("ok")
        expect(await Bun.file(path.join(fixture.path, "hello.txt")).text()).toBe("child")

        const marker = markerPath(parentSessionId, childSessionId)
        expect(await Bun.file(marker).exists()).toBe(true)

        const packPath = path.join(baseDir(), ".opencode", "evidence", parentSessionId, "pack.json")
        const pack = EvidencePack.parse(JSON.parse(await Bun.file(packPath).text()))
        expect(pack.checks.length).toBeGreaterThan(0)

        const second = await finalizeChildSession({ parentSessionId, childSessionId })
        expect(second.status).toBe("skipped")
      },
    })
  })
})
