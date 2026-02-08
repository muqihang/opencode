import { describe, expect, test } from "bun:test"
import { ContextBlocks } from "../../src/session/context-blocks"
import { ContextPackBuilder } from "../../src/session/context-pack"

const model = {
  providerID: "openai",
  id: "gpt-test",
  limit: { context: 4096, input: 2048, output: 1024 },
}

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
    historySummary: "RAW_CONTEXT_MARKER:" + "z".repeat(20_000),
    workspaceFingerprint: "ws-1",
    artifactRoot: "context/pack-test/blocks",
  })

const buildEvidence = () => {
  const artifacts = Array.from({ length: 300 }, (_, i) => ({
    path: `retrieval/r1/artifacts/${String(i).padStart(3, "0")}.json`,
    sha256: String(i + 1).padStart(64, "a").slice(0, 64),
    kind: "retrieval-hits",
  }))
  const topK = artifacts.slice(0, 100).map((item) => ({ path: item.path, sha256: item.sha256 }))
  return {
    retrievalId: "r1",
    retrievalCacheKey: "cache-key-1",
    summary: { total: artifacts.length, code: 120, workbench: 180 },
    artifacts,
    topK,
  }
}

describe("context os anti bloat", () => {
  test("pointer-first pack drastically reduces prompt inflation while preserving evidence sources", () => {
    const blocks = buildBlocks()
    const evidence = buildEvidence()

    const pointer = ContextPackBuilder.build({
      sessionId: "session_test",
      messageId: "message_pointer",
      model,
      blocks,
      maxOutputTokens: 1024,
      evidencePointers: evidence,
    })

    const hydrated = ContextPackBuilder.build({
      sessionId: "session_test",
      messageId: "message_hydrated",
      model,
      blocks,
      maxOutputTokens: 1024,
      evidencePointers: evidence,
      hydration: "full",
    } as Parameters<typeof ContextPackBuilder.build>[0])

    const pointerTotal = pointer.totals.tokenEstimate
    const hydratedTotal = hydrated.totals.tokenEstimate
    const evidenceSegment = pointer.segments.find((segment) => segment.id === "seg:evidence")

    expect(pointerTotal).toBeLessThan(hydratedTotal * 0.5)
    expect(evidenceSegment).toBeTruthy()
    expect(evidenceSegment?.sources.length).toBe(evidence.artifacts.length)
    expect((evidenceSegment?.preview ?? "").includes(evidence.artifacts[0]?.path ?? "")).toBe(false)
  })
})
