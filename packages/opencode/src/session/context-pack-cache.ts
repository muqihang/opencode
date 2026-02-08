import { CacheStore } from "@/cache/store"
import { Instance } from "@/project/instance"
import { ContextPackBuilder, ContextPackStats } from "./context-pack"
import type { Provider } from "@/provider/provider"
import type { ContextBlocks } from "./context-blocks"
import type { ContextPack as ContextPackType } from "@/protocol/context-pack"

type Scope = {
  projectId: string
  worktreeRoot: string
}

type Policy = {
  enabled: boolean
  force: boolean
}

type EvidencePointers = {
  retrievalId: string
  retrievalCacheKey: string
  summary: { total: number; code: number; workbench: number }
  artifacts: Array<{ path: string; sha256: string; kind: string }>
  topK: Array<{ path: string; sha256: string }>
}

type Hydration = "pointer" | "full"

type Template = {
  id: string
  kind: ContextPackType["segments"][number]["kind"]
  priority: ContextPackType["segments"][number]["priority"]
  tokenEstimate: number
  preview?: string
}

const baseDir = () => (Instance.worktree === "/" ? Instance.directory : Instance.worktree)

const storeScope = (): Scope => ({ projectId: Instance.project.id, worktreeRoot: baseDir() })

const storeLimits = () => ({ memoryMaxEntries: 300, diskMaxEntries: 1000 })

const storeTtlMs = () => 2 * 60 * 60 * 1000

export const ContextPackCache = {
  async build(input: {
    sessionId: string
    messageId: string
    model: Pick<Provider.Model, "providerID" | "id" | "limit">
    blocks: ContextBlocks.Result
    maxOutputTokens?: number
    contextPackId?: string
    previousContextPackId?: string
    ledgerNotes?: string
    createdAtUtc?: string
    evidencePointers?: EvidencePointers
    hydration?: Hydration
    policy: Policy
  }) {
    const hydration = input.hydration ?? "pointer"
    const scope = storeScope()
    const key = CacheStore.key({
      namespace: "context-pack",
      scope,
      input: {
        specVersion: "context-pack-templates-cache-key/1.0",
        blocksCacheKey: input.blocks.cacheKey,
        model: {
          providerID: input.model.providerID,
          id: input.model.id,
          limit: input.model.limit,
        },
        hydration,
        maxOutputTokens: input.maxOutputTokens,
        versions: { builder: "v3", stableJson: "v1" },
      },
    })

    const store = CacheStore.open({
      namespace: "context-pack",
      scope,
      limits: storeLimits(),
    })

    const cached = await store.getOrCompute({
      key,
      ttlMs: storeTtlMs(),
      policy: input.policy,
      compute: async () => {
        const templates = ContextPackBuilder.buildBlockTemplates(input.blocks, hydration)
        return { specVersion: "context-pack-templates-cache/1.0", templates }
      },
    })

    const view = cached.value as { templates?: unknown }
    const base = Array.isArray(view.templates) ? (view.templates as unknown[]) : []
    const templates = base as Template[]
    const segments = [
      ...ContextPackBuilder.buildSegmentsFromTemplates({
        blocks: input.blocks,
        templates,
      }),
      ...(input.evidencePointers ? [ContextPackBuilder.buildEvidenceSegment(input.evidencePointers, hydration)] : []),
    ]

    return {
      pack: ContextPackBuilder.buildFromSegments({
        sessionId: input.sessionId,
        messageId: input.messageId,
        model: input.model,
        maxOutputTokens: input.maxOutputTokens,
        contextPackId: input.contextPackId,
        previousContextPackId: input.previousContextPackId,
        ledgerNotes: input.ledgerNotes,
        createdAtUtc: input.createdAtUtc,
        segments,
      }),
      cache: {
        namespace: "context-pack",
        key,
        scope,
        status: cached.status,
        tier: cached.tier,
      },
      stats: ContextPackStats,
    }
  },
}

export { ContextPackStats }
