import type { ActivityItem } from "@/lib/chronology/types"
import { Icon } from "@opencode-ai/ui/icon"
import { createMemo, Show } from "solid-js"

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

export function ActivityCard(props: { item: ActivityItem }) {
  const time = createMemo(() => duration(props.item.tsStart, props.item.tsEnd))
  const status = createMemo(() => label(props.item.status))

  return (
    <div class="flex items-start gap-3 rounded-md border border-border-weak-base bg-surface-base px-3 py-2">
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
              class="text-11-regular px-2 py-0.5 rounded-full bg-surface-raised-base text-text-subtle border border-border-weak-base"
              classList={{
                "animate-pulse": props.item.status === "running",
                "text-text-on-critical-base bg-surface-critical-base border-border-critical-base":
                  props.item.status === "failed",
              }}
            >
              {status()}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
