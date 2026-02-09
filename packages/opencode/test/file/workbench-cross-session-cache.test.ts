import { $ } from "bun"
import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
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

function readEvents(file: string) {
  return Bun.file(file)
    .text()
    .then((text) =>
      text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { type?: string; data?: any }),
    )
}

describe("file.workbench cross-session cache", () => {
  test("rehydrates cached text derived across sessions and records cache_hit", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const filePath = path.join(tmp.path, "note.md")
        const text = "# Hello\n"
        await Bun.write(filePath, text)
        const bytes = await Bun.file(filePath).bytes()
        const inputId = sha(bytes)

        const sessionA = await Session.create({})
        await Workbench.ingest({
          sessionId: sessionA.id,
          part: { type: "file", url: `file://${filePath}`, mime: "text/markdown", filename: "note.md" },
        })

        const cacheMeta = path.join(
          tmp.path,
          ".opencode",
          "cache",
          "file-workbench",
          inputId,
          "text",
          "cache.json",
        )
        expect(await Bun.file(cacheMeta).exists()).toBe(true)

        const sessionB = await Session.create({})
        await Workbench.ingest({
          sessionId: sessionB.id,
          part: { type: "file", url: `file://${filePath}`, mime: "text/markdown", filename: "note.md" },
        })

        const inputsPath = await firstPath(
          artifactPaths({ base: tmp.path, sessionId: sessionB.id, rel: "inputs/inputs.json" }),
        )
        const inputs = JSON.parse(await Bun.file(inputsPath).text()) as {
          inputs: Array<{ inputId: string; events?: string[] }>
        }
        const entry = inputs.inputs.find((x) => x.inputId === inputId)
        expect(entry).toBeDefined()
        expect(entry!.events?.includes("cache_hit")).toBe(true)

        const eventsPath = await firstPath(
          evidencePaths({ base: tmp.path, sessionId: sessionB.id, rel: "events.jsonl" }),
        )
        const events = await readEvents(eventsPath)
        const hits = events.filter((e) => e.type === "file.cache_hit" && e.data?.scope === "global")
        expect(hits.length).toBeGreaterThan(0)

        const derivedText = await firstPath(
          artifactPaths({ base: tmp.path, sessionId: sessionB.id, rel: `derived/${inputId}/text.txt` }),
        )
        expect(await Bun.file(derivedText).exists()).toBe(true)
        expect(await Bun.file(derivedText).text()).toBe(text)
      },
    })
  })

  test("does not rehydrate pdf artifacts when current session is not pdf", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const filePath = path.join(tmp.path, "bad.pdf")
        await Bun.write(filePath, "not a pdf")
        const bytes = await Bun.file(filePath).bytes()
        const inputId = sha(bytes)

        const sessionA = await Session.create({})
        await Workbench.ingest({
          sessionId: sessionA.id,
          part: { type: "file", url: `file://${filePath}`, mime: "application/pdf", filename: "bad.pdf" },
        })

        const sessionB = await Session.create({})
        await Workbench.ingest({
          sessionId: sessionB.id,
          part: { type: "file", url: `file://${filePath}`, mime: "application/octet-stream", filename: "bad.bin" },
        })

        const pdfError = await firstPath(
          artifactPaths({ base: tmp.path, sessionId: sessionB.id, rel: `derived/${inputId}/pdf.extract.error.json` }),
        )
        expect(await Bun.file(pdfError).exists()).toBe(false)
      },
    })
  })

  test("rehydrates cached pdf failure artifact across sessions and records cache_hit", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const filePath = path.join(tmp.path, "bad.pdf")
        await Bun.write(filePath, "not a pdf")
        const bytes = await Bun.file(filePath).bytes()
        const inputId = sha(bytes)

        const sessionA = await Session.create({})
        await Workbench.ingest({
          sessionId: sessionA.id,
          part: { type: "file", url: `file://${filePath}`, mime: "application/pdf", filename: "bad.pdf" },
        })

        const cacheMeta = path.join(
          tmp.path,
          ".opencode",
          "cache",
          "file-workbench",
          inputId,
          "pdf",
          "cache.json",
        )
        expect(await Bun.file(cacheMeta).exists()).toBe(true)

        const sessionB = await Session.create({})
        await Workbench.ingest({
          sessionId: sessionB.id,
          part: { type: "file", url: `file://${filePath}`, mime: "application/pdf", filename: "bad.pdf" },
        })

        const pdfError = await firstPath(
          artifactPaths({ base: tmp.path, sessionId: sessionB.id, rel: `derived/${inputId}/pdf.extract.error.json` }),
        )
        expect(await Bun.file(pdfError).exists()).toBe(true)

        const eventsPath = await firstPath(
          evidencePaths({ base: tmp.path, sessionId: sessionB.id, rel: "events.jsonl" }),
        )
        const events = await readEvents(eventsPath)
        const hits = events.filter((e) => e.type === "file.cache_hit" && e.data?.scope === "global")
        expect(hits.length).toBeGreaterThan(0)
      },
    })
  })

  test("rehydrates cached archive derived across sessions and records cache_hit", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = path.join(tmp.path, "pack")
        await fs.mkdir(root, { recursive: true })
        await Bun.write(path.join(root, "a.txt"), "hello")

        const archivePath = path.join(tmp.path, "bundle.tar")
        const result = await $`tar -cf ${archivePath} -C ${root} a.txt`.quiet().nothrow()
        expect(result.exitCode).toBe(0)

        const bytes = await Bun.file(archivePath).bytes()
        const inputId = sha(bytes)

        const sessionA = await Session.create({})
        await Workbench.ingest({
          sessionId: sessionA.id,
          part: { type: "file", url: `file://${archivePath}`, mime: "application/x-tar", filename: "bundle.tar" },
        })

        const sessionB = await Session.create({})
        await Workbench.ingest({
          sessionId: sessionB.id,
          part: { type: "file", url: `file://${archivePath}`, mime: "application/x-tar", filename: "bundle.tar" },
        })

        const unpacked = await firstPath(
          artifactPaths({ base: tmp.path, sessionId: sessionB.id, rel: `derived/${inputId}/unpacked` }),
        )
        expect(await Bun.file(path.join(unpacked, "a.txt")).exists()).toBe(true)

        const eventsPath = await firstPath(
          evidencePaths({ base: tmp.path, sessionId: sessionB.id, rel: "events.jsonl" }),
        )
        const events = await readEvents(eventsPath)
        const hits = events.filter((e) => e.type === "file.cache_hit" && e.data?.scope === "global")
        const archiveHit = hits.find((hit) => Array.isArray(hit.data?.categories) && hit.data?.categories.includes("archive"))
        expect(archiveHit).toBeDefined()
      },
    })
  })
})
