import { describe, expect, test } from "bun:test"

describe("protocol.event.contracts", () => {
  test("event/1.0 fixture parses and is strict", async () => {
    // TDD-friendly: missing module should fail as an assertion (not crash the runner).
    let mod: unknown = null
    try {
      mod = await import("../../src/protocol/event")
    } catch {
      mod = null
    }

    expect(mod).not.toBeNull()

    const { EventV1 } = mod as { EventV1: { parse: (input: unknown) => unknown } }

    const fixture = {
      specVersion: "event/1.0",
      ts: "2026-01-25T00:00:00.000Z",
      sessionId: "session_01ARZ3NDEKTSV4RRFFQ69G5FAV",
      traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      spanId: "bbbbbbbbbbbbbbbb",
      severity: "info",
      actor: "tool:bash",
      type: "routing.started",
      summary: "routing started",
      data: {
        routingRunId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        tier: "limited",
      },
      redaction: { applied: true, policyVersion: "v1" },
    } as const

    expect(EventV1.parse(fixture)).toMatchObject(fixture)
    expect(() => EventV1.parse({ ...fixture, extra: "nope" })).toThrow()
  })
})

