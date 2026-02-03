import { describe, expect, test } from "bun:test"
import { ContextPack } from "../../src/protocol/context-pack"
import { ContextPackBuilder } from "../../src/session/context-pack"
import { ContextBlocks } from "../../src/session/context-blocks"

const model = {
  providerID: "openai",
  id: "gpt-test",
  limit: { context: 4096, input: 2048, output: 1024 },
}

const blocks = ContextBlocks.build({
  permissions: "PERMS",
  developer: "DEV",
  user: "USER",
  toolset: {
    version: "v1",
    tools: [],
  },
  environment: "ENV",
  capsule: "CAP",
  decisionBoundary: "DECISION",
  historySummary: "HIST",
  workspaceFingerprint: "ws-1",
  artifactRoot: "context/pack-test/blocks",
})

describe("session.context-pack", () => {
  test("build returns schema-valid pack with consistent totals", () => {
    const pack = ContextPackBuilder.build({
      sessionId: "session_test",
      messageId: "message_test",
      model,
      blocks,
      maxOutputTokens: 1024,
    })

    const parsed = ContextPack.parse(pack)
    const total = parsed.segments.reduce((sum, segment) => sum + segment.tokenEstimate, 0)

    expect(parsed.totals.segments).toBe(parsed.segments.length)
    expect(parsed.totals.tokenEstimate).toBe(total)
  })

  test("ledger records previousContextPackId and switches mode to delta", () => {
    const first = ContextPack.parse(
      ContextPackBuilder.build({
        sessionId: "session_test",
        messageId: "message_test",
        model,
        blocks,
        maxOutputTokens: 1024,
      }),
    )
    expect(first.ledger.previousContextPackId).toBeUndefined()
    expect(first.ledger.mode).toBe("full")

    const second = ContextPack.parse(
      ContextPackBuilder.build({
        sessionId: "session_test",
        messageId: "message_test_2",
        model,
        blocks,
        maxOutputTokens: 1024,
        previousContextPackId: first.contextPackId,
      }),
    )
    expect(second.ledger.previousContextPackId).toBe(first.contextPackId)
    expect(second.ledger.mode).toBe("delta")
  })

  test("schema rejects totals mismatch", () => {
    const pack = ContextPackBuilder.build({
      sessionId: "session_test",
      messageId: "message_test",
      model,
      blocks,
      maxOutputTokens: 1024,
    })

    expect(() =>
      ContextPack.parse({
        ...pack,
        totals: { ...pack.totals, segments: pack.totals.segments + 1 },
      }),
    ).toThrow()
  })
})
