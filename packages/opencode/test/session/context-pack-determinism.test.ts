import { describe, expect, test } from "bun:test"
import { ContextPack } from "../../src/protocol/context-pack"
import { ContextPackBuilder } from "../../src/session/context-pack"
import { ContextBlocks } from "../../src/session/context-blocks"

const model = {
  providerID: "openai",
  id: "gpt-test",
  limit: { context: 4096, input: 2048, output: 1024 },
}

const idPermissions = "block:permissions_instructions"
const idDeveloper = "block:developer_instructions"
const idDecision = "block:decision_boundary"
const idUser = "block:user_instructions"
const idEnvironment = "block:environment_context"
const idCapsule = "block:capsule"
const idToolset = "block:toolset"
const idHistory = "block:history_summary"

const build = (input: Partial<ContextBlocks.Input> = {}) =>
  ContextBlocks.build({
    permissions: "PERMS",
    developer: "DEV",
    user: "USER",
    toolset: {
      version: "v1",
      tools: [{ name: "alpha", description: "a", schema: { type: "object", properties: {} } }],
    },
    environment: "ENV",
    capsule: "CAP",
    decisionBoundary: "DECISION",
    historySummary: "HIST",
    workspaceFingerprint: "ws-1",
    artifactRoot: "context/pack-test/blocks",
    ...input,
  })

describe("context-pack determinism", () => {
  test("same inputs yield identical blocks and fingerprints", () => {
    const one = build()
    const two = build()

    expect(one.blocks).toEqual(two.blocks)
    expect(one.blockFingerprints).toEqual(two.blockFingerprints)
    expect(one.toolsetFingerprint).toBe(two.toolsetFingerprint)
    expect(one.cacheKey).toBe(two.cacheKey)
  })

  test("toolset change updates fingerprint", () => {
    const base = build()
    const changed = build({
      toolset: {
        version: "v1",
        tools: [
          { name: "alpha", description: "a", schema: { type: "object", properties: {} } },
          { name: "beta", description: "b", schema: { type: "object", properties: {} } },
        ],
      },
    })

    expect(base.toolsetFingerprint).not.toBe(changed.toolsetFingerprint)
    expect(base.cacheKey).not.toBe(changed.cacheKey)
  })

  test("decision boundary change updates fingerprint", () => {
    const base = build()
    const changed = build({ decisionBoundary: "DECISION-CHANGED" })

    expect(base.blockFingerprints[idDecision]).not.toBe(changed.blockFingerprints[idDecision])
    expect(base.cacheKey).not.toBe(changed.cacheKey)
  })

  test("workspace fingerprint change updates cacheKey", () => {
    const base = build()
    const changed = build({ workspaceFingerprint: "ws-2" })

    expect(base.cacheKey).not.toBe(changed.cacheKey)
  })

  test("session/message changes do not affect segments", () => {
    const blocks = build()
    const packA = ContextPack.parse(
      ContextPackBuilder.build({
        sessionId: "session_a",
        messageId: "message_a",
        model,
        blocks,
      }),
    )
    const packB = ContextPack.parse(
      ContextPackBuilder.build({
        sessionId: "session_b",
        messageId: "message_b",
        model,
        blocks,
      }),
    )

    expect(packA.segments).toEqual(packB.segments)
    expect(packA.totals).toEqual(packB.totals)
  })

  test("segments include artifact sources with sha256", () => {
    const blocks = build()
    const pack = ContextPack.parse(
      ContextPackBuilder.build({
        sessionId: "session_a",
        messageId: "message_a",
        model,
        blocks,
      }),
    )

    for (const segment of pack.segments) {
      expect(segment.sources.length).toBeGreaterThan(0)
      expect(segment.sources.some((source) => Boolean(source.sha256))).toBe(true)
    }
  })

  test("missing history summary omits the block and preserves other fingerprints", () => {
    const base = build()
    const missing = build({ historySummary: undefined })

    const baseIds = base.blocks.map((block) => block.id)
    const missingIds = missing.blocks.map((block) => block.id)

    expect(baseIds.includes(idHistory)).toBe(true)
    expect(missingIds.includes(idHistory)).toBe(false)

    const other = [
      idDeveloper,
      idPermissions,
      idDecision,
      idEnvironment,
      idCapsule,
      idUser,
      idToolset,
    ]

    for (const id of other) {
      expect(base.blockFingerprints[id]).toBe(missing.blockFingerprints[id])
    }
  })

  test("blocks order is stable with no duplicates", () => {
    const built = build()
    const ids = built.blocks.map((block) => block.id)
    const expected = [
      idDeveloper,
      idPermissions,
      idDecision,
      idEnvironment,
      idCapsule,
      idUser,
      idToolset,
      idHistory,
    ]

    expect(ids).toEqual(expected)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
