import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { Session } from "../../src/session"
import { Identifier } from "../../src/id/id"
import { SessionCompaction } from "../../src/session/compaction"
import { EvidenceReader } from "../../src/evidence/reader"
import { Log } from "../../src/util/log"

Log.init({ print: false })

const timeout = 15_000

const writeText = async (input: { sessionId: string; text: string }) => {
  const msg = await Session.updateMessage({
    id: Identifier.ascending("message"),
    role: "user",
    sessionID: input.sessionId,
    agent: "default",
    model: { providerID: "openai", modelID: "gpt-4" },
    time: { created: Date.now() },
  })
  await Session.updatePart({
    id: Identifier.ascending("part"),
    messageID: msg.id,
    sessionID: input.sessionId,
    type: "text",
    text: input.text,
  })
  return msg
}

describe("session.compaction structured artifacts + events", () => {
  test("writes capsule/facts/input/report artifacts and registers them in manifest", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const sessionId = session.id

        const msg1 = await writeText({ sessionId, text: "Round 1: " + "a".repeat(10_000) })
        await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "assistant",
          sessionID: sessionId,
          parentID: msg1.id,
          mode: "default",
          agent: "default",
          path: { cwd: tmp.path, root: tmp.path },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: "gpt-4",
          providerID: "openai",
          time: { created: Date.now() },
          finish: "end_turn",
        })

        const msg2 = await writeText({ sessionId, text: "Round 2: " + "b".repeat(10_000) })
        const msg3 = await writeText({ sessionId, text: "Round 3: please compact" })

        const msgs = await Session.messages({ sessionID: sessionId })
        const abort = new AbortController()
        const result = await SessionCompaction.process({
          parentID: msg3.id,
          messages: msgs,
          sessionID: sessionId,
          abort: abort.signal,
          auto: false,
        })

        expect(result).toBe("continue")

        const manifest = await EvidenceReader.readManifest(sessionId)
        const wanted = ["capsule.md", "facts.json", "compaction.input.json", "compaction.report.json"]
        const compactionPattern = new RegExp(`/artifacts/(?:[^/]+/[^/]+/)?${sessionId}/compaction/`)

        const compactionEntries = manifest.entries.filter((e) => compactionPattern.test(e.path))
        expect(compactionEntries.length).toBeGreaterThanOrEqual(4)

        for (const suffix of wanted) {
          const found = manifest.entries.find((e) => compactionPattern.test(e.path) && e.path.endsWith(`/${suffix}`))
          expect(found).toBeTruthy()
          if (!found) continue
          expect(found.kind.length).toBeGreaterThan(0)
          expect(found.sha256.length).toBe(64)
          expect(found.path.length).toBeGreaterThan(0)
          const file = path.join(tmp.path, found.path)
          expect(await Bun.file(file).exists()).toBe(true)
        }

        const events = await EvidenceReader.readEvents(sessionId, { cursor: 0, limit: 1000 })
        const types = events.events.map((e) => e.type)
        expect(types.includes("compaction.started")).toBe(true)
        expect(types.includes("compaction.completed")).toBe(true)
      },
    })
  }, { timeout })

  test("cancelled compaction emits reason_zh + next_steps_zh", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const sessionId = session.id
        const msg = await writeText({ sessionId, text: "please compact" })
        const msgs = await Session.messages({ sessionID: sessionId })

        const abort = new AbortController()
        abort.abort()

        const result = await SessionCompaction.process({
          parentID: msg.id,
          messages: msgs,
          sessionID: sessionId,
          abort: abort.signal,
          auto: false,
        })

        expect(result).toBe("stop")

        const events = await EvidenceReader.readEvents(sessionId, { cursor: 0, limit: 1000 })
        const cancelled = events.events.find((e) => e.type === "compaction.cancelled")
        expect(cancelled).toBeTruthy()
        if (!cancelled) return
        const data = cancelled.data ?? {}
        expect(typeof data["reason_zh"]).toBe("string")
        expect(String(data["reason_zh"]).trim().length).toBeGreaterThan(0)
        expect(typeof data["next_steps_zh"]).toBe("string")
        expect(String(data["next_steps_zh"]).trim().length).toBeGreaterThan(0)
      },
    })
  })
})
