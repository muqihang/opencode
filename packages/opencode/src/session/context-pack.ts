import { ContextPack, type ContextPack as ContextPackType } from "@/protocol/context-pack"
import type { Provider } from "@/provider/provider"
import { Token } from "@/util/token"
import { ulid } from "ulid"
import type { ContextBlocks } from "./context-blocks"

export const ContextPackStats = {
  segmentsBuilt: 0,
}

type EvidencePointers = {
  retrievalId: string
  retrievalCacheKey: string
  summary: { total: number; code: number; workbench: number }
  artifacts: Array<{ path: string; sha256: string; kind: string }>
  topK: Array<{ path: string; sha256: string }>
}

type BlockTemplate = {
  id: string
  kind: ContextPackType["segments"][number]["kind"]
  priority: ContextPackType["segments"][number]["priority"]
  tokenEstimate: number
  preview: string
}

const preview = (text: string) => text.trim().slice(0, 200)

const buildBlockTemplates = (blocks: ContextBlocks.Result): BlockTemplate[] => {
  ContextPackStats.segmentsBuilt += 1
  return blocks.blocks.map((block) => ({
    id: block.id,
    kind: block.kind,
    priority: block.priority,
    tokenEstimate: Token.estimate(block.text),
    preview: preview(block.text),
  }))
}

const buildSegmentsFromTemplates = (input: { blocks: ContextBlocks.Result; templates: BlockTemplate[] }) => {
  return input.templates.map((t, index) => {
    const source = input.blocks.blocks[index]?.source
    return {
      id: t.id,
      kind: t.kind,
      priority: t.priority,
      tokenEstimate: t.tokenEstimate,
      sources: source ? [source] : [],
      preview: t.preview,
    } satisfies ContextPackType["segments"][number]
  })
}

const buildBlockSegments = (blocks: ContextBlocks.Result): ContextPackType["segments"] => {
  const templates = buildBlockTemplates(blocks)
  return buildSegmentsFromTemplates({ blocks, templates })
}

const buildEvidenceSegment = (evidence: EvidencePointers) => {
  const artifactLines = evidence.artifacts.map((item) => `- ${item.path} (${item.sha256})`)
  const topLines = evidence.topK.map((item) => `- ${item.path} (${item.sha256})`)
  const lines = [
    "retrieval",
    `cacheKey: ${evidence.retrievalCacheKey}`,
    `summary: total=${evidence.summary.total} code=${evidence.summary.code} workbench=${evidence.summary.workbench}`,
    "artifacts:",
    ...artifactLines,
    "topK:",
    ...topLines,
  ]
  const text = lines.join("\n")
  return {
    id: "seg:evidence",
    kind: "evidence_pointers" as const,
    priority: "p1" as const,
    tokenEstimate: Token.estimate(text),
    sources: evidence.artifacts.map((item) => ({ kind: "artifact" as const, ref: item.path, sha256: item.sha256 })),
    preview: text,
  } satisfies ContextPackType["segments"][number]
}

export const ContextPackBuilder = {
  buildBlockTemplates,
  buildSegmentsFromTemplates,
  buildBlockSegments,
  buildEvidenceSegment,

  buildFromSegments(input: {
    sessionId: string
    messageId: string
    model: Pick<Provider.Model, "providerID" | "id" | "limit">
    segments: ContextPackType["segments"]
    maxOutputTokens?: number
    contextPackId?: string
    previousContextPackId?: string
    ledgerNotes?: string
    createdAtUtc?: string
  }): ContextPackType {
    const now = input.createdAtUtc ?? new Date().toISOString()
    const packId = input.contextPackId ?? ulid()
    const maxTokens = Math.max(1, input.model.limit.context || 1)
    const output = input.maxOutputTokens ?? input.model.limit.output
    const rawBudget = input.model.limit.input ?? maxTokens - output
    const budgetTokens = Math.max(1, Math.min(maxTokens, rawBudget))

    const total = input.segments.reduce((sum, segment) => sum + segment.tokenEstimate, 0)

    return ContextPack.parse({
      specVersion: "context-pack/1.0",
      contextPackId: packId,
      sessionId: input.sessionId,
      messageId: input.messageId,
      createdAtUtc: now,
      model: { providerId: input.model.providerID, modelId: input.model.id },
      window: { maxTokens, budgetTokens },
      tokenEstimate: { method: "approx", version: "v1" },
      versions: { systemTemplate: "v1", toolsTemplate: "v1", capsuleSchema: "v1", stableJson: "v1" },
      ledger: {
        previousContextPackId: input.previousContextPackId,
        mode: input.previousContextPackId ? ("delta" as const) : ("full" as const),
        notes: input.ledgerNotes,
      },
      segments: input.segments,
      totals: { segments: input.segments.length, tokenEstimate: total },
    })
  },

  build(input: {
    sessionId: string
    messageId: string
    model: Pick<Provider.Model, "providerID" | "id" | "limit">
    blocks: ContextBlocks.Result
    maxOutputTokens?: number
    contextPackId?: string
    previousContextPackId?: string
    ledgerNotes?: string
    createdAtUtc?: string
    evidencePointers?: {
      retrievalId: string
      retrievalCacheKey: string
      summary: { total: number; code: number; workbench: number }
      artifacts: Array<{ path: string; sha256: string; kind: string }>
      topK: Array<{ path: string; sha256: string }>
    }
  }): ContextPackType {
    const now = input.createdAtUtc ?? new Date().toISOString()
    const packId = input.contextPackId ?? ulid()
    const maxTokens = Math.max(1, input.model.limit.context || 1)
    const output = input.maxOutputTokens ?? input.model.limit.output
    const rawBudget = input.model.limit.input ?? maxTokens - output
    const budgetTokens = Math.max(1, Math.min(maxTokens, rawBudget))
    const segments = buildBlockSegments(input.blocks)
    if (input.evidencePointers) segments.push(buildEvidenceSegment(input.evidencePointers))
    const total = segments.reduce((sum, segment) => sum + segment.tokenEstimate, 0)
    return ContextPack.parse({
      specVersion: "context-pack/1.0",
      contextPackId: packId,
      sessionId: input.sessionId,
      messageId: input.messageId,
      createdAtUtc: now,
      model: { providerId: input.model.providerID, modelId: input.model.id },
      window: { maxTokens, budgetTokens },
      tokenEstimate: { method: "approx", version: "v1" },
      versions: { systemTemplate: "v1", toolsTemplate: "v1", capsuleSchema: "v1", stableJson: "v1" },
      ledger: {
        previousContextPackId: input.previousContextPackId,
        mode: input.previousContextPackId ? ("delta" as const) : ("full" as const),
        notes: input.ledgerNotes,
      },
      segments,
      totals: { segments: segments.length, tokenEstimate: total },
    })
  },
}
