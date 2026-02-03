import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { ContextLedger } from "../../src/session/context-ledger"
import { Log } from "../../src/util/log"

Log.init({ print: false })

describe("session.context-ledger", () => {
  test("persists lastContextPackId per session", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const first = await ContextLedger.read("session_test")
        expect(first.lastContextPackId).toBeUndefined()

        await ContextLedger.write({ sessionId: "session_test", lastContextPackId: "01ARZ3NDEKTSV4RRFFQ69G5FAV" })
        const second = await ContextLedger.read("session_test")
        expect(second.lastContextPackId).toBe("01ARZ3NDEKTSV4RRFFQ69G5FAV")
      },
    })
  })

  test("parses extended capsule/handoff fields from disk", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const base = Instance.worktree === "/" ? Instance.directory : Instance.worktree
        const file = path.join(base, ".opencode", "context", "session_test", "ledger.json")
        await fs.mkdir(path.dirname(file), { recursive: true })

        await Bun.write(
          file,
          JSON.stringify({
            specVersion: "context-ledger/1.0",
            sessionId: "session_test",
            updatedAtUtc: "2026-02-03T00:00:00.000Z",
            lastContextPackId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
            lastCapsuleSession: { path: ".opencode/compaction/c1/capsule.session.json", sha256: "0".repeat(64) },
            lastCapsuleRendered: { path: ".opencode/compaction/c1/capsule.rendered.md", sha256: "1".repeat(64) },
            handoffs: [
              {
                childSessionId: "child_s1",
                capsulePath: ".opencode/handoff/child_s1/capsule.handoff.json",
                capsuleSha256: "2".repeat(64),
                importedAtUtc: "2026-02-03T00:00:00.000Z",
              },
            ],
          }),
        )

        const parsed = await ContextLedger.read("session_test")
        expect(parsed.lastContextPackId).toBe("01ARZ3NDEKTSV4RRFFQ69G5FAV")
        expect(parsed.lastCapsuleSession?.path).toBe(".opencode/compaction/c1/capsule.session.json")
        expect(parsed.lastCapsuleRendered?.sha256).toBe("1".repeat(64))
        expect(parsed.handoffs?.length).toBe(1)
        expect(parsed.handoffs?.[0]?.childSessionId).toBe("child_s1")
      },
    })
  })

  test("update merges fields (writing B does not clear A)", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await ContextLedger.write({ sessionId: "session_test", lastContextPackId: "01ARZ3NDEKTSV4RRFFQ69G5FAV" })

        await ContextLedger.update({
          sessionId: "session_test",
          patch: {
            lastCapsuleRendered: { path: ".opencode/compaction/c1/capsule.rendered.md", sha256: "0".repeat(64) },
          },
        })

        const readback = await ContextLedger.read("session_test")
        expect(readback.lastContextPackId).toBe("01ARZ3NDEKTSV4RRFFQ69G5FAV")
        expect(readback.lastCapsuleRendered?.path).toBe(".opencode/compaction/c1/capsule.rendered.md")
      },
    })
  })
})
