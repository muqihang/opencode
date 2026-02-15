import { expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { runRetrieval } from "../../src/retrieval/runner"
import { ContextPackBuilder } from "../../src/session/context-pack"
import { ContextBlocks } from "../../src/session/context-blocks"
import { EventV1 } from "../../src/protocol/event"
import { EvidenceBundleCompatV2, EvidenceBundleV2 } from "../../src/protocol/evidence-bundle"
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

function probePath(input: { sessionId: string; artifactPath: string }) {
  const value = input.artifactPath.replace(/\\/g, "/")
  if (path.isAbsolute(value)) return value
  if (value.startsWith(".opencode/")) return path.join(Instance.worktree, ...value.split("/"))
  return path.join(Instance.worktree, ".opencode", "artifacts", input.sessionId, ...value.split("/"))
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
      const derivedRoot = path.join(Instance.worktree, ".opencode", "artifacts", "session_r", "derived", "input-freshness")
      await fs.mkdir(path.join(derivedRoot, "unpacked"), { recursive: true })
      await Bun.write(path.join(derivedRoot, "chunks.json"), JSON.stringify([{ chunk_index: 0 }]))

      const run = await runRetrieval({
        sessionId: "session_r",
        messageId: "msg_r",
        intentText: "alpha",
        abort: new AbortController().signal,
      })

      expect(run.retrievalId.length).toBeGreaterThan(0)
      expect(run.artifacts.hits.endsWith(`retrieval/${run.retrievalId}/hits.json`)).toBe(true)
      expect(run.artifacts.bundle.endsWith(`retrieval/${run.retrievalId}/evidence.bundle.v2.json`)).toBe(true)
      expect(run.evidencePointers.bundle.specVersion).toBe("evidence-bundle/2.0")
      expect(run.evidencePointers.bundle.retrievalId).toBe(run.retrievalId)
      EvidenceBundleCompatV2.parse(run.evidencePointers.compat)
      expect(run.evidencePointers.compat.v1Total).toBe(run.evidencePointers.compat.v2Total)
      expect(run.evidencePointers.compat.v1TopK).toBe(run.evidencePointers.compat.v2TopEvidence)
      expect(run.evidencePointers.rerank.fallback.condition).toBe("density_missing_or_invalid")
      expect(typeof run.evidencePointers.rerank.fallback.triggered).toBe("boolean")

      const hitsFile = path.join(Instance.worktree, run.artifacts.hits)
      const hits = JSON.parse(await Bun.file(hitsFile).text()) as Array<Record<string, unknown>>
      expect(hits.length).toBeGreaterThan(0)
      expect(hits.some((item) => item.source === "workbench")).toBe(true)
      for (const hit of hits) {
        expect(typeof hit.observed_at).toBe("string")
        expect(Number.isNaN(Date.parse(hit.observed_at as string))).toBe(false)
        expect(typeof hit.freshness_score).toBe("number")
        expect(typeof hit.stale_reason).toBe("string")
        expect(typeof hit.densityScore).toBe("number")
        expect((hit.densityScore as number) >= 0).toBe(true)
        expect((hit.densityScore as number) <= 1).toBe(true)
      }

      const bundleFile = path.join(Instance.worktree, run.artifacts.bundle)
      const bundle = JSON.parse(await Bun.file(bundleFile).text()) as {
        specVersion?: string
        hits?: Array<{ densityScore?: unknown }>
      }
      const parsedBundle = EvidenceBundleV2.parse(bundle)
      expect(bundle.specVersion).toBe("evidence-bundle/2.0")
      expect(Array.isArray(bundle.hits)).toBe(true)
      expect(bundle.hits?.every((item) => typeof item.densityScore === "number")).toBe(true)
      expect(parsedBundle.rerank.fallback.condition).toBe("density_missing_or_invalid")

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
}, { timeout: 20000 })

