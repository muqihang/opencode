import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { Session } from "../../src/session"
import { Identifier } from "../../src/id/id"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionCompaction } from "../../src/session/compaction"
import { SessionHistorySummary } from "../../src/session/history-summary"
import { ContextBlocks } from "../../src/session/context-blocks"
import { ContextPackBuilder } from "../../src/session/context-pack"
import { ContextPack } from "../../src/protocol/context-pack"
import { EvidenceReader } from "../../src/evidence/reader"
import { Log } from "../../src/util/log"

Log.init({ print: false })

const timeout = 30_000

const makeUser = async (input: { sessionId: string; text: string }) => {
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

const makeAssistant = async (input: { sessionId: string; parentId: string; text: string }) => {
  const msg = (await Session.updateMessage({
    id: Identifier.ascending("message"),
    role: "assistant",
    sessionID: input.sessionId,
    parentID: input.parentId,
    mode: "default",
    agent: "default",
    path: { cwd: Instance.directory, root: Instance.worktree },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: "gpt-4",
    providerID: "openai",
    time: { created: Date.now() },
    finish: "end_turn",
  })) as MessageV2.Assistant
  await Session.updatePart({
    id: Identifier.ascending("part"),
    messageID: msg.id,
    sessionID: input.sessionId,
    type: "text",
    text: input.text,
  })
  return msg
}

describe("structured compaction regression", () => {
  test("multi-round history compacts and context-pack tokenEstimate drops with traceable pointers", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const sessionId = session.id

        const rounds = Array.from({ length: 6 }, (_, i) => i + 1)
        await rounds.reduce(async (prev, round) => {
          await prev
          const user = await makeUser({ sessionId, text: `Round ${round}: ` + "x".repeat(20_000) })
          await makeAssistant({ sessionId, parentId: user.id, text: `Ack ${round}: ` + "y".repeat(10_000) })
          return
        }, Promise.resolve())

        const before = await MessageV2.filterCompacted(MessageV2.stream(sessionId))
        const beforeSummary = SessionHistorySummary.build(before)
        expect(beforeSummary.kind).toBe("window")
        expect((beforeSummary.text ?? "").length).toBeGreaterThan(0)

        const model = { providerID: "openai", id: "gpt-test", limit: { context: 4096, input: 2048, output: 1024 } }
        const blocksBefore = ContextBlocks.build({
          permissions: "PERMS",
          developer: "DEV",
          user: "USER",
          toolset: { version: "v1", tools: [] },
          environment: "ENV",
          capsule: "CAP",
          decisionBoundary: "DECISION",
          historySummary: beforeSummary.text,
          workspaceFingerprint: "ws-1",
          artifactRoot: "context/pack-test/blocks",
        })
        const packBefore = ContextPack.parse(
          ContextPackBuilder.build({
            sessionId,
            messageId: "message_before",
            model,
            blocks: blocksBefore,
          }),
        )

        await SessionCompaction.create({
          sessionID: sessionId,
          agent: "default",
          model: { providerID: "openai", modelID: "gpt-4" },
          auto: false,
        })
        const list = await Session.messages({ sessionID: sessionId })
        const compactionUser = list.findLast((m) => m.info.role === "user" && m.parts.some((p) => p.type === "compaction"))
        expect(compactionUser).toBeTruthy()
        if (!compactionUser) return

        const abort = new AbortController()
        const compacted = await SessionCompaction.process({
          parentID: compactionUser.info.id,
          messages: list,
          sessionID: sessionId,
          abort: abort.signal,
          auto: false,
        })
        expect(compacted).toBe("continue")

        const after = await MessageV2.filterCompacted(MessageV2.stream(sessionId))
        const afterSummary = SessionHistorySummary.build(after)
        expect(afterSummary.kind).toBe("summary")
        expect(afterSummary.tokenEstimate).toBeGreaterThan(0)

        const blocksAfter = ContextBlocks.build({
          permissions: "PERMS",
          developer: "DEV",
          user: "USER",
          toolset: { version: "v1", tools: [] },
          environment: "ENV",
          capsule: "CAP",
          decisionBoundary: "DECISION",
          historySummary: afterSummary.text,
          workspaceFingerprint: "ws-1",
          artifactRoot: "context/pack-test/blocks",
        })
        const packAfter = ContextPack.parse(
          ContextPackBuilder.build({
            sessionId,
            messageId: "message_after",
            model,
            blocks: blocksAfter,
          }),
        )

        expect(packAfter.totals.tokenEstimate).toBeLessThan(packBefore.totals.tokenEstimate * 0.6)
        for (const segment of packAfter.segments) {
          expect(segment.sources.length).toBeGreaterThan(0)
          expect(segment.sources.some((s) => Boolean(s.sha256))).toBe(true)
        }

        const manifest = await EvidenceReader.readManifest(sessionId)
        const capsule = manifest.entries.find(
          (e) => e.path.includes("/artifacts/") && e.path.includes("/compaction/") && e.path.endsWith("/capsule.md"),
        )
        expect(capsule).toBeTruthy()
        if (!capsule) return
        const capsuleFile = path.join(tmp.path, capsule.path)
        expect(await Bun.file(capsuleFile).exists()).toBe(true)
        expect(capsule.sha256.length).toBe(64)

        const events = await EvidenceReader.readEvents(sessionId, { cursor: 0, limit: 1000 })
        const started = events.events.findLast((item) => item.type === "compaction.started")
        const quality = events.events.findLast((item) => item.type === "compaction.quality")
        const completed = events.events.findLast((item) => item.type === "compaction.completed")
        expect(quality).toBeTruthy()
        if (!quality) return
        const data = quality.data ?? {}
        expect(typeof data["probe_correlation_id"]).toBe("string")
        expect(typeof data["consistency_score"]).toBe("number")
        expect(typeof data["anchor_consistency_score"]).toBe("number")
        expect(typeof data["contradiction_count"]).toBe("number")
        expect(typeof data["contradiction_rate"]).toBe("number")
        expect(Number(data["consistency_score"])).toBeGreaterThanOrEqual(0)
        expect(Number(data["consistency_score"])).toBeLessThanOrEqual(1)
        expect(Number(data["anchor_consistency_score"])).toBeGreaterThanOrEqual(0)
        expect(Number(data["anchor_consistency_score"])).toBeLessThanOrEqual(1)
        expect(Number(data["contradiction_count"])).toBeGreaterThanOrEqual(0)
        expect(Number(data["contradiction_rate"])).toBeGreaterThanOrEqual(0)
        expect(Number(data["contradiction_rate"])).toBeLessThanOrEqual(1)
        expect(Array.isArray(data["reason_codes"])).toBe(true)
        expect((data["reason_codes"] as unknown[]).every((item) => typeof item === "string")).toBe(true)

        expect(typeof started?.data?.["probe_correlation_id"]).toBe("string")
        expect(typeof completed?.data?.["probe_correlation_id"]).toBe("string")
        expect(started?.data?.["probe_correlation_id"]).toBe(data["probe_correlation_id"])
        expect(completed?.data?.["probe_correlation_id"]).toBe(data["probe_correlation_id"])

        const reportPath = String(data["report_artifact"] ?? "")
        expect(reportPath.length).toBeGreaterThan(0)
        const report = (await Bun.file(path.join(Instance.worktree, reportPath)).json()) as {
          probe_correlation_id?: string
          quality?: Record<string, unknown>
        }
        expect(typeof report.probe_correlation_id).toBe("string")
        expect(report.probe_correlation_id).toBe(String(data["probe_correlation_id"] ?? ""))
        expect(report.quality?.["consistency_score"]).toBe(data["consistency_score"])
        expect(report.quality?.["anchor_consistency_score"]).toBe(data["anchor_consistency_score"])
        expect(report.quality?.["contradiction_count"]).toBe(data["contradiction_count"])
        expect(report.quality?.["contradiction_rate"]).toBe(data["contradiction_rate"])
        expect(report.quality?.["reason_codes"]).toEqual(data["reason_codes"])
      },
    })
  }, { timeout })
})
