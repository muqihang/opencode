import { CacheStore } from "@/cache/store"
import { CachePolicy } from "@/cache/policy"
import { Instance } from "@/project/instance"
import { ContextBlocks, type ContextBlock } from "./context-blocks"

type Scope = {
  projectId: string
  worktreeRoot: string
}

type Policy = {
  enabled: boolean
  force: boolean
}

type Template = {
  id: string
  kind: ContextBlock["kind"]
  priority: ContextBlock["priority"]
  specVersion: string
  text: string
  artifact: string
  sha256: string
  filename: string
}

export const ContextBlocksCacheStats = {
  builds: 0,
}

const baseDir = () => (Instance.worktree === "/" ? Instance.directory : Instance.worktree)

const storeScope = (): Scope => ({ projectId: Instance.project.id, worktreeRoot: baseDir() })

const filenameFromId = (id: string) => id.replace(/[^a-zA-Z0-9._-]/g, "_")

const normalizeRoot = (value: string) => value.replace(/\\/g, "/").replace(/\/$/, "")

export const ContextBlocksCache = {
  async build(input: ContextBlocks.Input & { policy: Policy }) {
    const scope = storeScope()
    const key = CacheStore.key({
      namespace: "context-blocks",
      scope,
      input: {
        specVersion: "context-blocks-cache-key/1.0",
        workspaceFingerprint: input.workspaceFingerprint,
        permissions: input.permissions,
        developer: input.developer,
        user: input.user,
        toolset: input.toolset,
        environment: input.environment,
        capsule: input.capsule,
        decisionBoundary: input.decisionBoundary,
        historySummary: input.historySummary ?? "",
        versions: { builder: "v1", stableJson: "v1" },
      },
    })

    const store = CacheStore.open({
      namespace: "context-blocks",
      scope,
      limits: CachePolicy.limits(),
    })

    const cached = await store.getOrCompute({
      key,
      ttlMs: CachePolicy.ttlMs("context-blocks"),
      policy: input.policy,
      compute: async () => {
        ContextBlocksCacheStats.builds += 1
        const built = ContextBlocks.build({
          ...input,
          artifactRoot: "context/__cache__/blocks",
        })
        const templates: Template[] = built.blocks.map((block) => ({
          id: block.id,
          kind: block.kind,
          priority: block.priority,
          specVersion: block.specVersion,
          text: block.text,
          artifact: block.artifact,
          sha256: block.source.sha256,
          filename: filenameFromId(block.id),
        }))
        return {
          specVersion: "context-blocks-cache/1.0",
          cacheKey: built.cacheKey,
          toolsetFingerprint: built.toolsetFingerprint,
          blockFingerprints: built.blockFingerprints,
          templates,
        }
      },
    })

    const view = cached.value as Record<string, unknown>
    const templatesRaw = Array.isArray(view.templates) ? (view.templates as unknown[]) : []
    const templates = templatesRaw as Template[]
    const cacheKeyValue = typeof view.cacheKey === "string" ? view.cacheKey : ""
    const toolsetFingerprintValue = typeof view.toolsetFingerprint === "string" ? view.toolsetFingerprint : ""
    const blockFingerprintsValue =
      view.blockFingerprints && typeof view.blockFingerprints === "object"
        ? (view.blockFingerprints as Record<string, string>)
        : {}

    const root = normalizeRoot(input.artifactRoot)
    const blocks: ContextBlock[] = templates.map((t) => ({
      id: t.id,
      kind: t.kind,
      priority: t.priority,
      specVersion: t.specVersion,
      text: t.text,
      artifact: t.artifact,
      source: { kind: "artifact", ref: `${root}/${t.filename}.json`, sha256: t.sha256 },
    }))

    return {
      blocks: {
        blocks,
        blockFingerprints: blockFingerprintsValue,
        toolsetFingerprint: toolsetFingerprintValue,
        cacheKey: cacheKeyValue,
      },
      cache: {
        namespace: "context-blocks",
        key,
        scope,
        status: cached.status,
        tier: cached.tier,
      },
      stats: ContextBlocksCacheStats,
    }
  },
}

