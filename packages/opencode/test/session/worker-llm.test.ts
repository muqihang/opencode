import { describe, expect, test } from "bun:test"
import z from "zod"
import { runStructured } from "../../src/session/orchestrator/worker-llm"

const schema = z
  .object({
    status: z.enum(["ok", "degraded"]),
    notes: z.array(z.string()).optional(),
  })
  .strict()

describe("session.orchestrator.worker-llm", () => {
  test("slow resolveSmallModel produces degraded timeout result", async () => {
    const out = await runStructured({
      providerID: "openai",
      modelID: "gpt-5",
      schema,
      messages: [{ role: "user", content: "hi" }],
      timeoutMs: 20,
      degraded: (reason) => ({ status: "degraded", notes: [reason] }),
      deps: {
        resolveSmallModel: () => new Promise((resolve) => setTimeout(() => resolve({} as never), 80)),
        getLanguage: async () => ({}) as never,
        generate: async () => ({ object: { status: "ok" } }),
      },
    })

    expect(out.status).toBe("degraded")
    expect(out.reason).toBe("timeout")
    expect(out.object.status).toBe("degraded")
  })

  test("slow getLanguage produces degraded timeout result", async () => {
    const out = await runStructured({
      providerID: "openai",
      modelID: "gpt-5",
      schema,
      messages: [{ role: "user", content: "hi" }],
      timeoutMs: 20,
      degraded: (reason) => ({ status: "degraded", notes: [reason] }),
      deps: {
        resolveSmallModel: async () => ({}) as never,
        getLanguage: () => new Promise((resolve) => setTimeout(() => resolve({} as never), 80)),
        generate: async () => ({ object: { status: "ok" } }),
      },
    })

    expect(out.status).toBe("degraded")
    expect(out.reason).toBe("timeout")
    expect(out.object.status).toBe("degraded")
  })

  test("timeout produces degraded result", async () => {
    const out = await runStructured({
      providerID: "openai",
      modelID: "gpt-5",
      schema,
      messages: [{ role: "user", content: "hi" }],
      timeoutMs: 20,
      degraded: (reason) => ({ status: "degraded", notes: [reason] }),
      deps: {
        resolveSmallModel: async () => ({}) as never,
        getLanguage: async () => ({}) as never,
        generate: () => new Promise((resolve) => setTimeout(() => resolve({ object: { status: "ok" } }), 80)),
      },
    })

    expect(out.status).toBe("degraded")
    expect(out.reason).toBe("timeout")
    expect(out.object.status).toBe("degraded")
  })

  test("abort-like error produces degraded timeout result", async () => {
    const err = Object.assign(new Error("request aborted"), { name: "AbortError", code: "ABORT_ERR" })
    const out = await runStructured({
      providerID: "openai",
      modelID: "gpt-5",
      schema,
      messages: [{ role: "user", content: "hi" }],
      timeoutMs: 100,
      degraded: (reason) => ({ status: "degraded", notes: [reason] }),
      deps: {
        resolveSmallModel: async () => ({}) as never,
        getLanguage: async () => ({}) as never,
        generate: async () => {
          throw err
        },
      },
    })

    expect(out.status).toBe("degraded")
    expect(out.reason).toBe("timeout")
    expect(out.object.status).toBe("degraded")
  })

  test("schema mismatch produces degraded result", async () => {
    const out = await runStructured({
      providerID: "openai",
      modelID: "gpt-5",
      schema,
      messages: [{ role: "user", content: "hi" }],
      timeoutMs: 100,
      degraded: (reason) => ({ status: "degraded", notes: [reason] }),
      deps: {
        resolveSmallModel: async () => ({}) as never,
        getLanguage: async () => ({}) as never,
        generate: async () => ({
          object: {
            status: "ok",
            notes: [123],
          },
        }),
      },
    })

    expect(out.status).toBe("degraded")
    expect(out.reason).toBe("schema")
    expect(out.object.status).toBe("degraded")
  })

  test("type validation error from generateObject maps to schema", async () => {
    const err = Object.assign(new Error("schema failed"), { name: "TypeValidationError" })
    const out = await runStructured({
      providerID: "openai",
      modelID: "gpt-5",
      schema,
      messages: [{ role: "user", content: "hi" }],
      timeoutMs: 100,
      degraded: (reason) => ({ status: "degraded", notes: [reason] }),
      deps: {
        resolveSmallModel: async () => ({}) as never,
        getLanguage: async () => ({}) as never,
        generate: async () => {
          throw err
        },
      },
    })

    expect(out.status).toBe("degraded")
    expect(out.reason).toBe("schema")
    expect(out.object.status).toBe("degraded")
  })

  test("no object generated with type validation cause maps to schema", async () => {
    const cause = Object.assign(new Error("bad output"), { name: "TypeValidationError" })
    const err = Object.assign(new Error("no object"), { name: "NoObjectGeneratedError", cause })
    const out = await runStructured({
      providerID: "openai",
      modelID: "gpt-5",
      schema,
      messages: [{ role: "user", content: "hi" }],
      timeoutMs: 100,
      degraded: (reason) => ({ status: "degraded", notes: [reason] }),
      deps: {
        resolveSmallModel: async () => ({}) as never,
        getLanguage: async () => ({}) as never,
        generate: async () => {
          throw err
        },
      },
    })

    expect(out.status).toBe("degraded")
    expect(out.reason).toBe("schema")
    expect(out.object.status).toBe("degraded")
  })

  test("success returns parsed object", async () => {
    const out = await runStructured({
      providerID: "openai",
      modelID: "gpt-5",
      schema,
      messages: [{ role: "user", content: "hi" }],
      timeoutMs: 100,
      degraded: (reason) => ({ status: "degraded", notes: [reason] }),
      deps: {
        resolveSmallModel: async () => ({}) as never,
        getLanguage: async () => ({}) as never,
        generate: async () => ({
          object: {
            status: "ok",
            notes: ["done"],
          },
        }),
      },
    })

    expect(out.status).toBe("ok")
    expect(out.object).toEqual({
      status: "ok",
      notes: ["done"],
    })
  })
})
