import { stableJson } from "@/util/stable-json"
import { sha256Text } from "@/routing/cache"
import type { ContextPackSegmentKind, ContextPackSegmentPriority } from "@/protocol/context-pack"

export type ContextBlock = {
  id: string
  kind: ContextPackSegmentKind
  priority: ContextPackSegmentPriority
  specVersion: string
  text: string
  artifact: string
  source: {
    kind: "artifact"
    ref: string
    sha256: string
  }
}

export namespace ContextBlocks {
  export type Toolset = {
    version: string
    tools: Array<{
      name: string
      description: string
      schema: unknown
    }>
  }

  export type Input = {
    permissions: string
    developer: string
    user: string
    toolset: Toolset
    environment: string
    capsule: string
    decisionBoundary: string
    historySummary?: string
    workspaceFingerprint: string
    artifactRoot: string
  }

  export type Result = {
    blocks: ContextBlock[]
    blockFingerprints: Record<string, string>
    toolsetFingerprint: string
    cacheKey: string
  }

  export const build = (input: Input): Result => {
    const blocks: ContextBlock[] = []
    const blockFingerprints: Record<string, string> = {}
    const root = input.artifactRoot.replace(/\\/g, "/").replace(/\/$/, "")

    const add = (item: {
      id: string
      kind: ContextPackSegmentKind
      priority: ContextPackSegmentPriority
      specVersion: string
      text: string
    }) => {
      if (!item.text.trim()) return
      const artifact = {
        specVersion: item.specVersion,
        id: item.id,
        kind: item.kind,
        priority: item.priority,
        text: item.text,
      }
      const artifactText = stableJson(artifact)
      const sha256 = sha256Text(artifactText)
      const filename = item.id.replace(/[^a-zA-Z0-9._-]/g, "_")
      const ref = `${root}/${filename}.json`
      const source = {
        kind: "artifact" as const,
        ref,
        sha256,
      }
      blocks.push({
        ...item,
        artifact: artifactText,
        source,
      })
      blockFingerprints[item.id] = sha256
    }

    const tools = [...input.toolset.tools].sort((a, b) => a.name.localeCompare(b.name))
    const toolset = {
      specVersion: `toolset/${input.toolset.version}`,
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        schema: tool.schema,
      })),
    }
    const toolsetText = stableJson(toolset)
    const toolsetFingerprint = sha256Text(toolsetText)

    add({
      id: "block:developer_instructions",
      kind: "system",
      priority: "p0",
      specVersion: "block/developer_instructions/1.0",
      text: input.developer,
    })
    add({
      id: "block:permissions_instructions",
      kind: "system",
      priority: "p0",
      specVersion: "block/permissions_instructions/1.0",
      text: input.permissions,
    })
    add({
      id: "block:decision_boundary",
      kind: "system",
      priority: "p0",
      specVersion: "block/decision_boundary/1.0",
      text: input.decisionBoundary,
    })
    add({
      id: "block:environment_context",
      kind: "system",
      priority: "p1",
      specVersion: "block/environment_context/1.0",
      text: input.environment,
    })
    add({
      id: "block:capsule",
      kind: "capsule",
      priority: "p1",
      specVersion: "block/capsule/1.0",
      text: input.capsule,
    })
    add({
      id: "block:user_instructions",
      kind: "system",
      priority: "p1",
      specVersion: "block/user_instructions/1.0",
      text: input.user,
    })
    add({
      id: "block:toolset",
      kind: "tools",
      priority: "p1",
      specVersion: "block/toolset/1.0",
      text: toolsetText,
    })
    if (input.historySummary) {
      add({
        id: "block:history_summary",
        kind: "history_summary",
        priority: "p1",
        specVersion: "block/history_summary/1.0",
        text: input.historySummary,
      })
    }

    const cachePayload = {
      specVersion: "context-cache-key/1.0",
      workspaceFingerprint: input.workspaceFingerprint,
      toolsetFingerprint,
      blockOrder: blocks.map((block) => block.id),
      blockFingerprints,
    }
    const cacheKey = sha256Text(stableJson(cachePayload))

    return {
      blocks,
      blockFingerprints,
      toolsetFingerprint,
      cacheKey,
    }
  }
}
