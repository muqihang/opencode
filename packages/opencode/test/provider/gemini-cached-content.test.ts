import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { GeminiCachedContent } from "../../src/provider/gemini-cached-content"

const baseDir = () => (Instance.worktree === "/" ? Instance.directory : Instance.worktree)

const blocks = () => ({
  blocks: [
    {
      id: "block:developer_instructions",
      kind: "system",
      priority: "p0",
      specVersion: "block/developer_instructions/1.0",
      text: "DEV",
      artifact: "",
      source: { kind: "artifact" as const, ref: "x", sha256: "sha_dev" },
    },
    {
      id: "block:permissions_instructions",
      kind: "system",
      priority: "p0",
      specVersion: "block/permissions_instructions/1.0",
      text: "PERMS",
      artifact: "",
      source: { kind: "artifact" as const, ref: "x", sha256: "sha_perms" },
    },
    {
      id: "block:decision_boundary",
      kind: "system",
      priority: "p0",
      specVersion: "block/decision_boundary/1.0",
      text: "BOUNDARY",
      artifact: "",
      source: { kind: "artifact" as const, ref: "x", sha256: "sha_boundary" },
    },
    {
      id: "block:toolset",
      kind: "tools",
      priority: "p1",
      specVersion: "block/toolset/1.0",
      text: "{\"tools\":[]}",
      artifact: "",
      source: { kind: "artifact" as const, ref: "x", sha256: "sha_toolset" },
    },
  ],
  blockFingerprints: {
    "block:developer_instructions": "sha_dev",
    "block:permissions_instructions": "sha_perms",
    "block:decision_boundary": "sha_boundary",
    "block:toolset": "sha_toolset",
  },
  toolsetFingerprint: "toolset_fp",
  cacheKey: "blocks_cache_key",
})

