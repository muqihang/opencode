import { describe, expect, test } from "bun:test"

import { EvidencePack } from "../../src/protocol/evidence-pack"
import { EvidenceManifest } from "../../src/protocol/evidence-manifest"

describe("protocol.evidence.contracts", () => {
  test("evidence-pack/1.0 fixture parses and is strict", () => {
    const fixture = {
      specVersion: "evidence-pack/1.0",
      packId: "EP-2026-01-28-session-01ARZ3NDEKTSV4RRFFQ69G5FAV",
      task: {
        title: "User request",
        intent: "P0 sandbox",
        successCriteria: ["evidence written"],
      },
      environment: {
        execution: {
          kind: "sandbox",
          id: "sandbox:soft",
        },
      },
      claims: [],
      artifacts: [],
      checks: [],
      events: [],
      capsule: {
        handoff: "ok",
        pointers: [],
        openQuestions: [],
      },
      risks: [],
      rollback: {
        strategy: "none",
        steps: [],
      },
    } as const

    expect(EvidencePack.parse(fixture)).toMatchObject(fixture)
    expect(() => EvidencePack.parse({ ...fixture, extra: "nope" })).toThrow()
  })

  test("evidence-manifest/1.0 fixture parses and is strict", () => {
    const fixture = {
      specVersion: "evidence-manifest/1.0",
      packId: "EP-2026-01-28-session-01ARZ3NDEKTSV4RRFFQ69G5FAV",
      generatedAtUtc: "2026-01-28T00:00:00.000Z",
      entries: [
        {
          path: ".opencode/evidence/x/pack.json",
          sha256: "a".repeat(64),
          kind: "evidence-pack",
        },
      ],
    } as const

    expect(EvidenceManifest.parse(fixture)).toMatchObject(fixture)
    expect(() => EvidenceManifest.parse({ ...fixture, extra: "nope" })).toThrow()
  })
})
