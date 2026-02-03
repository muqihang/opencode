import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { ContextBlocks } from "../../src/session/context-blocks"
import { ContextPackCache, ContextPackStats } from "../../src/session/context-pack-cache"
import { ulid } from "ulid"
import { CachePolicy } from "../../src/cache/policy"
import { defer } from "../../src/util/defer"

const baseDir = () => (Instance.worktree === "/" ? Instance.directory : Instance.worktree)

describe("context-pack cache store", () => {
  test("cache hit skips segments rebuild and keeps block sources call-scoped", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const scope = { projectId: Instance.project.id, worktreeRoot: baseDir() }
        const model = { providerID: "test", id: "test", limit: { context: 4096, output: 512 } }

        ContextPackStats.segmentsBuilt = 0
        const cp1 = ulid()
        const cp2 = ulid()
        const blocks1 = ContextBlocks.build({
          permissions: "PERMS",
          developer: "DEV",
          user: "USER",
          toolset: { version: "v1", tools: [] },
          environment: "ENV",
          capsule: "CAP",
          decisionBoundary: "DECISION",
          historySummary: "",
          workspaceFingerprint: "ws-1",
          artifactRoot: `context/${cp1}/blocks`,
        })
        const blocks2 = ContextBlocks.build({
          permissions: "PERMS",
          developer: "DEV",
          user: "USER",
          toolset: { version: "v1", tools: [] },
          environment: "ENV",
          capsule: "CAP",
          decisionBoundary: "DECISION",
          historySummary: "",
          workspaceFingerprint: "ws-1",
          artifactRoot: `context/${cp2}/blocks`,
        })
        expect(blocks1.cacheKey).toBe(blocks2.cacheKey)

        const first = await ContextPackCache.build({
          sessionId: "s1",
          messageId: "m1",
          model,
          blocks: blocks1,
          policy: { enabled: true, force: false },
          contextPackId: cp1,
          evidencePointers: {
            retrievalId: "r1",
            retrievalCacheKey: "rk-1",
            summary: { total: 0, code: 0, workbench: 0 },
            artifacts: [],
            topK: [],
          },
        })
        expect(first.pack.contextPackId).toBe(cp1)
        expect(ContextPackStats.segmentsBuilt).toBe(1)

        const second = await ContextPackCache.build({
          sessionId: "s1",
          messageId: "m2",
          model,
          blocks: blocks2,
          policy: { enabled: true, force: false },
          contextPackId: cp2,
          evidencePointers: {
            retrievalId: "r2",
            retrievalCacheKey: "rk-1",
            summary: { total: 0, code: 0, workbench: 0 },
            artifacts: [],
            topK: [],
          },
        })

        expect(second.pack.contextPackId).toBe(cp2)
        expect(second.pack.segments).not.toEqual(first.pack.segments)
        expect(ContextPackStats.segmentsBuilt).toBe(1)

        const firstRefs = first.pack.segments
          .flatMap((seg) => seg.sources ?? [])
          .map((s) => s.ref)
          .filter((ref) => ref.includes("/blocks/"))
        const secondRefs = second.pack.segments
          .flatMap((seg) => seg.sources ?? [])
          .map((s) => s.ref)
          .filter((ref) => ref.includes("/blocks/"))
        expect(firstRefs.length).toBeGreaterThan(0)
        expect(secondRefs.length).toBeGreaterThan(0)
        expect(firstRefs.every((ref) => ref.startsWith(`context/${cp1}/blocks/`))).toBe(true)
        expect(secondRefs.every((ref) => ref.startsWith(`context/${cp2}/blocks/`))).toBe(true)

        expect(first.cache.status).toBe("miss")
        expect(second.cache.status).toBe("hit")
        expect(first.cache.key).toBe(second.cache.key)
        expect(first.cache.scope).toEqual(scope)
      },
    })
  })

  test("disable + force rebuild semantics are honored", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const model = { providerID: "test", id: "test", limit: { context: 4096, output: 512 } }
        const cp = ulid()
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
          artifactRoot: `context/${cp}/blocks`,
        })

        ContextPackStats.segmentsBuilt = 0
        const disabled1 = await ContextPackCache.build({
          sessionId: "s1",
          messageId: "m1",
          model,
          blocks,
          policy: { enabled: false, force: false },
          contextPackId: ulid(),
        })
        const disabled2 = await ContextPackCache.build({
          sessionId: "s1",
          messageId: "m2",
          model,
          blocks,
          policy: { enabled: false, force: false },
          contextPackId: ulid(),
        })
        expect(disabled1.cache.status).toBe("disabled")
        expect(disabled2.cache.status).toBe("disabled")
        expect(ContextPackStats.segmentsBuilt).toBe(2)

        ContextPackStats.segmentsBuilt = 0
        const forced1 = await ContextPackCache.build({
          sessionId: "s1",
          messageId: "m1",
          model,
          blocks,
          policy: { enabled: true, force: true },
          contextPackId: ulid(),
        })
        const forced2 = await ContextPackCache.build({
          sessionId: "s1",
          messageId: "m2",
          model,
          blocks,
          policy: { enabled: true, force: true },
          contextPackId: ulid(),
        })
        expect(forced1.cache.status).toBe("forced_rebuild")
        expect(forced2.cache.status).toBe("forced_rebuild")
        expect(ContextPackStats.segmentsBuilt).toBe(2)
      },
    })
  })

  test("force rebuild can be driven by env policy", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const prev = process.env["OPENCODE_FORCE_REBUILD_CONTEXT_PACK"]
        process.env["OPENCODE_FORCE_REBUILD_CONTEXT_PACK"] = "1"
        using _ = defer(() => {
          if (prev === undefined) delete process.env["OPENCODE_FORCE_REBUILD_CONTEXT_PACK"]
          else process.env["OPENCODE_FORCE_REBUILD_CONTEXT_PACK"] = prev
        })

        const model = { providerID: "test", id: "test", limit: { context: 4096, output: 512 } }
        const cp = ulid()
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
          artifactRoot: `context/${cp}/blocks`,
        })

        ContextPackStats.segmentsBuilt = 0
        const one = await ContextPackCache.build({
          sessionId: "s1",
          messageId: "m1",
          model,
          blocks,
          policy: CachePolicy.policy("context-pack"),
          contextPackId: ulid(),
        })
        const two = await ContextPackCache.build({
          sessionId: "s1",
          messageId: "m2",
          model,
          blocks,
          policy: CachePolicy.policy("context-pack"),
          contextPackId: ulid(),
        })
        expect(one.cache.status).toBe("forced_rebuild")
        expect(two.cache.status).toBe("forced_rebuild")
        expect(ContextPackStats.segmentsBuilt).toBe(2)
      },
    })
  })
})
