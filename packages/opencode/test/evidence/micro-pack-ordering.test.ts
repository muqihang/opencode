import { describe, expect, test } from "bun:test"
import { EvidenceWriter } from "../../src/evidence/writer"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

function sha(input: string) {
  const hash = new Bun.CryptoHasher("sha256")
  hash.update(input)
  return hash.digest("hex")
}

describe("evidence.micro-pack ordering", () => {
  test("micro-pack artifacts are sorted deterministically", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const writer = await EvidenceWriter.open({ sessionId: "micro_order" })

        const first = { path: "alpha.txt", data: "alpha" }
        const second = { path: "beta.txt", data: "beta" }
        const firstSha = sha(first.data)
        const secondSha = sha(second.data)
        const ordered = firstSha.localeCompare(secondSha) <= 0 ? [second, first] : [first, second]

        for (const entry of ordered) {
          await writer.artifact({
            kind: "test",
            path: entry.path,
            data: entry.data,
          })
        }

        const micro = await writer.microPack({ parentSessionId: "parent" })
        const sorted = [...micro.artifacts].sort((a, b) => {
          const shaA = a.sha256 ?? ""
          const shaB = b.sha256 ?? ""
          if (shaA !== shaB) return shaA.localeCompare(shaB)
          return a.path.localeCompare(b.path)
        })
        expect(micro.artifacts).toEqual(sorted)
      },
    })
  })
})
