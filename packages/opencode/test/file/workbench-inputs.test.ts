import { describe, expect, test } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { Workbench } from "../../src/file/workbench"

function sha(bytes: Uint8Array) {
  const hash = new Bun.CryptoHasher("sha256")
  hash.update(Buffer.from(bytes))
  return hash.digest("hex")
}

describe("file.workbench inputs", () => {
  test("writes inputs artifacts and inputs.json", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const filePath = path.join(tmp.path, "note.txt")
        await Bun.write(filePath, "hello")
        const input = {
          sessionId: session.id,
          part: {
            type: "file" as const,
            url: `file://${filePath}`,
            mime: "text/plain",
            filename: "note.txt",
          },
        }
        await Workbench.ingest(input)
        const inputsDir = path.join(tmp.path, ".opencode", "artifacts", session.id, "inputs")
        expect(await Bun.file(path.join(inputsDir, "inputs.json")).exists()).toBe(true)
        const bytes = await Bun.file(filePath).bytes()
        const inputId = sha(bytes)
        expect(await Bun.file(path.join(inputsDir, inputId, "note.txt")).exists()).toBe(true)
      },
    })
  })

  test("duplicate input emits cache_hit event and skips derivation", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const filePath = path.join(tmp.path, "note.txt")
        await Bun.write(filePath, "hello")
        const input = {
          sessionId: session.id,
          part: {
            type: "file" as const,
            url: `file://${filePath}`,
            mime: "text/plain",
            filename: "note.txt",
          },
        }

        const bytes = await Bun.file(filePath).bytes()
        const inputId = sha(bytes)

        await Workbench.ingest(input)
        const manifestPath = path.join(tmp.path, ".opencode", "evidence", session.id, "manifest.json")
        const manifestBefore = JSON.parse(await Bun.file(manifestPath).text()) as {
          entries: Array<{ path: string }>
        }
        const derivedBefore = manifestBefore.entries.filter((entry) => entry.path.includes("/derived/")).length

        await Workbench.ingest(input)

        const inputsPath = path.join(tmp.path, ".opencode", "artifacts", session.id, "inputs", "inputs.json")
        const inputsData = JSON.parse(await Bun.file(inputsPath).text()) as { inputs: Array<Record<string, unknown>> }
        const hit = inputsData.inputs.find((item) => item.inputId === inputId) as
          | { events?: string[] }
          | undefined
        expect(hit).toBeDefined()
        expect(hit?.events?.includes("cache_hit")).toBe(true)

        const eventsPath = path.join(tmp.path, ".opencode", "evidence", session.id, "events.jsonl")
        const eventText = await Bun.file(eventsPath).text()
        const hits = eventText
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => JSON.parse(line) as { type?: string })
          .filter((item) => item.type === "file.cache_hit")
        expect(hits.length).toBe(1)

        const manifestData = JSON.parse(await Bun.file(manifestPath).text()) as {
          entries: Array<{ path: string }>
        }
        const derivedAfter = manifestData.entries.filter((entry) => entry.path.includes("/derived/")).length
        expect(derivedAfter).toBe(derivedBefore)
      },
    })
  })

  test("prompt file parts call workbench ingestion (inputs.json created)", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const filePath = path.join(tmp.path, "note.txt")
        await Bun.write(filePath, "hello")
        const part = {
          type: "file" as const,
          url: `file://${filePath}`,
          mime: "text/plain",
          filename: "note.txt",
        }

        await SessionPrompt.ingestFilePartToWorkbench({
          sessionId: session.id,
          part,
        })

        const inputsPath = path.join(tmp.path, ".opencode", "artifacts", session.id, "inputs", "inputs.json")
        expect(await Bun.file(inputsPath).exists()).toBe(true)
      },
    })
  })
})
