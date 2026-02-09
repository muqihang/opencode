import { describe, expect, test } from "bun:test"
import path from "path"

import { EvidenceWriter } from "../../src/evidence/writer"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

import { writeUsageEvents } from "../../src/usage/events"
import { evidenceCandidates, resolveTenantScope } from "../../src/util/tenant-context"

const baseDir = () => (Instance.worktree === "/" ? Instance.directory : Instance.worktree)

async function evidenceFile(sessionId: string, name: string) {
  const scope = resolveTenantScope()
  const candidates = evidenceCandidates({
    base: baseDir(),
    sessionId,
    tenantId: scope.tenantId,
    orgId: scope.orgId,
  }).map((dir) => path.join(dir, name))
  for (const candidate of candidates) {
    const exists = await Bun.file(candidate).exists()
    if (exists) return candidate
  }
  return candidates[0]!
}

describe("usage events", () => {
  test("writes usage.normalized + cache.read/cache.write events (summary + pointers only)", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const sessionId = "ses_usage"
        const messageId = "msg_1"

        const writer = await EvidenceWriter.open({ sessionId })

        await writeUsageEvents({
          writer,
          ts: "2026-02-02T00:00:00.000Z",
          sessionId,
          messageId,
          model: {
            providerID: "openai",
            id: "gpt-5",
            api: { npm: "@ai-sdk/openai", id: "gpt-5" },
          },
          usage: { cachedInputTokens: 2 },
          metadata: {
            anthropic: { cacheCreationInputTokens: 1 },
          },
          tokens: {
            input: 10,
            output: 3,
            reasoning: 0,
            cache: { read: 2, write: 1 },
          },
          flags: {},
          providerRaw: { enabled: true },
        })

        const eventsPath = await evidenceFile(sessionId, "events.jsonl")
        const lines = (await Bun.file(eventsPath).text())
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)

        const types = lines.map((line) => (JSON.parse(line) as any).type)
        expect(types).toContain("usage.normalized")
        expect(types).toContain("cache.read")
        expect(types).toContain("cache.write")

        const normalized = lines
          .map((line) => JSON.parse(line) as any)
          .find((evt) => evt.type === "usage.normalized")
        expect(normalized.data?.messageId).toBe(messageId)
        expect(normalized.data?.normalized?.specVersion).toBe("usage-normalized/1.0")
        expect(normalized.data?.normalized?.providerRaw?.kind).toBe("artifact")

        const pointer = normalized.data?.normalized?.providerRaw?.pointer
        expect(typeof pointer).toBe("string")
        expect(pointer.includes(".opencode/artifacts/")).toBe(true)

        // Strong invariant: events must not embed large raw JSON.
        // We only allow tiny summary + pointers.
        expect(JSON.stringify(normalized).length).toBeLessThan(20_000)
      },
    })
  })

  test("does not emit cache.read/cache.write when cache tokens are unknown", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const sessionId = "ses_usage_unknown"
        const writer = await EvidenceWriter.open({ sessionId })

        await writeUsageEvents({
          writer,
          ts: "2026-02-02T00:00:00.000Z",
          sessionId,
          messageId: "msg_1",
          model: {
            providerID: "google",
            id: "gemini-2.5-pro",
            api: { npm: "@ai-sdk/google", id: "gemini-2.5-pro" },
          },
          usage: {},
          metadata: {},
          tokens: {
            input: 10,
            output: 3,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          flags: {},
          providerRaw: { enabled: false },
        })

        const eventsPath = await evidenceFile(sessionId, "events.jsonl")
        const lines = (await Bun.file(eventsPath).text())
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)

        const types = lines.map((line) => (JSON.parse(line) as any).type)
        expect(types).toContain("usage.normalized")
        expect(types).not.toContain("cache.read")
        expect(types).not.toContain("cache.write")
      },
    })
  })
})
