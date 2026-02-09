import { describe, expect, test } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Workbench } from "../../src/file/workbench"
import { artifactPaths, firstPath } from "./workbench-paths"

function sha(bytes: Uint8Array) {
  const hash = new Bun.CryptoHasher("sha256")
  hash.update(Buffer.from(bytes))
  return hash.digest("hex")
}

describe("file.workbench text", () => {
  test("text-like input writes derived text + chunks", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const filePath = path.join(tmp.path, "note.md")
        const text = "# Hello\n"
        await Bun.write(filePath, text)
        const input = {
          sessionId: session.id,
          part: {
            type: "file" as const,
            url: `file://${filePath}`,
            mime: "text/markdown",
            filename: "note.md",
          },
        }

        await Workbench.ingest(input)

        const bytes = await Bun.file(filePath).bytes()
        const inputId = sha(bytes)
        const textPath = await firstPath(
          artifactPaths({ base: tmp.path, sessionId: session.id, rel: `derived/${inputId}/text.txt` }),
        )
        const chunksPath = await firstPath(
          artifactPaths({ base: tmp.path, sessionId: session.id, rel: `derived/${inputId}/chunks.json` }),
        )

        expect(await Bun.file(textPath).exists()).toBe(true)
        expect(await Bun.file(textPath).text()).toBe(text)

        const chunks = JSON.parse(await Bun.file(chunksPath).text()) as Array<{
          chunk_index: number
          start: number
          end: number
          content_hash: string
          snippet_preview: string
        }>
        expect(chunks.length).toBe(1)
        const chunk = chunks[0]
        expect(chunk.chunk_index).toBe(0)
        expect(chunk.start).toBe(0)
        expect(chunk.end).toBe(bytes.byteLength)
        expect(chunk.content_hash).toBe(sha(bytes))
        expect(chunk.snippet_preview).toBe(text.slice(0, 200))
      },
    })
  })
})
