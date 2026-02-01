import { TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { useSDK } from "@tui/context/sdk"
import { useTheme } from "@tui/context/theme"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import type { SessionEvidenceEvents } from "@opencode-ai/sdk/v2"
import { createMemo, createResource, onMount } from "solid-js"
import { Locale } from "@/util/locale"
import { useDialog } from "../../ui/dialog"

type EventV1 = SessionEvidenceEvents["events"][number]

function stage(e: EventV1) {
  if (e.type.startsWith("tool.")) return "Tool"
  if (e.type.startsWith("doc.")) return "Workbench"
  if (e.type.startsWith("routing.")) return "Routing"
  if (e.type === "file.cache_hit") return "Cache"
  return "Other"
}

function time(ts: string) {
  const t = Date.parse(ts)
  if (!Number.isFinite(t)) return ts
  return Locale.todayTimeOrDateTime(t)
}

function pointers(e: EventV1) {
  const data = e.data
  if (!data) return []
  const keys = ["artifact", "manifestPath", "manifest", "path", "ref", "sha256"]
  const result: string[] = []
  for (const key of keys) {
    const value = data[key]
    if (typeof value !== "string") continue
    if (value.includes(".opencode/")) result.push(value)
  }
  return result
}

function detail(e: EventV1) {
  const ptrs = pointers(e)
  const data = e.data ? Object.keys(e.data) : []
  const lines = [
    `Type: ${e.type}`,
    `Actor: ${e.actor}`,
    `Time: ${e.ts}`,
    `Severity: ${e.severity}`,
    `Summary: ${e.summary}`,
    `Redaction: applied=${e.redaction.applied} policy=${e.redaction.policyVersion}`,
    "",
    "Pointers:",
    ...(ptrs.length ? ptrs.map((p) => `- ${p}`) : ["- (none)"]),
    "",
    "Data keys:",
    ...(data.length ? data.map((k) => `- ${k}`) : ["- (none)"]),
  ]
  return lines.join("\n")
}

function DialogActivityDetail(props: { event: EventV1 }) {
  const dialog = useDialog()
  const { theme } = useTheme()

  useKeyboard((evt) => {
    if (evt.name === "return") {
      dialog.clear()
      evt.preventDefault()
      evt.stopPropagation()
    }
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Activity
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>
      <box paddingBottom={1}>
        <text fg={theme.textMuted}>{detail(props.event)}</text>
      </box>
      <box flexDirection="row" justifyContent="flex-end" paddingBottom={1}>
        <box
          paddingLeft={3}
          paddingRight={3}
          backgroundColor={theme.primary}
          onMouseUp={() => dialog.clear()}
        >
          <text fg={theme.selectedListItemText}>ok</text>
        </box>
      </box>
    </box>
  )
}

export function DialogActivity(props: { sessionID: string }) {
  const sdk = useSDK()
  const dialog = useDialog()

  onMount(() => {
    dialog.setSize("large")
  })

  const [batch] = createResource(
    () => props.sessionID,
    async (sessionID) => {
      const result = await sdk.client.session.evidenceEvents({ sessionID, cursor: 0, limit: 200 })
      return result.data ?? { events: [], nextCursor: 0 }
    },
  )

  const options = createMemo((): DialogSelectOption<string>[] => {
    const data = batch()
    if (!data) {
      return [
        {
          title: "Loading…",
          value: "loading",
          category: "Activity",
          disabled: true,
        },
      ]
    }

    return data.events.map((e, index) => ({
      title: e.summary,
      value: String(index),
      category: stage(e),
      description: e.type,
      footer: time(e.ts),
      onSelect: (dialog) => {
        dialog.replace(() => <DialogActivityDetail event={e} />)
      },
    }))
  })

  return <DialogSelect title="Activity" options={options()} />
}

