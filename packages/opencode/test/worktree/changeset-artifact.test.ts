import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { EvidenceWriter } from "../../src/evidence/writer"
import { EvidenceManifest } from "../../src/protocol/evidence-manifest"
import { SessionWorktree } from "../../src/worktree/session"
import { captureWorktreePatch } from "../../src/worktree/changes"
import { WorktreeChangeSet } from "../../src/worktree/changeset"

describe("worktree changeset artifact", () => {
  test("capture emits patch + changeset manifest", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionId = "changeset"
        const workdir = await SessionWorktree.ensure({ sessionId })
        await Bun.write(path.join(workdir, "alpha.txt"), "one")
        const writer = await EvidenceWriter.open({ sessionId })

        await captureWorktreePatch({ workdir, sessionId, writer })

        const manifestPath = path.join(
          Instance.worktree,
          ".opencode",
          "evidence",
          sessionId,
          "manifest.json",
        )
        const manifest = EvidenceManifest.parse(JSON.parse(await Bun.file(manifestPath).text()))
        const patchEntry = manifest.entries.find((e) => e.kind === "worktree-patch")
        const changesEntry = manifest.entries.find((e) => e.kind === "worktree-changeset")
        expect(patchEntry).toBeDefined()
        expect(changesEntry).toBeDefined()

        const changesPath = path.join(Instance.worktree, changesEntry!.path)
        const changes = WorktreeChangeSet.parse(JSON.parse(await Bun.file(changesPath).text()))
        expect(changes.baseCommit.length).toBeGreaterThan(0)
        expect(changes.dirtyFingerprint.length).toBeGreaterThan(0)
        expect(changes.files.added.length).toBeGreaterThan(0)
        expect(changes.files.added[0]!.sha256.length).toBeGreaterThan(0)
      },
    })
  })
})