test("retrieval degraded event carries non-empty reason and error", async () => {
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
      const sessionId = "session_r_degraded"
      const root = path.join(Instance.worktree, ".opencode", "artifacts", sessionId, "derived", "input-bad")
      await fs.mkdir(root, { recursive: true })
      await Bun.write(path.join(root, "pdf.pages.json"), "{broken")

      const run = await runRetrieval({
        sessionId,
        messageId: "msg_degraded",
        intentText: "alpha",
        abort: new AbortController().signal,
      })

      const eventsPathValue = await eventsPath(sessionId)
      const events = (await Bun.file(eventsPathValue).text())
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => EventV1.parse(JSON.parse(line)))
      const event = events.find((item) => item.type === "retrieval.degraded" && item.data?.retrievalId === run.retrievalId)

      expect(Boolean(event)).toBe(true)
      const reason = event?.data?.reason
      const error = event?.data?.error
      expect(typeof reason).toBe("string")
      expect((reason as string).length).toBeGreaterThan(0)
      expect(typeof error).toBe("string")
      expect((error as string).length).toBeGreaterThan(0)
      expect(typeof run.artifacts.errors).toBe("string")
      expect((run.artifacts.errors ?? "").length).toBeGreaterThan(0)
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

test("retrieval writes probe journal and marks duplicate probe by message+key", async () => {
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
      const sessionId = "session_probe"
      const messageId = "msg_probe"

      const one = await runRetrieval({
        sessionId,
        messageId,
        intentText: "alpha",
        abort: new AbortController().signal,
      })
      const two = await runRetrieval({
        sessionId,
        messageId,
        intentText: "alpha",
        abort: new AbortController().signal,
      })

      const onePath = probePath({ sessionId, artifactPath: one.artifacts.probe })
      const twoPath = probePath({ sessionId, artifactPath: two.artifacts.probe })

      const oneProbe = JSON.parse(await Bun.file(onePath).text()) as {
        specVersion?: string
        messageId?: string
        probeId?: string
        probe_correlation_id?: string
        dedupeKey?: string
        why?: string
        queries?: unknown
        expectedEvidence?: { artifacts?: unknown }
        dedupe?: { duplicate?: boolean; seen?: number }
      }
      const twoProbe = JSON.parse(await Bun.file(twoPath).text()) as {
        specVersion?: string
        messageId?: string
        probeId?: string
        probe_correlation_id?: string
        dedupeKey?: string
        why?: string
        queries?: unknown
        expectedEvidence?: { artifacts?: unknown }
        dedupe?: { duplicate?: boolean; seen?: number }
      }

      expect(oneProbe.specVersion).toBe("probe-journal/1.0")
      expect(oneProbe.messageId).toBe(messageId)
      expect(typeof oneProbe.probeId).toBe("string")
      expect(typeof oneProbe.probe_correlation_id).toBe("string")
      expect(typeof oneProbe.dedupeKey).toBe("string")
      expect(typeof oneProbe.why).toBe("string")
      expect(Array.isArray(oneProbe.queries)).toBe(true)
      expect(Array.isArray(oneProbe.expectedEvidence?.artifacts)).toBe(true)

      expect(twoProbe.specVersion).toBe("probe-journal/1.0")
      expect(twoProbe.messageId).toBe(messageId)
      expect(typeof twoProbe.probe_correlation_id).toBe("string")
      expect(twoProbe.dedupeKey).toBe(oneProbe.dedupeKey)
      expect(twoProbe.probe_correlation_id).toBe(oneProbe.probe_correlation_id)
      expect(oneProbe.dedupe?.duplicate).toBe(false)
      expect(twoProbe.dedupe?.duplicate).toBe(true)
      expect(twoProbe.dedupe?.seen).toBeGreaterThanOrEqual(2)

      const eventsPathValue = await eventsPath(sessionId)
      const eventsText = await Bun.file(eventsPathValue).text()
      const events = eventsText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => EventV1.parse(JSON.parse(line)))
      const oneStart = events.find((event) => event.type === "retrieval.started" && event.data?.retrievalId === one.retrievalId)
      const oneTerminal = events.find(
        (event) => event.data?.retrievalId === one.retrievalId && event.type !== "retrieval.started" && event.type.startsWith("retrieval."),
      )
      const twoStart = events.find((event) => event.type === "retrieval.started" && event.data?.retrievalId === two.retrievalId)
      const twoTerminal = events.find(
        (event) => event.data?.retrievalId === two.retrievalId && event.type !== "retrieval.started" && event.type.startsWith("retrieval."),
      )

      expect(typeof oneStart?.data?.["probe_correlation_id"]).toBe("string")
      expect(typeof oneTerminal?.data?.["probe_correlation_id"]).toBe("string")
      expect(typeof twoStart?.data?.["probe_correlation_id"]).toBe("string")
      expect(typeof twoTerminal?.data?.["probe_correlation_id"]).toBe("string")

      expect(oneStart?.data?.["probe_correlation_id"]).toBe(oneProbe.probe_correlation_id)
      expect(oneTerminal?.data?.["probe_correlation_id"]).toBe(oneProbe.probe_correlation_id)
      expect(twoStart?.data?.["probe_correlation_id"]).toBe(twoProbe.probe_correlation_id)
      expect(twoTerminal?.data?.["probe_correlation_id"]).toBe(twoProbe.probe_correlation_id)
      expect(oneStart?.data?.["probe_correlation_id"]).toBe(twoStart?.data?.["probe_correlation_id"])
    },
  })
})
