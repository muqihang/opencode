import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { CacheStore } from "../../src/cache/store"

const baseDir = () => (Instance.worktree === "/" ? Instance.directory : Instance.worktree)

describe("cache store (ssot)", () => {
  test("stable key is deterministic across object key order", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const scope = {
          projectId: Instance.project.id,
          worktreeRoot: baseDir(),
        }
        const one = CacheStore.key({
          namespace: "test",
          scope,
          input: { a: 1, b: 2 },
        })
        const two = CacheStore.key({
          namespace: "test",
          scope,
          input: { b: 2, a: 1 },
        })
        expect(one).toBe(two)
      },
    })
  })

  test("hit skips compute and still reads from disk across new store instances", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const scope = { projectId: Instance.project.id, worktreeRoot: baseDir() }
        const key = CacheStore.key({ namespace: "test", scope, input: { id: "alpha" } })

        const events: Array<{ type: string; decision: string }> = []
        const emit = (e: { type: string; decision: string }) => events.push(e)

        const count = { value: 0 }
        const storeA = CacheStore.open({
          namespace: "test",
          scope,
          limits: { memoryMaxEntries: 300, diskMaxEntries: 1000 },
          clock: { nowMs: () => 0 },
          emit,
        })

        const a = await storeA.getOrCompute({
          key,
          ttlMs: 60_000,
          policy: { enabled: true, force: false },
          compute: async () => {
            count.value += 1
            return { ok: true }
          },
        })
        expect(a.value).toEqual({ ok: true })
        expect(count.value).toBe(1)

        const b = await storeA.getOrCompute({
          key,
          ttlMs: 60_000,
          policy: { enabled: true, force: false },
          compute: async () => {
            count.value += 1
            return { ok: true, again: true }
          },
        })
        expect(b.value).toEqual({ ok: true })
        expect(b.status).toBe("hit")
        expect(count.value).toBe(1)

        const storeB = CacheStore.open({
          namespace: "test",
          scope,
          limits: { memoryMaxEntries: 0, diskMaxEntries: 1000 },
          clock: { nowMs: () => 0 },
          emit,
        })

        const c = await storeB.getOrCompute({
          key,
          ttlMs: 60_000,
          policy: { enabled: true, force: false },
          compute: async () => {
            count.value += 1
            return { ok: true, disk: false }
          },
        })
        expect(c.value).toEqual({ ok: true })
        expect(c.tier).toBe("disk")
        expect(count.value).toBe(1)

        const file = path.join(baseDir(), ".opencode", "cache", "store", "test", "entries", `${key}.json`)
        expect(await Bun.file(file).exists()).toBe(true)
        expect(events.some((e) => e.type === "cache.hit")).toBe(true)
      },
    })
  })

  test("ttl expiry triggers recompute and marks expired decision", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const scope = { projectId: Instance.project.id, worktreeRoot: baseDir() }
        const key = CacheStore.key({ namespace: "test", scope, input: { id: "ttl" } })

        const now = { value: 0 }
        const decisions: string[] = []
        const emit = (e: { type: string; decision: string }) => decisions.push(`${e.type}:${e.decision}`)

        const store = CacheStore.open({
          namespace: "test",
          scope,
          limits: { memoryMaxEntries: 300, diskMaxEntries: 1000 },
          clock: { nowMs: () => now.value },
          emit,
        })

        const count = { value: 0 }
        const one = await store.getOrCompute({
          key,
          ttlMs: 10,
          policy: { enabled: true, force: false },
          compute: async () => {
            count.value += 1
            return { n: count.value }
          },
        })
        expect(one.value).toEqual({ n: 1 })
        expect(one.status).toBe("miss")

        now.value = 11
        const two = await store.getOrCompute({
          key,
          ttlMs: 10,
          policy: { enabled: true, force: false },
          compute: async () => {
            count.value += 1
            return { n: count.value }
          },
        })
        expect(two.value).toEqual({ n: 2 })
        expect(two.status).toBe("expired")
        expect(decisions.some((x) => x === "cache.read:expired")).toBe(true)
      },
    })
  })

  test("disable bypasses read/write and always recomputes", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const scope = { projectId: Instance.project.id, worktreeRoot: baseDir() }
        const key = CacheStore.key({ namespace: "test", scope, input: { id: "disabled" } })

        const decisions: string[] = []
        const emit = (e: { type: string; decision: string }) => decisions.push(`${e.type}:${e.decision}`)

        const store = CacheStore.open({
          namespace: "test",
          scope,
          limits: { memoryMaxEntries: 300, diskMaxEntries: 1000 },
          clock: { nowMs: () => 0 },
          emit,
        })

        const count = { value: 0 }
        const one = await store.getOrCompute({
          key,
          ttlMs: 60_000,
          policy: { enabled: false, force: false },
          compute: async () => {
            count.value += 1
            return { n: count.value }
          },
        })
        const two = await store.getOrCompute({
          key,
          ttlMs: 60_000,
          policy: { enabled: false, force: false },
          compute: async () => {
            count.value += 1
            return { n: count.value }
          },
        })
        expect(one.value).toEqual({ n: 1 })
        expect(two.value).toEqual({ n: 2 })
        expect(decisions.some((x) => x === "cache.read:disabled")).toBe(true)

        const file = path.join(baseDir(), ".opencode", "cache", "store", "test", "entries", `${key}.json`)
        expect(await Bun.file(file).exists()).toBe(false)
      },
    })
  })

  test("force rebuild recomputes even when present", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const scope = { projectId: Instance.project.id, worktreeRoot: baseDir() }
        const key = CacheStore.key({ namespace: "test", scope, input: { id: "force" } })

        const decisions: string[] = []
        const emit = (e: { type: string; decision: string }) => decisions.push(`${e.type}:${e.decision}`)

        const store = CacheStore.open({
          namespace: "test",
          scope,
          limits: { memoryMaxEntries: 300, diskMaxEntries: 1000 },
          clock: { nowMs: () => 0 },
          emit,
        })

        const count = { value: 0 }
        const one = await store.getOrCompute({
          key,
          ttlMs: 60_000,
          policy: { enabled: true, force: false },
          compute: async () => {
            count.value += 1
            return { n: count.value }
          },
        })
        const two = await store.getOrCompute({
          key,
          ttlMs: 60_000,
          policy: { enabled: true, force: true },
          compute: async () => {
            count.value += 1
            return { n: count.value }
          },
        })
        expect(one.value).toEqual({ n: 1 })
        expect(two.value).toEqual({ n: 2 })
        expect(decisions.some((x) => x === "cache.read:forced_rebuild")).toBe(true)
      },
    })
  })
})
