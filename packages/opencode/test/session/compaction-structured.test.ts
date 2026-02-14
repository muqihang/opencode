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
import { MessageV2 } from "../../src/session/message-v2"
import { CapsuleAssistedRunner } from "../../src/session/capsule-assisted"

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

const runStructured = async (input: { sessionId: string; parentId: string }) => {
  const msgs = await Session.messages({ sessionID: input.sessionId })
  return SessionCompaction.process({
    parentID: input.parentId,
    messages: msgs,
    sessionID: input.sessionId,
    abort: new AbortController().signal,
    auto: false,
  })
}

const summaryText = async (sessionId: string) => {
  const msgs = await Session.messages({ sessionID: sessionId })
  const msg = msgs.findLast((item) => item.info.role === "assistant" && item.info.summary)
  if (!msg) return ""
  const part = msg.parts.find((item): item is MessageV2.TextPart => item.type === "text")
  return part?.text ?? ""
}

const findEvent = async (input: { sessionId: string; type: string }) => {
  const events = await EvidenceReader.readEvents(input.sessionId, { cursor: 0, limit: 1000 })
  return events.events.findLast((item) => item.type === input.type)
}

const waitFor = async (input: { ms: number; check: () => Promise<boolean> }) => {
  const start = Date.now()
  const loop = async (): Promise<boolean> => {
    if (await input.check()) return true
    if (Date.now() - start > input.ms) return false
    await Bun.sleep(20)
    return loop()
  }
  return loop()
}

