import { describe, expect, test } from "bun:test"
import path from "path"
import { EvidenceWriter } from "../../src/evidence/writer"
import { EvidencePack } from "../../src/protocol/evidence-pack"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("evidence.pack artifacts", () => {
  test("pack.json derives artifacts from manifest deterministically", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const writer = await EvidenceWriter.open({ sessionId: "pack_artifacts" })
        await writer.artifact({
          kind: "test",
          path: "alpha.txt",
          data: "alpha",
        })
        await writer.artifact({
          kind: "test",
          path: "beta.txt",
          data: "beta",
        })

        await writer.pack({ handoff: "ok" })

        const packPath = path.join(
          Instance.worktree,
          ".opencode",
          "evidence",
          "pack_artifacts",
          "pack.json",
        )
        const pack = EvidencePack.parse(JSON.parse(await Bun.file(packPath).text()))
        expect(pack.artifacts.length).toBeGreaterThan(0)
        for (const artifact of pack.artifacts) {
          expect(artifact.id.length).toBeGreaterThan(0)
          expect(artifact.path.length).toBeGreaterThan(0)
          expect(artifact.kind.length).toBeGreaterThan(0)
          expect(artifact.sha256?.length).toBeGreaterThan(0)
          expect(artifact.path.includes(".opencode/evidence/")).toBe(false)
        }

        const sorted = [...pack.artifacts].sort((a, b) => {
          const shaA = a.sha256 ?? ""
          const shaB = b.sha256 ?? ""
          if (shaA !== shaB) return shaA.localeCompare(shaB)
          return a.path.localeCompare(b.path)
        })
        expect(pack.artifacts).toEqual(sorted)
      },
    })
  })
})
