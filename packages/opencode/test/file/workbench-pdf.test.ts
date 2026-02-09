import { describe, expect, test } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Workbench } from "../../src/file/workbench"
import { artifactPaths, evidencePaths, firstPath } from "./workbench-paths"

function sha(bytes: Uint8Array) {
  const hash = new Bun.CryptoHasher("sha256")
  hash.update(Buffer.from(bytes))
  return hash.digest("hex")
}

describe("file.workbench pdf", () => {
  test("pdf extract failure writes evidence artifact", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const filePath = path.join(tmp.path, "bad.pdf")
        await Bun.write(filePath, "not a pdf")
        const input = {
          sessionId: session.id,
          part: {
            type: "file" as const,
            url: `file://${filePath}`,
            mime: "application/pdf",
            filename: "bad.pdf",
          },
        }

        await Workbench.ingest(input)

        const bytes = await Bun.file(filePath).bytes()
        const inputId = sha(bytes)
        const errorPath = await firstPath(
          artifactPaths({ base: tmp.path, sessionId: session.id, rel: `derived/${inputId}/pdf.extract.error.json` }),
        )
        expect(await Bun.file(errorPath).exists()).toBe(true)

        const manifestPath = await firstPath(
          evidencePaths({ base: tmp.path, sessionId: session.id, rel: "manifest.json" }),
        )
        const manifestData = JSON.parse(await Bun.file(manifestPath).text()) as {
          entries: Array<{ path: string }>
        }
        const suffix = `/derived/${inputId}/pdf.extract.error.json`
        const hit = manifestData.entries.find((entry) => {
          const value = entry.path.replaceAll("\\", "/")
          return value.includes(".opencode/artifacts/") && value.endsWith(suffix)
        })
        expect(hit).toBeDefined()
      },
    })
  })
})
