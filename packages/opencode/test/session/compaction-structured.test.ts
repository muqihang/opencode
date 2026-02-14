import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { Session } from "../../src/session"
import { Identifier } from "../../src/id/id"
import { SessionCompaction } from "../../src/session/compaction"
import { EvidenceReader } from "../../src/evidence/reader"
import { Log } from "../../src/util/log"
import { ContextLedger } from "../../src/session/context-ledger"

Log.init({ print: false })

const timeout = 30_000

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

        const msg1 = await writeText({
          sessionId,
          text:
            "Round 1: please inspect packages/opencode/src/session/compaction.ts and packages/opencode/src/session/capsule.ts before compacting. " +
            "a".repeat(10_000),
        })
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

        const msg2 = await writeText({
          sessionId,
          text:
            "Round 2: next step is to add compaction quality event, then verify tests and refresh docs evidence. " +
            "b".repeat(10_000),
        })
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
        const wanted = ["capsule.md", "facts.json", "compaction.input.json", "compaction.report.json", "anchor.snapshot.json"]
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

        const capsuleEntry = manifest.entries.find((e) => compactionPattern.test(e.path) && e.path.endsWith("/capsule.session.json"))
        expect(capsuleEntry).toBeTruthy()
        if (!capsuleEntry) throw new Error("missing capsule.session.json")

        const capsuleText = await Bun.file(path.join(tmp.path, capsuleEntry.path)).text()
        const capsule = JSON.parse(capsuleText) as {
          goal?: { status?: string; value?: unknown }
          decisions?: Array<{ status?: string; value?: unknown }>
          openQuestions?: Array<{ status?: string; value?: unknown }>
          notes?: Array<{ status?: string; value?: unknown }>
        }

        expect(capsule.goal?.status).toBe("known")
        expect(String(capsule.goal?.value ?? "").trim().length).toBeGreaterThan(0)
        expect((capsule.decisions ?? []).length).toBeGreaterThanOrEqual(1)
        expect((capsule.openQuestions ?? []).length).toBeGreaterThanOrEqual(1)

        const triggerSource = (capsule.notes ?? []).find((item) => String(item.value ?? "").startsWith("trigger_source:"))
        expect(triggerSource?.status).toBe("known")
        expect(String(triggerSource?.value ?? "")).toBe("trigger_source: manual")
        expect((capsule.notes ?? []).some((item) => String(item.value ?? "").includes("trigger: unknown"))).toBe(false)

        const activeFiles = (capsule.notes ?? []).find((item) => String(item.value ?? "").startsWith("active_files:"))
        const nextSteps = (capsule.notes ?? []).find((item) => String(item.value ?? "").startsWith("next_steps:"))
        const knownSemanticCount = [capsule.goal, activeFiles, nextSteps].filter((item) => item?.status === "known").length
        expect(knownSemanticCount).toBeGreaterThanOrEqual(2)

        const events = await EvidenceReader.readEvents(sessionId, { cursor: 0, limit: 1000 })
        const types = events.events.map((e) => e.type)
        const quality = events.events.find((e) => e.type === "compaction.quality")
        const anchorEntry = manifest.entries.find((e) => compactionPattern.test(e.path) && e.path.endsWith("/anchor.snapshot.json"))
        expect(anchorEntry).toBeTruthy()
        if (anchorEntry) {
          const anchorText = await Bun.file(path.join(tmp.path, anchorEntry.path)).text()
          const anchorData = JSON.parse(anchorText) as Record<string, unknown>
          expect(anchorData["specVersion"]).toBe("anchor-snapshot/1.0")
          expect(typeof anchorData["sessionId"]).toBe("string")
          expect(typeof anchorData["messageId"]).toBe("string")
          expect(typeof anchorData["planId"]).toBe("string")
          expect(typeof anchorData["toolsetFingerprint"]).toBe("string")
        }
        expect(types.includes("anchor.snapshot")).toBe(true)
        expect(types.includes("compaction.started")).toBe(true)
        expect(types.includes("compaction.quality")).toBe(true)
        expect(types.includes("compaction.completed")).toBe(true)

        expect(quality).toBeTruthy()
        if (quality) {
          const qualityData = quality.data ?? {}
          expect(typeof qualityData["semantic_coverage"]).toBe("number")
          expect(typeof qualityData["known_facts"]).toBe("number")
          expect(typeof qualityData["unknown_facts"]).toBe("number")
          expect(typeof qualityData["active_files_count"]).toBe("number")
          expect(typeof qualityData["next_steps_count"]).toBe("number")
        }

        const reportEntry = manifest.entries.find((e) => compactionPattern.test(e.path) && e.path.endsWith("/compaction.report.json"))
        expect(reportEntry).toBeTruthy()
        if (reportEntry && quality) {
          const reportText = await Bun.file(path.join(tmp.path, reportEntry.path)).text()
          const report = JSON.parse(reportText) as {
            quality?: Record<string, unknown>
          }
          expect(report.quality).toBeTruthy()
          const qualityData = quality.data ?? {}
          expect(report.quality?.["semantic_coverage"]).toBe(qualityData["semantic_coverage"])
          expect(report.quality?.["known_facts"]).toBe(qualityData["known_facts"])
          expect(report.quality?.["unknown_facts"]).toBe(qualityData["unknown_facts"])
          expect(report.quality?.["active_files_count"]).toBe(qualityData["active_files_count"])
          expect(report.quality?.["next_steps_count"]).toBe(qualityData["next_steps_count"])
        }
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

  test("missing anchor snapshot in restore chain fails closed", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const sessionId = session.id
        const msg = await writeText({ sessionId, text: "please compact with restore baseline" })
        const msgs = await Session.messages({ sessionID: sessionId })

        await ContextLedger.update({
          sessionId,
          patch: {
            lastContextPackId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
          },
        })

        const abort = new AbortController()
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
        const reason = String(data["reason_zh"] ?? "")
        expect(reason.includes("fail-closed")).toBe(true)
        expect(reason.includes("anchor")).toBe(true)
      },
    })
  })
})
