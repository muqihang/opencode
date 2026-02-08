import { describe, expect, test } from "bun:test"
import { ContextBlocks } from "../../src/session/context-blocks"
import { ContextPackBuilder } from "../../src/session/context-pack"

const model = {
  providerID: "openai",
  id: "gpt-test",
  limit: { context: 4096, input: 2048, output: 1024 },
}

const marker = "RAW_CONTEXT_MARKER"

const buildBlocks = () =>
  ContextBlocks.build({
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
    historySummary: `${marker}:${"x".repeat(8_000)}`,
    workspaceFingerprint: "ws-1",
    artifactRoot: "context/pack-test/blocks",
  })

const historyPreview = (segments: ReturnType<typeof ContextPackBuilder.build>["segments"]) =>
  segments.find((segment) => segment.id === "block:history_summary")?.preview ?? ""

describe("context os hydration", () => {
  test("defaults to pointer-first segments and keeps full hydration opt-in", () => {
    const blocks = buildBlocks()

    const pointer = ContextPackBuilder.build({
      sessionId: "session_test",
      messageId: "message_pointer",
      model,
      blocks,
      maxOutputTokens: 1024,
    })

    const hydrated = ContextPackBuilder.build({
      sessionId: "session_test",
      messageId: "message_hydrated",
      model,
      blocks,
      maxOutputTokens: 1024,
      hydration: "full",
    } as Parameters<typeof ContextPackBuilder.build>[0])

    const pointerPreview = historyPreview(pointer.segments)
    const hydratedPreview = historyPreview(hydrated.segments)

    expect(pointerPreview.includes(marker)).toBe(false)
    expect(hydratedPreview.includes(marker)).toBe(true)
    expect(pointerPreview).not.toBe(hydratedPreview)
  })
})
