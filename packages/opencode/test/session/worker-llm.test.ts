import { describe, expect, test } from "bun:test"
import z from "zod"
import { runStructured } from "../../src/session/orchestrator/worker-llm"
import { Provider } from "../../src/provider/provider"

type Model = Awaited<ReturnType<typeof Provider.getModel>>

const fakeModel = (providerID: string, id: string): Model => ({
  providerID,
  id,
}) as Model

const cast = <T,>(value: T): never => value as never

const readReason = (value: Awaited<ReturnType<typeof runStructured>>) => (value.status === "degraded" ? value.reason : undefined)

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
      degraded: (reason) => ({ status: "degraded" as const, notes: [reason] }),
      deps: cast({
        resolveSmallModel: () => new Promise((resolve) => setTimeout(() => resolve(fakeModel("openai", "gpt-5")), 80)),
        getLanguage: async () => ({}) as never,
        generate: async () => ({ object: { status: "ok" as const } }),
      }),
    })

    expect(out.status).toBe("degraded")
    expect(readReason(out)).toBe("timeout")
    expect(out.object.status).toBe("degraded")
  })

  test("slow getLanguage produces degraded timeout result", async () => {
    const out = await runStructured({
      providerID: "openai",
      modelID: "gpt-5",
      schema,
      messages: [{ role: "user", content: "hi" }],
      timeoutMs: 20,
      degraded: (reason) => ({ status: "degraded" as const, notes: [reason] }),
      deps: cast({
        resolveSmallModel: async () => fakeModel("openai", "gpt-5"),
        getLanguage: () => new Promise((resolve) => setTimeout(() => resolve({}) as never, 80)),
        generate: async () => ({ object: { status: "ok" as const } }),
      }),
    })

    expect(out.status).toBe("degraded")
    expect(readReason(out)).toBe("timeout")
    expect(out.object.status).toBe("degraded")
  })

  test("timeout produces degraded result", async () => {
    const out = await runStructured({
      providerID: "openai",
      modelID: "gpt-5",
      schema,
      messages: [{ role: "user", content: "hi" }],
      timeoutMs: 20,
      degraded: (reason) => ({ status: "degraded" as const, notes: [reason] }),
      deps: cast({
        resolveSmallModel: async () => fakeModel("openai", "gpt-5"),
        getLanguage: async () => ({}) as never,
        generate: () =>
          new Promise((resolve) => setTimeout(() => resolve({ object: { status: "ok" as const } }), 80)) as never,
      }),
    })

    expect(out.status).toBe("degraded")
    expect(readReason(out)).toBe("timeout")
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
      degraded: (reason) => ({ status: "degraded" as const, notes: [reason] }),
      deps: cast({
        resolveSmallModel: async () => fakeModel("openai", "gpt-5"),
        getLanguage: async () => ({}) as never,
        generate: async () => {
          throw err
        },
      }),
    })

    expect(out.status).toBe("degraded")
    expect(readReason(out)).toBe("timeout")
    expect(out.object.status).toBe("degraded")
  })

  test("schema mismatch produces degraded result", async () => {
    const out = await runStructured({
      providerID: "openai",
      modelID: "gpt-5",
      schema,
      messages: [{ role: "user", content: "hi" }],
      timeoutMs: 100,
      degraded: (reason) => ({ status: "degraded" as const, notes: [reason] }),
      deps: cast({
        resolveSmallModel: async () => fakeModel("openai", "gpt-5"),
        getLanguage: async () => ({}) as never,
        generate: async () => ({
          object: {
            status: "ok" as const,
            notes: [123],
          },
        }),
      }),
    })

    expect(out.status).toBe("degraded")
    expect(readReason(out)).toBe("schema")
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
      degraded: (reason) => ({ status: "degraded" as const, notes: [reason] }),
      deps: cast({
        resolveSmallModel: async () => fakeModel("openai", "gpt-5"),
        getLanguage: async () => ({}) as never,
        generate: async () => {
          throw err
        },
      }),
    })

    expect(out.status).toBe("degraded")
    expect(readReason(out)).toBe("schema")
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
      degraded: (reason) => ({ status: "degraded" as const, notes: [reason] }),
      deps: cast({
        resolveSmallModel: async () => fakeModel("openai", "gpt-5"),
        getLanguage: async () => ({}) as never,
        generate: async () => {
          throw err
        },
      }),
    })

    expect(out.status).toBe("degraded")
    expect(readReason(out)).toBe("schema")
    expect(out.object.status).toBe("degraded")
  })

  test("success returns parsed object", async () => {
    const out = await runStructured({
      providerID: "openai",
      modelID: "gpt-5",
      schema,
      messages: [{ role: "user", content: "hi" }],
      timeoutMs: 100,
      degraded: (reason) => ({ status: "degraded" as const, notes: [reason] }),
      deps: cast({
        resolveSmallModel: async () => fakeModel("openai", "gpt-5"),
        getLanguage: async () => ({}) as never,
        generate: async () => ({
          object: {
            status: "ok" as const,
            notes: ["done"],
          },
        }),
      }),
    })

    expect(out.status).toBe("ok")
    expect(out.object).toEqual({
      status: "ok",
      notes: ["done"],
    })
  })

  test("fallback chain upgrades to primary model when routed model fails", async () => {
    const calls: string[] = []
    const out = await runStructured({
      providerID: "openai",
      modelID: "gpt-5",
      role: "evidence_critic",
      schema,
      messages: [{ role: "user", content: "hi" }],
      timeoutMs: 100,
      degraded: (reason) => ({ status: "degraded" as const, notes: [reason] }),
      deps: cast({
        resolveSmallModel: async () => fakeModel("openai", "gpt-5-nano"),
        getModel: async () => fakeModel("openai", "gpt-5"),
        getSmallModel: async () => undefined,
        getLanguage: async (model: unknown) => ({ id: (model as unknown as { id: string }).id }) as never,
        generate: async (input: unknown) => {
          const model = input as { model?: { id?: string } }
          const id = String(model.model?.id)
          calls.push(id)
          if (id === "gpt-5-nano") {
            throw Object.assign(new Error("request timed out"), { name: "TimeoutError" })
          }
          return {
            object: {
              status: "ok",
              notes: ["recovered"],
            },
          }
        },
        timeout: async (promise: Promise<unknown>) => promise,
      }),
    })

    expect(out.status).toBe("ok")
    expect(out.object.status).toBe("ok")
    expect(calls).toEqual(["gpt-5-nano", "gpt-5"])
  })

  test("degraded callback receives route metadata and emits gate tags", async () => {
    const seen: Array<{ fromModel: string; toModel: string; gateReason: string }> = []
    const out = await runStructured({
      providerID: "openai",
      modelID: "gpt-5",
      role: "evidence_critic",
      schema,
      messages: [{ role: "user", content: "hi" }],
      timeoutMs: 100,
      degraded: (reason, route) => {
        seen.push(route)
        return {
          status: "degraded" as const,
          notes: [`worker degraded: ${reason}`],
        }
      },
      deps: cast({
        resolveSmallModel: async () => fakeModel("openai", "gpt-5-nano"),
        getModel: async () => fakeModel("openai", "gpt-5"),
        getSmallModel: async () => fakeModel("opencode", "gpt-5-nano"),
        getLanguage: async () => ({}) as never,
        generate: async () => {
          throw new Error("upstream down")
        },
        timeout: async (promise: Promise<unknown>) => promise,
      }),
    })

    expect(out.status).toBe("degraded")
    expect(readReason(out)).toBe("error")
    expect(seen.length).toBe(1)
    expect(seen[0]).toEqual({
      fromModel: "openai/gpt-5",
      toModel: "opencode/gpt-5-nano",
      gateReason: "error_degraded",
    })
    expect(out.object.notes?.some((note) => note.includes("from_model="))).toBe(true)
    expect(out.object.notes?.some((note) => note.includes("gate_reason="))).toBe(true)
  })
})
