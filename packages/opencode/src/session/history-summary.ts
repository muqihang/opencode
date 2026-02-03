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

  build(
    input:
      | MessageV2.WithParts[]
      | { messages: MessageV2.WithParts[]; preferredText?: string | undefined; handoffText?: string | undefined },
  ) {
    const messages = Array.isArray(input) ? input : input.messages
    const preferredText = Array.isArray(input) ? "" : input.preferredText ?? ""
    const handoffText = Array.isArray(input) ? "" : input.handoffText ?? ""

    const preferred = trim(preferredText)
    const handoff = trim(handoffText)

    const summary = (() => {
      for (const msg of [...messages].reverse()) {
        if (msg.info.role !== "assistant") continue
        if (msg.info.summary !== true) continue
        return msg
      }
      return undefined
    })()
    const summaryText = summary ? textFromMessage(summary) : ""

    const used = { value: 0 }
    const chunks: string[] = []

    for (const msg of [...messages].reverse()) {
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
    const base = preferred || summaryText || trim(window)
    const kind = preferred
      ? ("preferred" as const)
      : summaryText
        ? ("summary" as const)
        : window.trim()
          ? ("window" as const)
          : handoff
            ? ("handoff" as const)
            : ("none" as const)

    const combined = base
      ? handoff
        ? [base.trimEnd(), "", handoff].join("\n")
        : base
      : handoff

    if (!combined) return { kind: "none" as const, text: undefined, tokenEstimate: 0 }

    const capped = (() => {
      const bytes = Buffer.byteLength(combined, "utf-8")
      if (bytes <= SessionHistorySummary.MAX_BYTES) return combined
      return Buffer.from(combined, "utf-8").subarray(0, SessionHistorySummary.MAX_BYTES).toString("utf-8")
    })()

    return { kind, text: capped, tokenEstimate: Token.estimate(capped) }
  },
}
