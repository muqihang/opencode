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

  test("normalize hook recovers deepseek-style schema drift", async () => {
    const drift = z
      .object({
        status: z.enum(["ok", "degraded"]),
        notes: z.array(z.string()).optional(),
        toolRequests: z
          .array(
            z
              .object({
                kind: z.enum(["retrieval"]),
                input: z.string().min(1),
              })
              .strict(),
          )
          .optional(),
      })
      .strict()

    const out = await runStructured({
      providerID: "deepseek",
      modelID: "deepseek-reasoner",
      schema: drift,
      messages: [{ role: "user", content: "hi" }],
      timeoutMs: 100,
      degraded: (reason) => ({
        status: "degraded" as const,
        notes: [reason],
        toolRequests: [{ kind: "retrieval" as const, input: "fallback" }],
      }),
      normalize: (value) => {
        const data = value as {
          status?: unknown
          notes?: unknown
          tool_requests?: unknown
        }
        const key = String(data.status ?? "").trim().toLowerCase()
        const status: "ok" | "degraded" = ["insufficient", "needs_more", "timeout", "degraded"].includes(key)
          ? "degraded"
          : "ok"
        const notes = typeof data.notes === "string" ? [data.notes.trim()] : []
        const raw = Array.isArray(data.tool_requests) ? data.tool_requests : []
        const toolRequests = raw
          .map((item) => {
            const req = item as { type?: unknown; query?: unknown }
            const kind = String(req.type ?? "").trim().toLowerCase()
            const input = String(req.query ?? "").trim()
            if (kind !== "retrieval") return undefined
            if (input.length === 0) return undefined
            return { kind: "retrieval" as const, input }
          })
          .filter((item): item is { kind: "retrieval"; input: string } => item !== undefined)

        return {
          status,
          notes: notes.length > 0 ? notes : undefined,
          toolRequests: toolRequests.length > 0 ? toolRequests : undefined,
        }
      },
      deps: cast({
        resolveSmallModel: async () => fakeModel("deepseek", "deepseek-reasoner"),
        getLanguage: async () => ({}) as never,
        generate: async () => ({
          object: {
            status: "insufficient",
            notes: "need stronger evidence",
            tool_requests: [{ type: "retrieval", query: "find source pointer" }],
            traceId: "ds-1",
          },
        }),
      }),
    })

    expect(out.status).toBe("ok")
    expect(out.object).toEqual({
      status: "degraded",
      notes: ["need stronger evidence"],
      toolRequests: [{ kind: "retrieval", input: "find source pointer" }],
    })
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

  test("deepseek worker fallback stays on session provider", async () => {
    const seen: Array<{ fromModel: string; toModel: string; gateReason: string }> = []
    const requested: Array<{ providerID: string; role?: string; activeModelID?: string }> = []
    const calls: string[] = []
    const out = await runStructured({
      providerID: "deepseek",
      modelID: "deepseek-reasoner",
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
        resolveSmallModel: async () => fakeModel("deepseek", "deepseek-reasoner"),
        getModel: async () => fakeModel("deepseek", "deepseek-reasoner"),
        getSmallModel: async (providerID: string, role?: string, activeModelID?: string) => {
          requested.push({ providerID, role, activeModelID })
          if (providerID === "deepseek") return fakeModel("deepseek", "deepseek-chat")
          if (providerID === "opencode") return fakeModel("opencode", "gpt-5-nano")
          return undefined
        },
        getLanguage: async (model: unknown) => model as never,
        generate: async (input: unknown) => {
          const model = input as { model?: { providerID?: string; id?: string } }
          calls.push(`${String(model.model?.providerID)}/${String(model.model?.id)}`)
          throw new Error("upstream down")
        },
        timeout: async (promise: Promise<unknown>) => promise,
      }),
    })

    expect(out.status).toBe("degraded")
    expect(readReason(out)).toBe("error")
    expect(requested).toEqual([
      {
        providerID: "deepseek",
        role: "evidence_critic",
        activeModelID: "deepseek-reasoner",
      },
    ])
    expect(calls).toEqual(["deepseek/deepseek-reasoner", "deepseek/deepseek-chat"])
    expect(seen.length).toBe(1)
    expect(seen[0]?.toModel).toBe("deepseek/deepseek-chat")
  })
})
