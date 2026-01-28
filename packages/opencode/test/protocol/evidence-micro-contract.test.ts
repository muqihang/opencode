import { describe, expect, test } from "bun:test"
import { EvidenceMicroPack } from "../../src/protocol/evidence-micro-pack"

describe("protocol.evidence.micro", () => {
  test("micro-pack/1.0 fixture parses and is strict", () => {
    const fixture = {
      specVersion: "evidence-micro-pack/1.0",
      packId: "MP-2026-01-28-session-01ARZ3NDEKTSV4RRFFQ69G5FAV",
      sessionId: "session_test",
      parentSessionId: "session_parent",
      generatedAtUtc: "2026-01-28T00:00:00.000Z",
      artifacts: [],
      claims: [],
      checks: [],
      events: [],
    } as const
    expect(EvidenceMicroPack.parse(fixture)).toMatchObject(fixture)
    expect(() => EvidenceMicroPack.parse({ ...fixture, extra: "nope" })).toThrow()
  })
})
