import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { Instance } from "../../src/project/instance"
import { SessionWorktree } from "../../src/worktree/session"
import { EvidenceWriter } from "../../src/evidence/writer"
import { captureWorktreePatch } from "../../src/worktree/changes"
import { finalizeChildSession } from "../../src/session/finalizer"
import { ContextLedger } from "../../src/session/context-ledger"
import { tmpdir } from "../fixture/fixture"
import { Log } from "../../src/util/log"

Log.init({ print: false })

function baseDir() {
  return Instance.worktree === "/" ? Instance.directory : Instance.worktree
}

function sha256(text: string) {
  const hash = new Bun.CryptoHasher("sha256")
  hash.update(text)
  return hash.digest("hex")
}

describe("session handoff capsule", () => {
  test("writes handoff capsule artifact + event + ledger entry on child finalization", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        await Bun.write(path.join(fixture.path, "hello.txt"), "base")
        await $`git add hello.txt`.cwd(fixture.path).quiet()
        await $`git commit -m "base"`.cwd(fixture.path).quiet()

        const parentSessionId = "ses_parent_handoff"
        const childSessionId = "ses_child_handoff"

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

        const capsuleAbs = path.join(
          baseDir(),
          ".opencode",
          "artifacts",
          parentSessionId,
          "handoff",
          childSessionId,
          "capsule.handoff.json",
        )
        expect(await Bun.file(capsuleAbs).exists()).toBe(true)

        const capsuleText = await Bun.file(capsuleAbs).text()
        const capsule = JSON.parse(capsuleText) as {
          specVersion: string
          childSessionId: string
          appliedFiles?: string[]
          conflictArtifacts?: string[]
          workingSet?: { pointers?: Array<{ path: string; sha256: string; kind: string }> }
        }
        expect(capsule.specVersion).toBe("capsule-handoff/1.0")
        expect(capsule.childSessionId).toBe(childSessionId)
        expect(capsule.appliedFiles?.includes("hello.txt")).toBe(true)
        expect(capsule.conflictArtifacts).toBeUndefined()

        const pointers = capsule.workingSet?.pointers ?? []
        expect(pointers.some((p) => p.path.endsWith(`/artifacts/${childSessionId}/worktree/changes.patch`))).toBe(
          true,
        )
        expect(pointers.some((p) => p.path.endsWith(`/artifacts/${childSessionId}/worktree/changes.json`))).toBe(
          true,
        )

        const ledger = await ContextLedger.read(parentSessionId)
        expect(ledger.handoffs?.length).toBe(1)
        expect(ledger.handoffs?.[0]?.childSessionId).toBe(childSessionId)
        expect(ledger.handoffs?.[0]?.capsulePath.endsWith(`/artifacts/${parentSessionId}/handoff/${childSessionId}/capsule.handoff.json`)).toBe(true)
        expect(ledger.handoffs?.[0]?.capsuleSha256).toBe(sha256(capsuleText))

        const eventsPath = path.join(baseDir(), ".opencode", "evidence", parentSessionId, "events.jsonl")
        const eventsText = await fs.readFile(eventsPath, "utf-8")
        const events = eventsText
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => JSON.parse(line) as { type?: string })
        expect(events.some((e) => e.type === "handoff.generated")).toBe(true)
      },
    })
  })
})

