import { describe, expect, test } from "bun:test"
import { EvidenceWriter } from "../../src/evidence/writer"
import { EvidenceReader } from "../../src/evidence/reader"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

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

        const events = await EvidenceReader.readEvents("fail_evt", { cursor: 0, limit: 20 })
        expect(events.events.map((item) => item.type)).toContain("evidence.write_failed")
      },
    })
  })
})
