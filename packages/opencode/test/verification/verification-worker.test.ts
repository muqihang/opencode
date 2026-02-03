import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { runVerification, VerificationStats } from "../../src/verification"
import { EvidenceWriter } from "../../src/evidence/writer"
import { EventV1 } from "../../src/protocol/event"
import { defer } from "../../src/util/defer"

const buildCtx = (sessionId: string) => ({
  sessionID: sessionId,
  messageID: "",
  callID: "",
  agent: "verification",
  abort: AbortSignal.any([]),
  metadata: () => {},
  ask: async () => {},
})

describe("verification.worker", () => {
  test("valid citations pass", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionId = "verifier-test"
        const base = path.join(Instance.worktree, ".opencode", "artifacts", sessionId)
        const root = path.join(base, "derived", "input-1")
        await Bun.write(path.join(root, "note.txt"), "hello\nworld\n")

        const result = await runVerification({
          taskFrame: { specVersion: "task-frame/1.0", sessionId, contextPackId: "ctx-1" },
          mode: "strict",
          budget: { timeMs: 20000 },
          claims: [
            {
              id: "c1",
              text: "hello",
              pointers: [{ path: "derived/input-1/note.txt" }],
            },
          ],
          ctx: buildCtx(sessionId),
        })

        expect(result.ok).toBe(true)
        const writer = await EvidenceWriter.open({ sessionId })
        const manifest = await writer.manifest()
        const report = manifest.entries.find((entry) => entry.path.includes("verification.report.json"))
        expect(report).toBeDefined()
        const view = manifest.entries.find((entry) => entry.path.includes("verification.report.view.md"))
        expect(view).toBeDefined()
        const viewText = await Bun.file(path.join(Instance.worktree, view!.path)).text()
        expect(viewText).toContain("# 核验报告")
        expect(viewText).toContain("模式: 严格 (strict)")
        expect(viewText).toContain("结论: 通过")
        expect(viewText).toContain("断言统计:")
        expect(viewText).toContain("可验证 (supported)")

        const eventsPath = path.join(Instance.worktree, ".opencode", "evidence", sessionId, "events.jsonl")
        const eventsText = await Bun.file(eventsPath).text()
        const types = eventsText
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => EventV1.parse(JSON.parse(line)).type)
        expect(types).toContain("verification.requested")
        expect(types).toContain("verification.completed")
      },
    })
  })

  test("redaction high risk fails with chinese hint", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionId = "verifier-test-2"
        const base = path.join(Instance.worktree, ".opencode", "artifacts", sessionId)
        const root = path.join(base, "derived", "input-2")
        await Bun.write(path.join(root, "pii.txt"), "ssn 123-45-6789")

        const result = await runVerification({
          taskFrame: { specVersion: "task-frame/1.0", sessionId, contextPackId: "ctx-2" },
          mode: "balanced",
          budget: { timeMs: 20000 },
          claims: [
            {
              id: "c2",
              text: "contains pii",
              pointers: [{ path: "derived/input-2/pii.txt" }],
            },
          ],
          ctx: buildCtx(sessionId),
        })

        expect(result.ok).toBe(false)
        expect(result.hint).toContain("高风险")
      },
    })
  })

  test("verification cache uses ssot store and hit skips scripts", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionId = "verifier-cache"
        const base = path.join(Instance.worktree, ".opencode", "artifacts", sessionId)
        const root = path.join(base, "derived", "input-1")
        await Bun.write(path.join(root, "note.txt"), "hello\nworld\n")

        VerificationStats.scripts = 0

        const one = await runVerification({
          taskFrame: { specVersion: "task-frame/1.0", sessionId, contextPackId: "ctx-cache-1" },
          mode: "strict",
          budget: { timeMs: 20000 },
          claims: [
            {
              id: "c1",
              text: "hello",
              pointers: [{ path: "derived/input-1/note.txt" }],
            },
          ],
          ctx: buildCtx(sessionId),
        })

        const firstScripts = VerificationStats.scripts
        expect(firstScripts).toBeGreaterThan(0)
        expect(one.ok).toBe(true)

        const two = await runVerification({
          taskFrame: { specVersion: "task-frame/1.0", sessionId, contextPackId: "ctx-cache-2" },
          mode: "strict",
          budget: { timeMs: 20000 },
          claims: [
            {
              id: "c1",
              text: "hello",
              pointers: [{ path: "derived/input-1/note.txt" }],
            },
          ],
          ctx: buildCtx(sessionId),
        })

        expect(two.ok).toBe(true)
        expect(VerificationStats.scripts).toBe(firstScripts)

        const eventsPath = path.join(Instance.worktree, ".opencode", "evidence", sessionId, "events.jsonl")
        const eventsText = await Bun.file(eventsPath).text()
        const events = eventsText
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => EventV1.parse(JSON.parse(line)))

        const writes = events.filter((e) => e.type === "cache.write" && e.data?.namespace === "verification")
        expect(writes.length).toBeGreaterThan(0)
        const hits = events.filter((e) => e.type === "cache.hit" && e.data?.namespace === "verification")
        expect(hits.length).toBeGreaterThan(0)
      },
    })
  })

  test("verification ssot cache does not double-run worker on miss", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionId = "verifier-miss-once"
        const base = path.join(Instance.worktree, ".opencode", "artifacts", sessionId)
        const root = path.join(base, "derived", "input-1")
        await Bun.write(path.join(root, "note.txt"), "hello\nworld\n")

        await runVerification({
          taskFrame: { specVersion: "task-frame/1.0", sessionId, contextPackId: "ctx-miss-once" },
          mode: "strict",
          budget: { timeMs: 20000 },
          claims: [
            {
              id: "c1",
              text: "hello",
              pointers: [{ path: "derived/input-1/note.txt" }],
            },
          ],
          ctx: buildCtx(sessionId),
        })

        const eventsPath = path.join(Instance.worktree, ".opencode", "evidence", sessionId, "events.jsonl")
        const eventsText = await Bun.file(eventsPath).text()
        const events = eventsText
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => EventV1.parse(JSON.parse(line)))

        const requested = events.filter((e) => e.type === "verification.requested")
        expect(requested.length).toBe(1)
      },
    })
  })

  test("verification cache can be disabled via env and then scripts run again", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const prev = process.env["OPENCODE_DISABLE_CACHE_STORE"]
        process.env["OPENCODE_DISABLE_CACHE_STORE"] = "1"
        using _ = defer(() => {
          if (prev === undefined) delete process.env["OPENCODE_DISABLE_CACHE_STORE"]
          else process.env["OPENCODE_DISABLE_CACHE_STORE"] = prev
        })

        const sessionId = "verifier-disabled"
        const base = path.join(Instance.worktree, ".opencode", "artifacts", sessionId)
        const root = path.join(base, "derived", "input-1")
        await Bun.write(path.join(root, "note.txt"), "hello\nworld\n")

        VerificationStats.scripts = 0

        await runVerification({
          taskFrame: { specVersion: "task-frame/1.0", sessionId, contextPackId: "ctx-disabled-1" },
          mode: "strict",
          budget: { timeMs: 20000 },
          claims: [
            {
              id: "c1",
              text: "hello",
              pointers: [{ path: "derived/input-1/note.txt" }],
            },
          ],
          ctx: buildCtx(sessionId),
        })

        const afterOne = VerificationStats.scripts
        expect(afterOne).toBeGreaterThan(0)

        await runVerification({
          taskFrame: { specVersion: "task-frame/1.0", sessionId, contextPackId: "ctx-disabled-2" },
          mode: "strict",
          budget: { timeMs: 20000 },
          claims: [
            {
              id: "c1",
              text: "hello",
              pointers: [{ path: "derived/input-1/note.txt" }],
            },
          ],
          ctx: buildCtx(sessionId),
        })

        expect(VerificationStats.scripts).toBeGreaterThan(afterOne)

        const eventsPath = path.join(Instance.worktree, ".opencode", "evidence", sessionId, "events.jsonl")
        const eventsText = await Bun.file(eventsPath).text()
        const events = eventsText
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => EventV1.parse(JSON.parse(line)))

        const reads = events.filter((e) => e.type === "cache.read" && e.data?.namespace === "verification")
        expect(reads.length).toBeGreaterThan(0)
        expect(reads.some((e) => e.data?.decision === "disabled")).toBe(true)

        const config = events.find((e) => e.type === "cache.config_effective")
        expect(Boolean(config)).toBe(true)
        const sources = config!.data?.sources as { env?: Record<string, unknown> } | undefined
        expect(sources?.env?.OPENCODE_DISABLE_CACHE_STORE).toBe("1")
      },
    })
  })
})
