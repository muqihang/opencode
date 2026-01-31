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

describe("file.workbench pdf pages", () => {
  test("pdf pages failure writes pdf.pages.json", async () => {
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
        const pagesPath = path.join(
          tmp.path,
          ".opencode",
          "artifacts",
          session.id,
          "derived",
          inputId,
          "pdf.pages.json",
        )
        expect(await Bun.file(pagesPath).exists()).toBe(true)

        const payload = JSON.parse(await Bun.file(pagesPath).text()) as {
          specVersion?: string
          ok?: boolean
          error?: { message?: string; hint?: string }
        }
        expect(payload.specVersion).toBe("pdf-pages/1.0")
        expect(payload.ok).toBe(false)
        const hint = payload.error?.hint ?? payload.error?.message ?? ""
        expect(hint).toContain("pdftotext")
      },
    })
  })
})
