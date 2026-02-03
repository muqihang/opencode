import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { ulid } from "ulid"
import { ContextBlocksCache, ContextBlocksCacheStats } from "../../src/session/context-blocks-cache"

const baseDir = () => (Instance.worktree === "/" ? Instance.directory : Instance.worktree)

describe("context-blocks cache store", () => {
  test("cache hit skips rebuild and keeps refs call-scoped", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const cp1 = ulid()
        const cp2 = ulid()
        ContextBlocksCacheStats.builds = 0

        const one = await ContextBlocksCache.build({
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
          policy: { enabled: true, force: false },
        })

        expect(one.cache.status).toBe("miss")
        expect(ContextBlocksCacheStats.builds).toBe(1)
        expect(one.blocks.blocks.every((b) => b.source.ref.startsWith(`context/${cp1}/blocks/`))).toBe(true)

        const two = await ContextBlocksCache.build({
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
          policy: { enabled: true, force: false },
        })

        expect(two.cache.status).toBe("hit")
        expect(two.blocks.cacheKey).toBe(one.blocks.cacheKey)
        expect(ContextBlocksCacheStats.builds).toBe(1)
        expect(two.blocks.blocks.every((b) => b.source.ref.startsWith(`context/${cp2}/blocks/`))).toBe(true)
      },
    })
  })

  test("disable + force rebuild semantics are honored", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const cp = ulid()

        ContextBlocksCacheStats.builds = 0
        await ContextBlocksCache.build({
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
          policy: { enabled: false, force: false },
        })
        await ContextBlocksCache.build({
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
          policy: { enabled: false, force: false },
        })
        expect(ContextBlocksCacheStats.builds).toBe(2)

        ContextBlocksCacheStats.builds = 0
        const forced = await ContextBlocksCache.build({
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
          policy: { enabled: true, force: true },
        })
        expect(forced.cache.status).toBe("forced_rebuild")
        expect(ContextBlocksCacheStats.builds).toBe(1)
      },
    })
  })
})

