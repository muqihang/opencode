import { OrchestratorUxMode } from "@/protocol/orchestrator-plan"
import { stableJson } from "@/util/stable-json"
import { sha256Text } from "@/routing/cache"
import type { ModelMessage, Tool } from "ai"
import { Flag } from "@/flag/flag"
import { extractA1Features, extractFeatures } from "./features"
import { buildPlan } from "./plan"
import { writeOrchestratorArtifacts } from "./writer"

type PrepareInput = {
  sessionId: string
  messageId: string
  uxMode: OrchestratorUxMode
  messages: ModelMessage[]
  tools: Record<string, Tool>
  parentSessionId?: string
}

type PrepareResult = {
  plan: Awaited<ReturnType<typeof buildPlan>>["plan"]
  features: ReturnType<typeof extractFeatures>
  toolsetFingerprint: string
  intentText: string
}

const extractText = (message: ModelMessage) => {
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

const extractIntentText = (messages: ModelMessage[]) => {
  const reversed = [...messages].reverse()
  for (const msg of reversed) {
    if (msg.role !== "user") continue
    const text = extractText(msg).trim()
    if (text) return text
  }
  return ""
}

const hasFileParts = (messages: ModelMessage[]) =>
  messages.some((message) => {
    if (message.role !== "user") return false
    if (!Array.isArray(message.content)) return false
    return message.content.some((part) => {
      if (!part || typeof part !== "object" || !("type" in part)) return false
      return (part as { type?: string }).type === "file"
    })
  })

const toolsetFingerprint = (tools: Record<string, Tool>) => {
  const toolset = Object.entries(tools).map(([name, item]) => {
    const schema = (() => {
      if (item.inputSchema && typeof item.inputSchema === "object" && "jsonSchema" in item.inputSchema) {
        const parsed = item.inputSchema as { jsonSchema?: unknown }
        return parsed.jsonSchema ?? {}
      }
      return {}
    })()
    const description = typeof item.description === "string" ? item.description : ""
    return { name, description, schema }
  })
  const ordered = [...toolset].sort((a, b) => a.name.localeCompare(b.name))
  const fingerprintPayload = {
    specVersion: "toolset/v1",
    tools: ordered,
  }
  return sha256Text(stableJson(fingerprintPayload))
}

export const prepareOrchestratorPlan = async (input: PrepareInput): Promise<PrepareResult> => {
  const intentText = extractIntentText(input.messages)
  const hasFiles = hasFileParts(input.messages)
  const features = extractFeatures({
    uxMode: input.uxMode,
    intentText,
    hasFileParts: hasFiles,
    parentSessionId: input.parentSessionId,
  })
  const a1 = extractA1Features({ intentText, hasFileParts: hasFiles })
  const fingerprint = toolsetFingerprint(input.tools)
  const result = await buildPlan({
    sessionId: input.sessionId,
    messageId: input.messageId,
    features,
    toolsetFingerprint: fingerprint,
    a1,
    dualPassSynthesis: Flag.OPENCODE_EXPERIMENTAL_DUAL_PASS_SYNTHESIS === true,
  })
  await writeOrchestratorArtifacts({
    sessionId: input.sessionId,
    plan: result.plan,
    features,
  })
  return { plan: result.plan, features, toolsetFingerprint: fingerprint, intentText }
}
