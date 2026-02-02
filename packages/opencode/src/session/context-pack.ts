import { ContextPack, type ContextPack as ContextPackType } from "@/protocol/context-pack"
import type { Provider } from "@/provider/provider"
import type { ModelMessage, Tool } from "ai"
import { Token } from "@/util/token"
import { ulid } from "ulid"

export const ContextPackBuilder = {
  build(input: {
    sessionId: string
    messageId: string
    model: Pick<Provider.Model, "providerID" | "id" | "limit">
    system: string[]
    messages: ModelMessage[]
    tools: Record<string, Tool>
    maxOutputTokens?: number
    evidencePointers?: {
      retrievalId: string
      retrievalCacheKey: string
      summary: { total: number; code: number; workbench: number }
      artifacts: Array<{ path: string; sha256: string; kind: string }>
      topK: Array<{ path: string; sha256: string }>
    }
  }): ContextPackType {
    const now = new Date().toISOString()
    const packId = ulid()
    const maxTokens = Math.max(1, input.model.limit.context || 1)
    const output = input.maxOutputTokens ?? input.model.limit.output
    const rawBudget = input.model.limit.input ?? maxTokens - output
    const budgetTokens = Math.max(1, Math.min(maxTokens, rawBudget))

    const preview = (text: string) => text.trim().slice(0, 200)

    const toolNames = Object.keys(input.tools).sort().join("\n")

    const messageText = (message: ModelMessage) => {
      if (typeof message.content === "string") return message.content
      if (Array.isArray(message.content)) {
        const parts = message.content
          .map((part) => {
            if (typeof part === "string") return part
            if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
              return part.text
            }
            return JSON.stringify(part) ?? ""
          })
          .filter((value): value is string => typeof value === "string" && value.length > 0)

        return parts.join("\n")
      }
      return ""
    }

    const systemText = input.system.join("\n\n").trim()
    const historyText = input.messages.map(messageText).filter((value) => value).join("\n")

    const segments: ContextPackType["segments"] = []

    if (systemText) {
      segments.push({
        id: "seg:system",
        kind: "system",
        priority: "p0",
        tokenEstimate: Token.estimate(systemText),
        sources: [],
        preview: preview(systemText),
      })
    }

    if (toolNames) {
      segments.push({
        id: "seg:tools",
        kind: "tools",
        priority: "p1",
        tokenEstimate: Token.estimate(toolNames),
        sources: [],
        preview: preview(toolNames),
      })
    }

    if (historyText) {
      segments.push({
        id: "seg:history",
        kind: "history_summary",
        priority: "p1",
        tokenEstimate: Token.estimate(historyText),
        sources: [],
        preview: preview(historyText),
      })
    }

    if (input.evidencePointers) {
      const evidence = input.evidencePointers
      const artifactLines = evidence.artifacts.map((item) => `- ${item.path} (${item.sha256})`)
      const topLines = evidence.topK.map((item) => `- ${item.path} (${item.sha256})`)
      const lines = [
        "retrieval",
        `id: ${evidence.retrievalId}`,
        `cacheKey: ${evidence.retrievalCacheKey}`,
        `summary: total=${evidence.summary.total} code=${evidence.summary.code} workbench=${evidence.summary.workbench}`,
        "artifacts:",
        ...artifactLines,
        "topK:",
        ...topLines,
      ]
      const text = lines.join("\n")
      segments.push({
        id: "seg:evidence",
        kind: "evidence_pointers",
        priority: "p1",
        tokenEstimate: Token.estimate(text),
        sources: evidence.artifacts.map((item) => ({ kind: "artifact", ref: item.path, sha256: item.sha256 })),
        preview: text,
      })
    }

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
