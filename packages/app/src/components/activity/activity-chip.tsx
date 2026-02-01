import type { ActivityItem } from "@/lib/chronology/types"
import { Icon } from "@opencode-ai/ui/icon"
import { createMemo, Show } from "solid-js"

function headline(items: ActivityItem[]) {
  const running = items.find((i) => i.status === "running")
  if (running) return `Running: ${running.title}`
  if (items.length === 0) return "No activity"
  return `Done (${items.length})`
}

export function ActivityChip(props: { items: ActivityItem[]; onClick?: () => void }) {
  const text = createMemo(() => headline(props.items))
  const running = createMemo(() => props.items.some((i) => i.status === "running"))

  return (
    <button
      type="button"
      class="h-8 px-3 rounded-full border border-border-weak-base bg-surface-raised-base hover:bg-surface-raised-base-hover active:bg-surface-raised-base-active transition-colors flex items-center gap-2"
      classList={{ "animate-pulse": running() }}
      onClick={() => props.onClick?.()}
    >
      <Icon name="bullet-list" size="small" class="text-icon-weak-base" />
      <div class="text-12-regular text-text-weak truncate max-w-64">{text()}</div>
      <Show when={running()}>
        <div class="size-1.5 rounded-full bg-surface-info-strong" />
      </Show>
    </button>
  )
}
