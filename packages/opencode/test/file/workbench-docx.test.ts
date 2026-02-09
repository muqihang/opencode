import { $ } from "bun"
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

describe("file.workbench docx", () => {
  test("docx parsing writes text and structure", async () => {
    if (!Bun.which("python3")) return
    if (process.platform !== "win32" && !Bun.which("unzip")) return

    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const docxPath = path.join(tmp.path, "hello.docx")
        const scriptPath = path.join(tmp.path, "make_docx.py")
        const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">\n  <w:body>\n    <w:p><w:r><w:t>Hello</w:t></w:r></w:p>\n  </w:body>\n</w:document>\n`
        await Bun.write(
          scriptPath,
          [
            "import sys, zipfile",
            "path = sys.argv[1]",
            "xml = sys.argv[2]",
            "with zipfile.ZipFile(path, 'w') as z:",
            "  z.writestr('word/document.xml', xml)",
          ].join("\n"),
        )
        await $`python3 ${scriptPath} ${docxPath} ${xml}`.quiet()

        const session = await Session.create({})
        await Workbench.ingest({
          sessionId: session.id,
          part: {
            type: "file",
            url: `file://${docxPath}`,
            mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            filename: "hello.docx",
          },
        })

        const bytes = await Bun.file(docxPath).bytes()
        const inputId = sha(bytes)
        const textPath = await firstPath(
          artifactPaths({ base: tmp.path, sessionId: session.id, rel: `derived/${inputId}/text.txt` }),
        )
        expect(await Bun.file(textPath).exists()).toBe(true)
        expect(await Bun.file(textPath).text()).toContain("Hello")

        const structurePath = await firstPath(
          artifactPaths({ base: tmp.path, sessionId: session.id, rel: `derived/${inputId}/docx.structure.json` }),
        )
        expect(await Bun.file(structurePath).exists()).toBe(true)
        const structure = JSON.parse(await Bun.file(structurePath).text()) as {
          paragraphCount?: number
        }
        expect(structure.paragraphCount ?? 0).toBeGreaterThan(0)
      },
    })
  })
})
