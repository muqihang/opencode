import { ContextPack, type ContextPack as ContextPackType } from "@/protocol/context-pack"
import type { Provider } from "@/provider/provider"
import { Token } from "@/util/token"
import { ulid } from "ulid"
import type { ContextBlocks } from "./context-blocks"

export const ContextPackBuilder = {
  build(input: {
    sessionId: string
    messageId: string
    model: Pick<Provider.Model, "providerID" | "id" | "limit">
    blocks: ContextBlocks.Result
    maxOutputTokens?: number
    contextPackId?: string
    createdAtUtc?: string
  }): ContextPackType {
    const now = input.createdAtUtc ?? new Date().toISOString()
    const packId = input.contextPackId ?? ulid()
    const maxTokens = Math.max(1, input.model.limit.context || 1)
    const output = input.maxOutputTokens ?? input.model.limit.output
    const rawBudget = input.model.limit.input ?? maxTokens - output
    const budgetTokens = Math.max(1, Math.min(maxTokens, rawBudget))

    const preview = (text: string) => text.trim().slice(0, 200)

    const segments: ContextPackType["segments"] = input.blocks.blocks.map((block) => ({
      id: block.id,
      kind: block.kind,
      priority: block.priority,
      tokenEstimate: Token.estimate(block.text),
      sources: [block.source],
      preview: preview(block.text),
    }))

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
      ledger: { mode: "full" },
      segments,
      totals: { segments: segments.length, tokenEstimate: total },
    })
  },
}
