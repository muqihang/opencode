import { describe, expect, test } from "bun:test"
import { EvidenceWriter } from "../../src/evidence/writer"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("evidence.protocol violation", () => {
  test("writes protocol.violation event on invalid event input", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const writer = await EvidenceWriter.open({ sessionId: "bad_pack" })
        await expect(writer.event({} as any)).rejects.toThrow()
        const eventsPath = `${Instance.worktree}/.opencode/evidence/bad_pack/events.jsonl`
        const text = await Bun.file(eventsPath).text()
        expect(text).toContain("protocol.violation")
      },
    })
  })
})
