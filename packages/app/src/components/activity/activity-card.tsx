import type { ActivityItem } from "@/lib/chronology/types"
import { Icon } from "@opencode-ai/ui/icon"
import { createMemo, Show } from "solid-js"
import { getPulseMode, useNowMs } from "./pulse"

function icon(category: ActivityItem["category"]) {
  if (category === "tool") return "console"
  if (category === "workbench") return "archive"
  if (category === "cache") return "dash"
  if (category === "routing") return "branch"
  return "bullet-list"
}

function label(status: ActivityItem["status"]) {
  if (status === "running") return "Running"
  if (status === "failed") return "Failed"
  if (status === "needs_attention") return "Needs attention"
  return "Done"
}

function ms(start: string, end?: string) {
  const a = Date.parse(start)
  const b = end ? Date.parse(end) : NaN
  if (!Number.isFinite(a) || !Number.isFinite(b)) return undefined
  return Math.max(0, b - a)
}

function duration(start: string, end?: string) {
  const dt = ms(start, end)
  if (dt === undefined) return undefined
  if (dt < 1000) return `${dt}ms`
  return `${(dt / 1000).toFixed(1)}s`
}

export function matchMessageId(current: string | undefined, item: ActivityItem) {
  if (!current) return false
  if (!item.messageId) return false
  return current === item.messageId
}

export function ActivityCard(props: {
  item: ActivityItem
  highlightMessageId?: () => string | undefined
  onHighlightMessageId?: (id: string | undefined) => void
  onJumpToMessageId?: (id: string) => void
}) {
  const time = createMemo(() => duration(props.item.tsStart, props.item.tsEnd))
  const status = createMemo(() => label(props.item.status))

  const mode = createMemo(() => getPulseMode([props.item], useNowMs()))

  const highlight = createMemo(() => matchMessageId(props.highlightMessageId?.(), props.item))
  const strong = createMemo(() => highlight() || props.item.status === "running")
  const canJump = createMemo(() => !!props.item.messageId && !!props.onJumpToMessageId)

  const enter = () => {
    const id = props.item.messageId
    if (!id) return
    props.onHighlightMessageId?.(id)
  }

  const leave = () => {
    if (!props.onHighlightMessageId) return
    if (!highlight()) return
    props.onHighlightMessageId(undefined)
  }

  const jump = () => {
    const id = props.item.messageId
    if (!id) return
    if (!props.onJumpToMessageId) return
    props.onJumpToMessageId(id)
  }

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

  const pulseColorVar = createMemo(() => {
    switch (mode()) {
      case "breathing":
        return "var(--surface-info-strong)"
      case "flicker":
        return "var(--text-interactive-base)"
      case "arrhythmia":
        return "var(--surface-warning-strong)"
      default:
        return "var(--surface-info-strong)"
    }
  })

  return (
    <div
      class="flex items-start gap-3 rounded-md border bg-surface-base px-3 py-2 transition-colors"
      classList={{
        "border-border-strong-base shadow-[0_0_0_1px_rgba(0,0,0,0.03)] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.05)]":
          strong(),
        "border-border-weak-base": !strong(),
        "bg-surface-raised-base": highlight(),
      }}
      onMouseEnter={enter}
      onMouseLeave={leave}
      onFocusIn={enter}
      onFocusOut={leave}
    >
      <div class="mt-0.5 shrink-0 size-7 rounded-md bg-surface-raised-base flex items-center justify-center border border-border-weak-base">
        <Icon name={icon(props.item.category)} size="small" class="text-icon-weak-base" />
      </div>

      <div class="min-w-0 flex-1">
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0">
            <div class="text-12-medium text-text-strong truncate">{props.item.title}</div>
            <div class="text-12-regular text-text-weak truncate">{props.item.summary}</div>
          </div>

          <div class="shrink-0 flex items-center gap-2">
            <Show when={time()}>
              {(v) => <div class="text-11-regular text-text-weak tabular-nums">{v()}</div>}
            </Show>
            <div
              class="text-11-regular px-2 py-0.5 rounded-full bg-surface-raised-base text-text-subtle border border-border-weak-base flex items-center gap-1.5"
              classList={{
                "text-text-on-critical-base bg-surface-critical-base border-border-critical-base":
                  props.item.status === "failed",
              }}
            >
              <Show when={props.item.status === "running"}>
                <div
                  class={`size-1.5 rounded-full ${pulseClass()}`}
                  style={{
                    "background-color": pulseColorVar(),
                    "--activity-pulse-color": pulseColorVar(),
                  }}
                />
              </Show>
              {status()}
            </div>
            <Show when={canJump()}>
              <button
                type="button"
                class="text-11-regular text-text-interactive-base hover:text-text-strong"
                onClick={jump}
              >
                Jump
              </button>
            </Show>
          </div>
        </div>
      </div>
    </div>
  )
}
