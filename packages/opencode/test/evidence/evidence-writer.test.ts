import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { EvidenceWriter } from "../../src/evidence/writer"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { EventV1 } from "../../src/protocol/event"

describe("evidence.writer", () => {
  test("writes pack + manifest + events", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const writer = await EvidenceWriter.open({ sessionId: "session_test" })
        await writer.event({
          specVersion: "event/1.0",
          ts: "2026-01-28T00:00:00.000Z",
          sessionId: "session_test",
          severity: "info",
          actor: "tool:bash",
          type: "tool.started",
          summary: "started",
          redaction: { applied: true, policyVersion: "v1" },
        })
        await writer.event({
          specVersion: "event/1.0",
          ts: "2026-01-28T00:00:01.000Z",
          sessionId: "session_test",
          severity: "info",
          actor: "tool:bash",
          type: "tool.completed",
          summary: "completed",
          redaction: { applied: true, policyVersion: "v1" },
        })

        const pack = await writer.pack({ handoff: "ok" })
        const manifest = await writer.manifest()
        expect(pack.specVersion).toBe("evidence-pack/1.0")
        expect(manifest.entries.length).toBeGreaterThan(0)

        const eventsPath = path.join(
          Instance.worktree,
          ".opencode",
          "evidence",
          "session_test",
          "events.jsonl",
        )
        const eventsText = await Bun.file(eventsPath).text()
        const lines = eventsText
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
        expect(lines.length).toBeGreaterThan(1)
        for (const line of lines) {
          const data = JSON.parse(line) as unknown
          EventV1.parse(data)
        }
      },
    })
  })

  test("rejects symlink target and keeps manifest clean", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const writer = await EvidenceWriter.open({ sessionId: "session_symlink" })
        const root = path.join(Instance.worktree, ".opencode", "artifacts", "session_symlink")
        await fs.mkdir(root, { recursive: true })
        const link = path.join(root, "link.txt")
        await fs.symlink("/tmp", link)

        await expect(
          writer.artifact({
            kind: "test",
            path: "link.txt",
            data: "nope",
          }),
        ).rejects.toThrow()

        const manifest = await writer.manifest()
        const hit = manifest.entries.find((entry) => entry.path.endsWith("link.txt"))
        expect(hit).toBeUndefined()
      },
    })
  })

  test("rejects traversal and does not add manifest entry", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const writer = await EvidenceWriter.open({ sessionId: "session_traversal" })
        await expect(
          writer.artifact({
            kind: "test",
            path: "../bad.txt",
            data: "nope",
          }),
        ).rejects.toThrow()

        const manifest = await writer.manifest()
        const hit = manifest.entries.find((entry) => entry.path.includes("bad.txt"))
        expect(hit).toBeUndefined()
      },
    })
  })
})
