import { describe, expect, test } from "bun:test"
import { EvidenceWriter } from "../../src/evidence/writer"
import { EvidenceReader } from "../../src/evidence/reader"
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
        const events = await EvidenceReader.readEvents("bad_pack", { cursor: 0, limit: 20 })
        expect(events.events.map((item) => item.type)).toContain("protocol.violation")
      },
    })
  })
})
