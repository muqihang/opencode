import { describe, expect, test } from "bun:test"
import path from "path"
import { EvidenceWriter } from "../../src/evidence/writer"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { EventV1 } from "../../src/protocol/event"

describe("evidence.write_failed", () => {
  test("emits evidence.write_failed when artifact path is rejected", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const writer = await EvidenceWriter.open({ sessionId: "fail_evt" })
        await expect(
          writer.artifact({
            kind: "test",
            path: "../escape.txt",
            data: "nope",
          }),
        ).rejects.toThrow()

        const eventsPath = path.join(
          Instance.worktree,
          ".opencode",
          "evidence",
          "fail_evt",
          "events.jsonl",
        )
        const text = await Bun.file(eventsPath).text()
        const lines = text
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
          .map((l) => EventV1.parse(JSON.parse(l)).type)

        expect(lines).toContain("evidence.write_failed")
      },
    })
  })
})
