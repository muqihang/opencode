import { Token } from "@/util/token"
import { MessageV2 } from "./message-v2"

const trim = (text: string) => text.trim().replace(/\s+\n/g, "\n").trim()

const render = (input: { role: string; id: string; text: string }) => {
  const body = trim(input.text)
  if (!body) return ""
  return [`<msg role="${input.role}" id="${input.id}">`, body, "</msg>", ""].join("\n")
}

const textFromMessage = (msg: MessageV2.WithParts) => {
  const parts = msg.parts
    .filter((p): p is MessageV2.TextPart => p.type === "text")
    .filter((p) => !p.synthetic)
    .filter((p) => !p.ignored)
    .map((p) => p.text)
    .map((t) => trim(t))
    .filter(Boolean)
  return parts.join("\n\n")
}

export const SessionHistorySummary = {
  MAX_BYTES: 120_000,

  build(messages: MessageV2.WithParts[]) {
    const summary = messages.findLast((m) => m.info.role === "assistant" && m.info.summary === true)
    const summaryText = summary ? textFromMessage(summary) : ""
    if (summaryText) {
      return { kind: "summary" as const, text: summaryText, tokenEstimate: Token.estimate(summaryText) }
    }

    const used = { value: 0 }
    const chunks: string[] = []

    for (const msg of messages.toReversed()) {
      if (msg.info.role !== "user" && msg.info.role !== "assistant") continue
      if (msg.info.role === "assistant" && msg.info.summary === true) continue
      const text = textFromMessage(msg)
      if (!text) continue
      const chunk = render({ role: msg.info.role, id: msg.info.id, text })
      if (!chunk) continue
      const bytes = Buffer.byteLength(chunk, "utf-8")
      if (used.value + bytes > SessionHistorySummary.MAX_BYTES) break
      used.value += bytes
      chunks.push(chunk)
    }

    chunks.reverse()
    const window = chunks.join("\n")
    if (!window.trim()) return { kind: "none" as const, text: undefined, tokenEstimate: 0 }
    return { kind: "window" as const, text: window, tokenEstimate: Token.estimate(window) }
  },
}

