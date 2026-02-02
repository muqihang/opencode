import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { runVerification } from "../../src/verification"
import { EvidenceWriter } from "../../src/evidence/writer"
import { EventV1 } from "../../src/protocol/event"

const buildCtx = (sessionId: string) => ({
  sessionID: sessionId,
  messageID: "",
  callID: "",
  agent: "verification",
  abort: AbortSignal.any([]),
  metadata: () => {},
  ask: async () => {},
})

describe("verification.worker", () => {
  test("valid citations pass", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionId = "verifier-test"
        const base = path.join(Instance.worktree, ".opencode", "artifacts", sessionId)
        const root = path.join(base, "derived", "input-1")
        await Bun.write(path.join(root, "note.txt"), "hello\nworld\n")

        const result = await runVerification({
          taskFrame: { specVersion: "task-frame/1.0", sessionId, contextPackId: "ctx-1" },
          mode: "strict",
          budget: { timeMs: 20000 },
          claims: [
            {
              id: "c1",
              text: "hello",
              pointers: [{ path: "derived/input-1/note.txt" }],
            },
          ],
          ctx: buildCtx(sessionId),
        })

        expect(result.ok).toBe(true)
        const writer = await EvidenceWriter.open({ sessionId })
        const manifest = await writer.manifest()
        const report = manifest.entries.find((entry) => entry.path.includes("verification.report.json"))
        expect(report).toBeDefined()

        const eventsPath = path.join(Instance.worktree, ".opencode", "evidence", sessionId, "events.jsonl")
        const eventsText = await Bun.file(eventsPath).text()
        const types = eventsText
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => EventV1.parse(JSON.parse(line)).type)
        expect(types).toContain("verification.requested")
        expect(types).toContain("verification.completed")
      },
    })
  })

  test("redaction high risk fails with chinese hint", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionId = "verifier-test-2"
        const base = path.join(Instance.worktree, ".opencode", "artifacts", sessionId)
        const root = path.join(base, "derived", "input-2")
        await Bun.write(path.join(root, "pii.txt"), "ssn 123-45-6789")

        const result = await runVerification({
          taskFrame: { specVersion: "task-frame/1.0", sessionId, contextPackId: "ctx-2" },
          mode: "balanced",
          budget: { timeMs: 20000 },
          claims: [
            {
              id: "c2",
              text: "contains pii",
              pointers: [{ path: "derived/input-2/pii.txt" }],
            },
          ],
          ctx: buildCtx(sessionId),
        })

        expect(result.ok).toBe(false)
        expect(result.hint).toContain("高风险")
      },
    })
  })
})
