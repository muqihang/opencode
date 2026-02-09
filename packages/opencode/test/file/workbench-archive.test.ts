import { $ } from "bun"
import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Workbench } from "../../src/file/workbench"
import { artifactCandidates, evidenceCandidates, resolveTenantScope } from "../../src/util/tenant-context"

function sha(bytes: Uint8Array) {
  const hash = new Bun.CryptoHasher("sha256")
  hash.update(Buffer.from(bytes))
  return hash.digest("hex")
}

describe("file.workbench archive", () => {
  test("archive input writes derived/unpacked + manifest entry", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const root = path.join(tmp.path, "pack")
        await fs.mkdir(root, { recursive: true })
        await Bun.write(path.join(root, "a.txt"), "hello")

        const archivePath = path.join(tmp.path, "bundle.tar")
        const result = await $`tar -cf ${archivePath} -C ${root} a.txt`.quiet().nothrow()
        expect(result.exitCode).toBe(0)

        const input = {
          sessionId: session.id,
          part: {
            type: "file" as const,
            url: `file://${archivePath}`,
            mime: "application/x-tar",
            filename: "bundle.tar",
          },
        }
        await Workbench.ingest(input)

        const bytes = await Bun.file(archivePath).bytes()
        const inputId = sha(bytes)
        const scope = resolveTenantScope()
        const unpackedDir = await (async () => {
          const candidates = artifactCandidates({
            base: tmp.path,
            sessionId: session.id,
            tenantId: scope.tenantId,
            orgId: scope.orgId,
          }).map((dir) => path.join(dir, "derived", inputId, "unpacked"))
          for (const candidate of candidates) {
            const exists = await Bun.file(path.join(candidate, "a.txt")).exists()
            if (exists) return candidate
          }
          return candidates[0]!
        })()
        expect(await Bun.file(path.join(unpackedDir, "a.txt")).exists()).toBe(true)

        const manifestPath = await (async () => {
          const candidates = evidenceCandidates({
            base: tmp.path,
            sessionId: session.id,
            tenantId: scope.tenantId,
            orgId: scope.orgId,
          }).map((dir) => path.join(dir, "manifest.json"))
          for (const candidate of candidates) {
            const exists = await Bun.file(candidate).exists()
            if (exists) return candidate
          }
          return candidates[0]!
        })()
        const manifestData = JSON.parse(await Bun.file(manifestPath).text()) as {
          entries: Array<{ path: string }>
        }
        const suffix = `/${session.id}/derived/${inputId}/unpacked/filelist.json`
        const hit = manifestData.entries.find((entry) => {
          const value = entry.path.replaceAll("\\", "/")
          return value.includes(".opencode/artifacts/") && value.endsWith(suffix)
        })
        expect(hit).toBeDefined()
      },
    })
  })
})
