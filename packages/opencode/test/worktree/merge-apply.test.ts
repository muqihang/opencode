import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import path from "path"
import { Instance } from "../../src/project/instance"
import { SessionWorktree } from "../../src/worktree/session"
import { EvidenceWriter } from "../../src/evidence/writer"
import { EvidencePack } from "../../src/protocol/evidence-pack"
import { EvidenceManifest } from "../../src/protocol/evidence-manifest"
import { captureWorktreePatch } from "../../src/worktree/changes"
import { WorktreeChangeSet } from "../../src/worktree/changeset"
import { WorktreeMerge } from "../../src/worktree/merge"
import { tmpdir } from "../fixture/fixture"

async function prepareChangeSet(input: {
  childSessionId: string
  repoDir: string
  filePath: string
  content: string
}) {
  const childWorkdir = await SessionWorktree.ensure({ sessionId: input.childSessionId })
  await Bun.write(path.join(childWorkdir, input.filePath), input.content)

  const writer = await EvidenceWriter.open({ sessionId: input.childSessionId })
  await captureWorktreePatch({
    workdir: childWorkdir,
    sessionId: input.childSessionId,
    writer,
  })

  const manifestPath = path.join(
    Instance.worktree,
    ".opencode",
    "evidence",
    input.childSessionId,
    "manifest.json",
  )
  const manifest = EvidenceManifest.parse(JSON.parse(await Bun.file(manifestPath).text()))
  const patchEntry = manifest.entries.find((entry) => entry.kind === "worktree-patch")
  const changesEntry = manifest.entries.find((entry) => entry.kind === "worktree-changeset")
  if (!patchEntry || !changesEntry) throw new Error("missing worktree artifacts")

  const patchPath = path.join(Instance.worktree, patchEntry.path)
  const changeSetPath = path.join(Instance.worktree, changesEntry.path)
  const changeSet = WorktreeChangeSet.parse(JSON.parse(await Bun.file(changeSetPath).text()))

  return {
    childWorkdir,
    patchPath,
    changeSetPath,
    changeSet,
  }
}

describe("worktree merge apply", () => {
  test("applies changeset and validates hashes", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        await Bun.write(path.join(fixture.path, "hello.txt"), "base")
        await $`git add hello.txt`.cwd(fixture.path).quiet()
        await $`git commit -m "base"`.cwd(fixture.path).quiet()

        const parentSessionId = "ses_parent"
        const childSessionId = "ses_child"
        const { patchPath, changeSetPath } = await prepareChangeSet({
          childSessionId,
          repoDir: fixture.path,
          filePath: "hello.txt",
          content: "child",
        })

        const result = await WorktreeMerge.applyChangeSet({
          parentSessionId,
          childSessionId,
          targetDir: fixture.path,
          changeSetPath,
          patchPath,
        })

        expect(result.status).toBe("ok")
        expect(await Bun.file(path.join(fixture.path, "hello.txt")).text()).toBe("child")

        const packPath = path.join(
          Instance.worktree,
          ".opencode",
          "evidence",
          parentSessionId,
          "pack.json",
        )
        const pack = EvidencePack.parse(JSON.parse(await Bun.file(packPath).text()))
        expect(pack.checks.length).toBeGreaterThan(0)
      },
    })
  })

  test("captures conflict artifacts when apply fails", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        await Bun.write(path.join(fixture.path, "conflict.txt"), "base")
        await $`git add conflict.txt`.cwd(fixture.path).quiet()
        await $`git commit -m "base"`.cwd(fixture.path).quiet()

        const parentSessionId = "ses_parent_conflict"
        const childSessionId = "ses_child_conflict"
        const { patchPath, changeSetPath } = await prepareChangeSet({
          childSessionId,
          repoDir: fixture.path,
          filePath: "conflict.txt",
          content: "child",
        })

        await Bun.write(path.join(fixture.path, "conflict.txt"), "target")

        const result = await WorktreeMerge.applyChangeSet({
          parentSessionId,
          childSessionId,
          targetDir: fixture.path,
          changeSetPath,
          patchPath,
        })

        expect(result.status).toBe("conflict")
        if (result.status === "conflict") {
          expect(result.conflictArtifacts.length).toBeGreaterThan(0)
          for (const artifact of result.conflictArtifacts) {
            const absolute = path.join(Instance.worktree, artifact)
            expect(await Bun.file(absolute).exists()).toBe(true)
          }
        }
      },
    })
  })
})
