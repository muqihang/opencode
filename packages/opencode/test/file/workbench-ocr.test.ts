import { describe, expect, test } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Workbench } from "../../src/file/workbench"

function sha(bytes: Uint8Array) {
  const hash = new Bun.CryptoHasher("sha256")
  hash.update(Buffer.from(bytes))
  return hash.digest("hex")
}

function readEvents(file: string) {
  return Bun.file(file)
    .text()
    .then((text) =>
      text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { type?: string }),
    )
}

describe("file.workbench ocr", () => {
  test("ocr enabled emits error evidence for invalid image", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            workbench: { ocr: { mode: "tesseract" } },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const filePath = path.join(tmp.path, "bad.png")
        await Bun.write(filePath, "not a png")
        const input = {
          sessionId: session.id,
          part: {
            type: "file",
            url: `file://${filePath}`,
            mime: "image/png",
            filename: "bad.png",
          },
        }

        await Workbench.ingest(input)

        const bytes = await Bun.file(filePath).bytes()
        const inputId = sha(bytes)
        const errorPath = path.join(
          tmp.path,
          ".opencode",
          "artifacts",
          session.id,
          "derived",
          inputId,
          "ocr.error.json",
        )
        expect(await Bun.file(errorPath).exists()).toBe(true)

        const eventsPath = path.join(tmp.path, ".opencode", "evidence", session.id, "events.jsonl")
        const events = await readEvents(eventsPath)
        const hits = events.filter((event) => event.type === "doc.ocr_image")
        expect(hits.length).toBeGreaterThan(0)
      },
    })
  })
})
