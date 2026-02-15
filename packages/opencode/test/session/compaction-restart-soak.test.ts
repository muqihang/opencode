import { describe, expect, test } from "bun:test"
import path from "path"
import { EvidenceReader } from "../../src/evidence/reader"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { tmpdir } from "../fixture/fixture"

const timeout = 45_000

const loadCompaction = async (tag: string) => import(`../../src/session/compaction.ts?${tag}`)

const writeUser = async (input: { sessionId: string; text: string }) => {
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

const runRound = async (input: { sessionId: string; round: number; tag: string }) => {
  const mod = await loadCompaction(input.tag)
  await writeUser({
    sessionId: input.sessionId,
    text:
      `Round ${input.round}: keep compaction deterministic and preserve checkpoint continuity. ` +
      `Round ${input.round}: update packages/opencode/src/session/compaction.ts and verify restart monotonicity. ` +
      "x".repeat(6000),
  })
  await mod.SessionCompaction.create({
    sessionID: input.sessionId,
    agent: "default",
    model: { providerID: "openai", modelID: "gpt-4" },
    auto: false,
  })

  const list = await Session.messages({ sessionID: input.sessionId })
  const req = list.findLast((item) => item.info.role === "user" && item.parts.some((part) => part.type === "compaction"))
  expect(req).toBeTruthy()
  if (!req) throw new Error("missing compaction request")

  const result = await mod.SessionCompaction.process({
    parentID: req.info.id,
    messages: list,
    sessionID: input.sessionId,
    abort: new AbortController().signal,
    auto: false,
  })
  expect(result).toBe("continue")

  const events = await EvidenceReader.readEvents(input.sessionId, { cursor: 0, limit: 1000 })
  const completedRows = events.events.filter((item) => item.type === "compaction.completed")
  const qualityRows = events.events.filter((item) => item.type === "compaction.quality")
  expect(completedRows.length).toBeGreaterThanOrEqual(input.round)
  expect(qualityRows.length).toBeGreaterThanOrEqual(input.round)

  const quality = qualityRows.at(-1)
  expect(quality).toBeTruthy()
  if (!quality) throw new Error("missing compaction.quality")
  const qualityData = quality.data ?? {}
  expect(typeof qualityData["consistency_score"]).toBe("number")
  expect(typeof qualityData["contradiction_count"]).toBe("number")
  expect(Array.isArray(qualityData["reason_codes"])).toBe(true)

  const reportPath = String(qualityData["report_artifact"] ?? "")
  expect(reportPath.length).toBeGreaterThan(0)
  const reportText = await Bun.file(path.join(Instance.worktree, reportPath)).text()
  const report = JSON.parse(reportText) as {
    compactionId?: string
    previous?: { compactionId?: string }
    quality?: Record<string, unknown>
  }
  expect(report.compactionId).toBeTruthy()
  expect(report.quality?.["consistency_score"]).toBe(qualityData["consistency_score"])
  expect(report.quality?.["contradiction_count"]).toBe(qualityData["contradiction_count"])
  expect(report.quality?.["reason_codes"]).toEqual(qualityData["reason_codes"])

  const statePath = path.join(Instance.worktree, ".opencode", "compaction", input.sessionId, "state.json")
  const stateText = await Bun.file(statePath).text()
  const state = JSON.parse(stateText) as { lastCompactionId?: string }
  expect(state.lastCompactionId).toBe(report.compactionId)

  return {
    compactionId: String(report.compactionId ?? ""),
    previousCompactionId: String(report.previous?.compactionId ?? ""),
    completedCount: completedRows.length,
  }
}

describe("compaction restart soak", () => {
  test("runs >=3 rounds and preserves restart monotonic chain", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const sessionId = session.id

        const first = await runRound({ sessionId, round: 1, tag: `r1-${Date.now()}` })
        const second = await runRound({ sessionId, round: 2, tag: `r2-${Date.now()}` })
        const third = await runRound({ sessionId, round: 3, tag: `r3-${Date.now()}` })

        expect(second.previousCompactionId).toBe(first.compactionId)
        expect(third.previousCompactionId).toBe(second.compactionId)

        const ids = [first.compactionId, second.compactionId, third.compactionId]
        expect(new Set(ids).size).toBeGreaterThanOrEqual(3)
        expect(ids[1] > ids[0]).toBe(true)
        expect(ids[2] > ids[1]).toBe(true)

        expect(first.completedCount).toBe(1)
        expect(second.completedCount).toBe(2)
        expect(third.completedCount).toBe(3)
      },
    })
  }, { timeout })
})
