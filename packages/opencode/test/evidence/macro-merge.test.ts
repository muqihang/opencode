import { describe, expect, test } from "bun:test"
import path from "path"
import { EvidenceWriter } from "../../src/evidence/writer"
import { EvidencePack } from "../../src/protocol/evidence-pack"
import { Instance } from "../../src/project/instance"
import { mergeChildEvidencePacks } from "../../src/evidence/macro-merge"
import { tmpdir } from "../fixture/fixture"

function sha(input: string) {
  const hash = new Bun.CryptoHasher("sha256")
  hash.update(input)
  return hash.digest("hex")
}

describe("evidence.macro-merge", () => {
  test("merges child packs, dedupes artifacts, and records risks", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parentSessionId = "parent"
        const childA = "child_a"
        const childB = "child_b"

        const writerA = await EvidenceWriter.open({ sessionId: childA })
        await writerA.artifact({ kind: "test", path: "a.txt", data: "same" })
        await writerA.check({ id: "check:lint", command: "lint", status: "pass" })
        await writerA.pack({ handoff: "child a" })

        const writerB = await EvidenceWriter.open({ sessionId: childB })
        await writerB.artifact({ kind: "test", path: "b.txt", data: "same" })
        await writerB.check({ id: "check:lint", command: "lint", status: "fail" })
        await writerB.pack({ handoff: "child b" })

        await mergeChildEvidencePacks({ parentSessionId, childSessionIds: [childA, childB] })

        const packPath = path.join(
          Instance.worktree,
          ".opencode",
          "evidence",
          parentSessionId,
          "pack.json",
        )
        const pack = EvidencePack.parse(JSON.parse(await Bun.file(packPath).text()))

        const testArtifacts = pack.artifacts.filter((artifact) => artifact.kind === "test")
        expect(testArtifacts.length).toBe(1)

        const risk = pack.risks.find((item) => item.summary.includes("check conflict"))
        expect(risk).toBeDefined()

        const aliasArtifact = pack.artifacts.find((artifact) => artifact.kind === "artifact-aliases")
        expect(aliasArtifact).toBeDefined()
        const aliasPath = path.join(Instance.worktree, aliasArtifact!.path)
        const aliasData = JSON.parse(await Bun.file(aliasPath).text()) as {
          specVersion: string
          bySha256: Record<string, string[]>
        }
        const expectedSha = sha("same")
        const aliases = aliasData.bySha256[expectedSha] ?? []
        expect(aliases).toContain(`.opencode/artifacts/${childA}/a.txt`)
        expect(aliases).toContain(`.opencode/artifacts/${childB}/b.txt`)
      },
    })
  })
})