describe("gemini cached content (lifecycle)", () => {
  test("create → reuse → expire → recreate", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const state = {
          created: 0,
          gets: 0,
          ids: new Set<string>(),
        }

        const srv = Bun.serve({
          port: 0,
          fetch(req) {
            const url = new URL(req.url)
            if (req.method === "POST" && url.pathname === "/v1beta/cachedContents") {
              state.created += 1
              const id = `cachedContents/${state.created}`
              state.ids.add(id)
              return Response.json({ name: id })
            }
            if (req.method === "GET" && url.pathname.startsWith("/v1beta/cachedContents/")) {
              state.gets += 1
              const id = `cachedContents/${url.pathname.split("/").pop() ?? ""}`
              if (state.ids.has(id)) return Response.json({ name: id })
              return new Response("not found", { status: 404 })
            }
            return new Response("not found", { status: 404 })
          },
        })

        const baseURL = `http://${srv.hostname}:${srv.port}/v1beta`
        const now = { value: 0 }
        const ttlMs = 10
        const scope = { projectId: Instance.project.id, worktreeRoot: baseDir() }
        const abort = new AbortController()

        const one = await GeminiCachedContent.resolve({
          sessionId: "session_x",
          messageId: "message_x",
          model: { providerID: "google", id: "gemini-3-flash", api: { npm: "@ai-sdk/google", id: "gemini-3-flash" } },
          provider: { baseURL, apiKey: "test" },
          blocks: blocks(),
          scope,
          ttlMs,
          policy: { enabled: true },
          clock: { nowMs: () => now.value },
          abort: abort.signal,
          timeoutMs: 5_000,
        })
        expect(one.cachedContentId).toBe("cachedContents/1")
        expect(one.decision).toBe("created")
        expect(state.created).toBe(1)

        const two = await GeminiCachedContent.resolve({
          sessionId: "session_x",
          messageId: "message_x",
          model: { providerID: "google", id: "gemini-3-flash", api: { npm: "@ai-sdk/google", id: "gemini-3-flash" } },
          provider: { baseURL, apiKey: "test" },
          blocks: blocks(),
          scope,
          ttlMs,
          policy: { enabled: true },
          clock: { nowMs: () => now.value },
          abort: abort.signal,
          timeoutMs: 5_000,
        })
        expect(two.cachedContentId).toBe("cachedContents/1")
        expect(two.decision).toBe("reused")
        expect(state.created).toBe(1)

        now.value = 11
        const three = await GeminiCachedContent.resolve({
          sessionId: "session_x",
          messageId: "message_x",
          model: { providerID: "google", id: "gemini-3-flash", api: { npm: "@ai-sdk/google", id: "gemini-3-flash" } },
          provider: { baseURL, apiKey: "test" },
          blocks: blocks(),
          scope,
          ttlMs,
          policy: { enabled: true },
          clock: { nowMs: () => now.value },
          abort: abort.signal,
          timeoutMs: 5_000,
        })
        expect(three.cachedContentId).toBe("cachedContents/2")
        expect(three.decision).toBe("created")
        expect(state.created).toBe(2)

        srv.stop(true)
      },
    })
  })

  test("invalid id → invalidate → recreate (max once)", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const state = {
          created: 0,
          ids: new Set<string>(),
        }

        const srv = Bun.serve({
          port: 0,
          fetch(req) {
            const url = new URL(req.url)
            if (req.method === "POST" && url.pathname === "/v1beta/cachedContents") {
              state.created += 1
              const id = `cachedContents/${state.created}`
              state.ids.add(id)
              return Response.json({ name: id })
            }
            if (req.method === "GET" && url.pathname.startsWith("/v1beta/cachedContents/")) {
              const id = `cachedContents/${url.pathname.split("/").pop() ?? ""}`
              if (state.ids.has(id)) return Response.json({ name: id })
              return new Response("not found", { status: 404 })
            }
            return new Response("not found", { status: 404 })
          },
        })

        const baseURL = `http://${srv.hostname}:${srv.port}/v1beta`
        const scope = { projectId: Instance.project.id, worktreeRoot: baseDir() }
        const abort = new AbortController()

        const one = await GeminiCachedContent.resolve({
          sessionId: "session_x",
          messageId: "message_x",
          model: { providerID: "google", id: "gemini-3-flash", api: { npm: "@ai-sdk/google", id: "gemini-3-flash" } },
          provider: { baseURL, apiKey: "test" },
          blocks: blocks(),
          scope,
          ttlMs: 60_000,
          policy: { enabled: true },
          clock: { nowMs: () => 0 },
          abort: abort.signal,
          timeoutMs: 5_000,
        })
        expect(one.cachedContentId).toBe("cachedContents/1")
        expect(state.created).toBe(1)

        state.ids.delete("cachedContents/1")

        const two = await GeminiCachedContent.resolve({
          sessionId: "session_x",
          messageId: "message_x",
          model: { providerID: "google", id: "gemini-3-flash", api: { npm: "@ai-sdk/google", id: "gemini-3-flash" } },
          provider: { baseURL, apiKey: "test" },
          blocks: blocks(),
          scope,
          ttlMs: 60_000,
          policy: { enabled: true },
          clock: { nowMs: () => 0 },
          abort: abort.signal,
          timeoutMs: 5_000,
        })
        expect(two.cachedContentId).toBe("cachedContents/2")
        expect(two.decision).toBe("invalidated")
        expect(state.created).toBe(2)

        srv.stop(true)
      },
    })
  })

  test("disabled does not create or reuse", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const state = { created: 0 }
        const srv = Bun.serve({
          port: 0,
          fetch(req) {
            const url = new URL(req.url)
            if (req.method === "POST" && url.pathname === "/v1beta/cachedContents") {
              state.created += 1
              return Response.json({ name: "cachedContents/1" })
            }
            return new Response("not found", { status: 404 })
          },
        })

        const baseURL = `http://${srv.hostname}:${srv.port}/v1beta`
        const scope = { projectId: Instance.project.id, worktreeRoot: baseDir() }

        const res = await GeminiCachedContent.resolve({
          sessionId: "session_x",
          messageId: "message_x",
          model: { providerID: "google", id: "gemini-3-flash", api: { npm: "@ai-sdk/google", id: "gemini-3-flash" } },
          provider: { baseURL, apiKey: "test" },
          blocks: blocks(),
          scope,
          ttlMs: 60_000,
          policy: { enabled: false },
          clock: { nowMs: () => 0 },
          abort: new AbortController().signal,
          timeoutMs: 5_000,
        })
        expect(res.cachedContentId).toBe(null)
        expect(res.decision).toBe("disabled")
        expect(state.created).toBe(0)

        srv.stop(true)
      },
    })
  })
})

