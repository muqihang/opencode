import { AssistantMessage, Part as PartType, TextPart } from "@opencode-ai/sdk/v2/client"

export function selectResponsePart(input: {
  messages: AssistantMessage[]
  parts: Record<string, PartType[] | undefined>
}): TextPart | undefined {
  const messages = input.messages.filter((message) => message.mode !== "compaction")
  for (let mi = messages.length - 1; mi >= 0; mi--) {
    const msgParts = input.parts[messages[mi].id] ?? []
    for (let pi = msgParts.length - 1; pi >= 0; pi--) {
      const part = msgParts[pi]
      if (part?.type === "text") return part as TextPart
    }
  }
  return undefined
}
