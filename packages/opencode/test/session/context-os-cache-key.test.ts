import { describe, expect, test } from "bun:test"
import { ulid } from "ulid"
import { ContextBlocks } from "../../src/session/context-blocks"
import { ContextPackCache, ContextPackStats } from "../../src/session/context-pack-cache"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("context os cache key", () => {
  test("cache key separates pointer-first and full hydration modes", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const model = { providerID: "test", id: "test", limit: { context: 4096, output: 512 } }
        const blocks = ContextBlocks.build({
          permissions: "PERMS",
          developer: "DEV",
          user: "USER",
          toolset: { version: "v1", tools: [] },
          environment: "ENV",
          capsule: "CAP",
          decisionBoundary: "DECISION",
          historySummary: "RAW_CONTEXT_MARKER:" + "h".repeat(6_000),
          workspaceFingerprint: "ws-1",
          artifactRoot: `context/${ulid()}/blocks`,
        })

        ContextPackStats.segmentsBuilt = 0

        const pointerOne = await ContextPackCache.build({
          sessionId: "s1",
          messageId: "m1",
          model,
          blocks,
          policy: { enabled: true, force: false },
          contextPackId: ulid(),
        })
        const pointerTwo = await ContextPackCache.build({
          sessionId: "s1",
          messageId: "m2",
          model,
          blocks,
          policy: { enabled: true, force: false },
          contextPackId: ulid(),
        })
        const full = await ContextPackCache.build({
          sessionId: "s1",
          messageId: "m3",
          model,
          blocks,
          policy: { enabled: true, force: false },
          contextPackId: ulid(),
          hydration: "full",
        } as Parameters<typeof ContextPackCache.build>[0])

        expect(pointerOne.cache.status).toBe("miss")
        expect(pointerTwo.cache.status).toBe("hit")
        expect(full.cache.status).toBe("miss")

        expect(pointerOne.cache.key).toBe(pointerTwo.cache.key)
        expect(full.cache.key).not.toBe(pointerOne.cache.key)
        expect(ContextPackStats.segmentsBuilt).toBe(2)
      },
    })
  })
})
