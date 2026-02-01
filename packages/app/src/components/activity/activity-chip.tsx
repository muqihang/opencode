import type { ActivityItem } from "@/lib/chronology/types"
import { Icon } from "@opencode-ai/ui/icon"
import { createMemo, createSignal, onCleanup, Show } from "solid-js"
import { getPulseMode } from "./pulse"

function headline(items: ActivityItem[]) {
  const running = items.find((i) => i.status === "running")
  if (running) return `Running: ${running.title}`
  if (items.length === 0) return "No activity"
  return `Done (${items.length})`
}

export function ActivityChip(props: { items: ActivityItem[]; onClick?: () => void }) {
  const text = createMemo(() => headline(props.items))
  const running = createMemo(() => props.items.some((i) => i.status === "running"))

  const [now, setNow] = createSignal(Date.now())
  const timer = setInterval(() => setNow(Date.now()), 1000)
  onCleanup(() => clearInterval(timer))

  const mode = createMemo(() => getPulseMode(props.items, now()))

  const pulseClass = createMemo(() => {
    switch (mode()) {
      case "breathing":
        return "motion-reduce:animate-none animate-[activity-breathe_3s_ease-in-out_infinite]"
      case "flicker":
        return "motion-reduce:animate-none animate-[activity-flicker_0.5s_linear_infinite]"
      case "arrhythmia":
        return "motion-reduce:animate-none animate-[activity-arrhythmia_2s_ease-in-out_infinite]"
      default:
        return ""
    }
  })

  return (
    <button
      type="button"
      class="h-8 px-3 rounded-full border border-border-weak-base bg-surface-raised-base hover:bg-surface-raised-base-hover active:bg-surface-raised-base-active transition-colors flex items-center gap-2"
      onClick={() => props.onClick?.()}
    >
      <Icon name="bullet-list" size="small" class="text-icon-weak-base" />
      <div class="text-12-regular text-text-weak truncate max-w-64">{text()}</div>
      <Show when={running()}>
        <div class={`size-1.5 rounded-full bg-surface-info-strong ${pulseClass()}`} />
      </Show>
    </button>
  )
}