const assertNoJsonLeak = (text: string) => {
  expect(text.includes("<assistant_claims_json>")).toBe(false)
  expect(text.includes("capsule.session.json")).toBe(false)
  expect(text.includes("capsule.assisted.verify.json")).toBe(false)
  expect(/```json/iu.test(text)).toBe(false)
}

const setRunner = (fn: typeof CapsuleAssistedRunner.runFromCompaction) => {
  const old = CapsuleAssistedRunner.runFromCompaction
  ;(CapsuleAssistedRunner as { runFromCompaction: typeof CapsuleAssistedRunner.runFromCompaction }).runFromCompaction = fn
  return () => {
    ;(CapsuleAssistedRunner as { runFromCompaction: typeof CapsuleAssistedRunner.runFromCompaction }).runFromCompaction = old
  }
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

  test("assisted success applies llm view over deterministic baseline and keeps visible text JSON-free", async () => {
    const llm = "# LLM Summary\n\n- keep deterministic chain, but show verified augment"
    const restore = setRunner(
      (async () => {
        await Bun.sleep(80)
        return {
          status: "success",
          verifyOk: true,
          coverage: { known: 3, unknown: 0, anchors: 2 },
          reasonCode: "none",
          viewText: llm,
          artifacts: {
            view: {
              path: "compaction/mock-success/capsule.assisted.md",
              sha256: "a".repeat(64),
              kind: "compaction-capsule-assisted-view",
            },
          },
        } as unknown
      }) as unknown as typeof CapsuleAssistedRunner.runFromCompaction,
    )

    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, "opencode.json"), JSON.stringify({ experimental: { compaction_llm_augment: true } }))
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const sessionId = session.id
        await writeText({ sessionId, text: "Round A: keep deterministic summary first. " + "x".repeat(5_000) })
        const msg = await writeText({ sessionId, text: "Round B: please compact now" })

        const result = await runStructured({ sessionId, parentId: msg.id })
        expect(result).toBe("continue")

        const deterministic = await summaryText(sessionId)
        expect(deterministic.includes("# Capsule")).toBe(true)
        assertNoJsonLeak(deterministic)

        const appliedReady = await waitFor({
          ms: 3_000,
          check: async () => Boolean(await findEvent({ sessionId, type: "compaction.assisted_applied" })),
        })
        expect(appliedReady).toBe(true)

        const applied = await findEvent({ sessionId, type: "compaction.assisted_applied" })
        expect(applied).toBeTruthy()
        if (applied) {
          const data = applied.data ?? {}
          expect(data["ui_view_source"]).toBe("llm")
          expect(typeof data["compactionId"]).toBe("string")
          expect(typeof data["view_artifact"]).toBe("string")
        }

        const finalText = await summaryText(sessionId)
        expect(finalText).toContain("# LLM Summary")
        assertNoJsonLeak(finalText)
      },
    })

    restore()
  }, { timeout })

  test("assisted degraded keeps deterministic summary and emits skipped event", async () => {
    const restore = setRunner(
      (async () => {
        return {
          status: "degraded",
          verifyOk: false,
          reasonCode: "schema_invalid",
          coverage: { known: 1, unknown: 2, anchors: 1 },
          artifacts: {
            view: {
              path: "compaction/mock-degraded/capsule.assisted.md",
              sha256: "b".repeat(64),
              kind: "compaction-capsule-assisted-view",
            },
          },
        } as unknown
      }) as unknown as typeof CapsuleAssistedRunner.runFromCompaction,
    )

    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, "opencode.json"), JSON.stringify({ experimental: { compaction_llm_augment: true } }))
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const sessionId = session.id
        await writeText({ sessionId, text: "Round A: keep summary deterministic" })
        const msg = await writeText({ sessionId, text: "Round B: compact" })

        const result = await runStructured({ sessionId, parentId: msg.id })
        expect(result).toBe("continue")

        const deterministic = await summaryText(sessionId)
        const skippedReady = await waitFor({
          ms: 3_000,
          check: async () => Boolean(await findEvent({ sessionId, type: "compaction.assisted_skipped" })),
        })
        expect(skippedReady).toBe(true)

        const skipped = await findEvent({ sessionId, type: "compaction.assisted_skipped" })
        expect(skipped).toBeTruthy()
        if (skipped) {
          const data = skipped.data ?? {}
          expect(data["status"]).toBe("degraded")
          expect(data["reasonCode"]).toBe("assisted_degraded")
          expect(data["ui_view_source"]).toBe("deterministic")
        }

        const finalText = await summaryText(sessionId)
        expect(finalText).toBe(deterministic)
        assertNoJsonLeak(finalText)
      },
    })

    restore()
  }, { timeout })

  test("assisted failed keeps deterministic summary and emits skipped event", async () => {
    const restore = setRunner(
      (async () => {
        return {
          status: "failed",
          verifyOk: false,
          reasonCode: "provider_error",
          coverage: { known: 0, unknown: 0, anchors: 0 },
        } as unknown
      }) as unknown as typeof CapsuleAssistedRunner.runFromCompaction,
    )

    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, "opencode.json"), JSON.stringify({ experimental: { compaction_llm_augment: true } }))
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const sessionId = session.id
        await writeText({ sessionId, text: "Round A" })
        const msg = await writeText({ sessionId, text: "Round B compact" })

        const result = await runStructured({ sessionId, parentId: msg.id })
        expect(result).toBe("continue")

        const deterministic = await summaryText(sessionId)
        const skippedReady = await waitFor({
          ms: 3_000,
          check: async () => Boolean(await findEvent({ sessionId, type: "compaction.assisted_skipped" })),
        })
        expect(skippedReady).toBe(true)

        const skipped = await findEvent({ sessionId, type: "compaction.assisted_skipped" })
        expect(skipped).toBeTruthy()
        if (skipped) {
          const data = skipped.data ?? {}
          expect(data["status"]).toBe("failed")
          expect(data["reasonCode"]).toBe("assisted_failed")
          expect(data["ui_view_source"]).toBe("deterministic")
        }

        const finalText = await summaryText(sessionId)
        expect(finalText).toBe(deterministic)
        assertNoJsonLeak(finalText)
      },
    })

    restore()
  }, { timeout })

  test("config can disable llm augment and skip assisted apply entirely", async () => {
    const calls = { value: 0 }
    const restore = setRunner(
      (async () => {
        calls.value += 1
        return {
          status: "success",
          verifyOk: true,
          reasonCode: "none",
          coverage: { known: 2, unknown: 0, anchors: 1 },
          viewText: "# LLM Summary\n\n- should never show when disabled",
          artifacts: {
            view: {
              path: "compaction/mock-disabled/capsule.assisted.md",
              sha256: "c".repeat(64),
              kind: "compaction-capsule-assisted-view",
            },
          },
        } as unknown
      }) as unknown as typeof CapsuleAssistedRunner.runFromCompaction,
    )

    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, "opencode.json"), JSON.stringify({ experimental: { compaction_llm_augment: false } }))
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const sessionId = session.id
        await writeText({ sessionId, text: "Round A" })
        const msg = await writeText({ sessionId, text: "Round B compact" })

        const result = await runStructured({ sessionId, parentId: msg.id })
        expect(result).toBe("continue")

        const skippedReady = await waitFor({
          ms: 3_000,
          check: async () => Boolean(await findEvent({ sessionId, type: "compaction.assisted_skipped" })),
        })
        expect(skippedReady).toBe(true)

        const skipped = await findEvent({ sessionId, type: "compaction.assisted_skipped" })
        expect(skipped).toBeTruthy()
        if (skipped) {
          const data = skipped.data ?? {}
          expect(data["status"]).toBe("disabled")
          expect(data["reasonCode"]).toBe("disabled")
          expect(data["ui_view_source"]).toBe("deterministic")
        }

        expect(calls.value).toBe(0)
        const finalText = await summaryText(sessionId)
        expect(finalText.includes("# Capsule")).toBe(true)
        assertNoJsonLeak(finalText)
      },
    })

    restore()
  }, { timeout })
})
