import { describe, expect, test } from "bun:test"
import path from "path"
import { EvidenceReader } from "../../src/evidence/reader"
import { EvidenceWriter } from "../../src/evidence/writer"
import { Instance } from "../../src/project/instance"
import { evidenceCandidates, resolveTenantScope } from "../../src/util/tenant-context"
import { tmpdir } from "../fixture/fixture"

const manifestFile = async (input: { base: string; sessionId: string }) => {
  const scope = resolveTenantScope()
  const files = evidenceCandidates({
    base: input.base,
    sessionId: input.sessionId,
    tenantId: scope.tenantId,
    orgId: scope.orgId,
  }).map((dir) => path.join(dir, "manifest.json"))
  for (const file of files) {
    const has = await Bun.file(file).exists()
    if (has) return file
  }
  return files[0]!
}

const sha = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value)

describe("evidence manifest append-only chain", () => {
  test("reader keeps legacy manifest compatibility", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionId = "manifest-legacy-read"
        const file = await manifestFile({ base: Instance.worktree, sessionId })
        await Bun.write(
          file,
          JSON.stringify({
            specVersion: "evidence-manifest/1.0",
            packId: `EP-${sessionId}`,
            generatedAtUtc: new Date().toISOString(),
            entries: [
              {
                path: `.opencode/artifacts/${sessionId}/legacy.txt`,
                sha256: "a".repeat(64),
                kind: "legacy-test",
              },
            ],
          }),
        )

        const manifest = await EvidenceReader.readManifest(sessionId)
        expect(manifest.entries.length).toBe(1)
        expect(manifest.entries[0]?.kind).toBe("legacy-test")
      },
    })
  })

  test("same manifest path appends ledger entries with sequence/prevHash", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionId = "manifest-append-only"
        const writer = await EvidenceWriter.open({ sessionId })

        await writer.artifact({
          kind: "append-only-test",
          path: "same.txt",
          data: "first",
        })
        await writer.artifact({
          kind: "append-only-test",
          path: "same.txt",
          data: "second",
        })

        const manifest = await EvidenceReader.readManifest(sessionId)
        const rows = manifest.entries.filter((entry) => entry.kind === "append-only-test")
        expect(rows.length).toBe(2)
        const first = rows[0] as Record<string, unknown>
        const second = rows[1] as Record<string, unknown>
        const firstSeq = Number(first["sequence"] ?? 0)
        const secondSeq = Number(second["sequence"] ?? 0)
        expect(firstSeq).toBeGreaterThan(0)
        expect(secondSeq).toBe(firstSeq + 1)
        expect(sha(first["entryHash"])).toBe(true)
        expect(sha(second["prevHash"])).toBe(true)
        expect(second["prevHash"]).toBe(first["entryHash"])
      },
    })
  })

  test("reader fails closed when chain linkage is corrupted", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionId = "manifest-chain-corrupt"
        const writer = await EvidenceWriter.open({ sessionId })

        await writer.artifact({
          kind: "chain-corrupt-test",
          path: "same.txt",
          data: "first",
        })
        await writer.artifact({
          kind: "chain-corrupt-test",
          path: "same.txt",
          data: "second",
        })

        const file = await manifestFile({ base: Instance.worktree, sessionId })
        const raw = JSON.parse(await Bun.file(file).text()) as {
          entries: Array<Record<string, unknown>>
        }
        const rows = raw.entries.filter((entry) => entry["kind"] === "chain-corrupt-test")
        expect(rows.length).toBe(2)

        const bad = raw.entries.map((entry) => {
          if (entry["kind"] !== "chain-corrupt-test") return entry
          if (entry["path"] !== rows[1]!["path"]) return entry
          return {
            ...entry,
            prevHash: "f".repeat(64),
          }
        })

        await Bun.write(file, JSON.stringify({ ...raw, entries: bad }))
        await expect(EvidenceReader.readManifest(sessionId)).rejects.toThrow()
      },
    })
  })
})
