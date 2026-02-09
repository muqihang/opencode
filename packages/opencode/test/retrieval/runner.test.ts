import { expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { runRetrieval } from "../../src/retrieval/runner"
import { ContextPackBuilder } from "../../src/session/context-pack"
import { ContextBlocks } from "../../src/session/context-blocks"
import { EventV1 } from "../../src/protocol/event"
import { CodeRetrievalStats } from "../../src/retrieval/code"
import { defer } from "../../src/util/defer"
import { evidenceCandidates, resolveTenantScope } from "../../src/util/tenant-context"

async function eventsPath(sessionId: string) {
  const scope = resolveTenantScope()
  const candidates = evidenceCandidates({
    base: Instance.worktree,
    sessionId,
    tenantId: scope.tenantId,
    orgId: scope.orgId,
  }).map((dir) => path.join(dir, "events.jsonl"))
  for (const candidate of candidates) {
    const exists = await Bun.file(candidate).exists()
    if (exists) return candidate
  }
  return candidates[0]!
}

test("retrieval events are call-scoped and context pack includes evidence pointers", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      await fs.mkdir(path.join(dir, "src"), { recursive: true })
      await Bun.write(path.join(dir, "src", "alpha.ts"), "export const alpha = 1\n")
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const run = await runRetrieval({
        sessionId: "session_r",
        messageId: "msg_r",
        intentText: "alpha",
        abort: new AbortController().signal,
      })

      expect(run.retrievalId.length).toBeGreaterThan(0)
      expect(run.artifacts.hits.endsWith(`retrieval/${run.retrievalId}/hits.json`)).toBe(true)

      const eventsPathValue = await eventsPath("session_r")
      const events = (await Bun.file(eventsPathValue).text())
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
      const started = events.find((item) => item.type === "retrieval.started" && item.data?.retrievalId === run.retrievalId)
      const terminal = events.find(
        (item) =>
          item.data?.retrievalId === run.retrievalId &&
          item.type !== "retrieval.started" &&
          item.type.startsWith("retrieval."),
      )

      expect(Boolean(started)).toBe(true)
      expect(Boolean(terminal)).toBe(true)

      const blocks = ContextBlocks.build({
        permissions: "PERMS",
        developer: "DEV",
        user: "USER",
        toolset: { version: "v1", tools: [] },
        environment: "ENV",
        capsule: "CAP",
        decisionBoundary: "DECISION",
        historySummary: "",
        workspaceFingerprint: "ws-1",
        artifactRoot: "context/pack-test/blocks",
      })
      const pack = ContextPackBuilder.build({
        sessionId: "session_r",
        messageId: "msg_r",
        model: { providerID: "test", id: "test", limit: { context: 4000, output: 512 } },
        blocks,
        evidencePointers: run.evidencePointers,
      })
      const seg = pack.segments.find((item) => item.kind === "evidence_pointers")
      expect(Boolean(seg)).toBe(true)
    },
  })
})

test("retrieval cache uses ssot store and hit skips heavy code retrieval", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      await fs.mkdir(path.join(dir, "src"), { recursive: true })
      await Bun.write(path.join(dir, "src", "alpha.ts"), "export const alpha = 1\n")
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      CodeRetrievalStats.runs = 0
      const sessionId = "session_r_cache"

      const one = await runRetrieval({
        sessionId,
        messageId: "msg_1",
        intentText: "alpha",
        abort: new AbortController().signal,
      })

      const two = await runRetrieval({
        sessionId,
        messageId: "msg_2",
        intentText: "alpha",
        abort: new AbortController().signal,
      })

      expect(one.retrievalCacheKey).toBe(two.retrievalCacheKey)
      expect(CodeRetrievalStats.runs).toBe(1)

      const eventsPathValue = await eventsPath(sessionId)
      const eventsText = await Bun.file(eventsPathValue).text()
      const events = eventsText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => EventV1.parse(JSON.parse(line)))

      const writes = events.filter((e) => e.type === "cache.write" && e.data?.namespace === "retrieval")
      expect(writes.length).toBeGreaterThan(0)

      const hits = events.filter((e) => e.type === "cache.hit" && e.data?.namespace === "retrieval")
      expect(hits.length).toBeGreaterThan(0)

      const write = writes[0]!
      const artifact = write.data?.artifact as { path?: string; sha256?: string; kind?: string } | undefined
      expect(Boolean(artifact?.path)).toBe(true)
      expect(Boolean(artifact?.sha256)).toBe(true)

      const key = write.data?.key
      expect(typeof key).toBe("string")
      const file = path.join(Instance.worktree, ".opencode", "cache", "store", "retrieval", "entries", `${key}.json`)
      expect(await Bun.file(file).exists()).toBe(true)
    },
  })
})

test("retrieval cache can be disabled via env and then heavy work runs again", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      await fs.mkdir(path.join(dir, "src"), { recursive: true })
      await Bun.write(path.join(dir, "src", "alpha.ts"), "export const alpha = 1\n")
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const prev = process.env["OPENCODE_DISABLE_CACHE_STORE"]
      process.env["OPENCODE_DISABLE_CACHE_STORE"] = "1"
      using _ = defer(() => {
        if (prev === undefined) delete process.env["OPENCODE_DISABLE_CACHE_STORE"]
        else process.env["OPENCODE_DISABLE_CACHE_STORE"] = prev
      })

      CodeRetrievalStats.runs = 0
      const sessionId = "session_r_disabled"

      const one = await runRetrieval({
        sessionId,
        messageId: "msg_1",
        intentText: "alpha",
        abort: new AbortController().signal,
      })
      const two = await runRetrieval({
        sessionId,
        messageId: "msg_2",
        intentText: "alpha",
        abort: new AbortController().signal,
      })

      expect(one.retrievalCacheKey).toBe(two.retrievalCacheKey)
      expect(CodeRetrievalStats.runs).toBe(2)

      const eventsPathValue = await eventsPath(sessionId)
      const eventsText = await Bun.file(eventsPathValue).text()
      const events = eventsText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => EventV1.parse(JSON.parse(line)))

      const reads = events.filter((e) => e.type === "cache.read" && e.data?.namespace === "retrieval")
      expect(reads.length).toBeGreaterThan(0)
      expect(reads.some((e) => e.data?.decision === "disabled")).toBe(true)

      const config = events.find((e) => e.type === "cache.config_effective")
      expect(Boolean(config)).toBe(true)
      const sources = config!.data?.sources as { env?: Record<string, unknown> } | undefined
      expect(sources?.env?.OPENCODE_DISABLE_CACHE_STORE).toBe("1")
    },
  })
})
