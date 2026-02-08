import type { ActivityItem } from "@/lib/chronology/types"
import type { TurnSummary } from "@/lib/chronology/selectors"
import { latencyTier } from "@/lib/chronology/selectors"
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js"
import { ActivityCard } from "./activity-card"
import { useNowMs } from "./pulse"
import { clock, sliceTimeline, turnElapsedMs, selectHeadlineItem } from "./turn-activity-logic"
import { mapActivityItem } from "./activity-narrative"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import type { WorkerLifecycleSummary } from "@/lib/chronology/worker-lifecycle"
import { workerBadge } from "@/lib/chronology/worker-lifecycle"

type Headline = {
  kind: TurnSummary["kind"]
  status: TurnSummary["status"]
  text: string
}

function shouldUpdate(prev: Headline, next: Headline, ms: number) {
  if (next.status === "needs_attention") return true
  if (prev.status === "running" && next.status === "done") return true

  const same = prev.kind === next.kind && prev.status === next.status && prev.text === next.text
  if (same) return false

  return ms >= 900
}

function summaryLabel(summary: TurnSummary) {
  const parts = [
    summary.tool > 0 ? `工具 ${summary.tool}` : "",
    summary.workbench > 0 ? `文件 ${summary.workbench}` : "",
    summary.routing > 0 ? `规划 ${summary.routing}` : "",
    summary.cache > 0 ? `缓存 ${summary.cache}` : "",
    summary.other > 0 ? `其他 ${summary.other}` : "",
  ].filter(Boolean)

  if (parts.length === 0) return "已完成"
  return `已完成 · ${parts.join(" · ")}`
}

export function TurnActivity(props: {
  messageId: string
  items: () => ActivityItem[]
  summary: () => TurnSummary
  workerLifecycle?: () => WorkerLifecycleSummary | undefined
  subtasks?: () => { running: number; total: number }
  expanded: () => boolean
  touched: () => boolean
  setExpanded: (next: boolean, user?: boolean) => void
  onInspect?: () => void
}) {
  const now = useNowMs

  const has = createMemo(() => props.items().length > 0)
  const sum = createMemo(() => props.summary())

  const headlineItem = createMemo(() => selectHeadlineItem(props.items()))
  const narrative = createMemo(() => (headlineItem() ? mapActivityItem(headlineItem()!) : undefined))

  const state = createMemo(
    () =>
      ({
        kind: sum().kind,
        status: sum().status,
        text: narrative()?.titleZh ?? "活动",
      }) satisfies Headline,
  )

  const elapsed = createMemo(() => turnElapsedMs(props.items(), now()))

  const [head, setHead] = createSignal<Headline>(state())
  const [headAt, setHeadAt] = createSignal(now())

  createEffect(() => {
    const next = state()
    const prev = head()
    const ms = now() - headAt()
    if (!shouldUpdate(prev, next, ms)) return
    setHead(next)
    setHeadAt(now())
  })

  const [linger, setLinger] = createSignal(false)
  const [timer, setTimer] = createSignal<number | undefined>(undefined)

  createEffect(
    on(
      () => sum().status,
      (next, prev) => {
        const t = timer()
        if (t !== undefined) {
          clearTimeout(t)
          setTimer(undefined)
        }

        if (next !== "done") {
          setLinger(false)
          return
        }

        if (prev !== "running") return
        if (props.touched()) return

        setLinger(true)
        setTimer(
          setTimeout(() => {
            setLinger(false)
            props.setExpanded(false)
          }, 1500) as unknown as number,
        )
      },
      { defer: true },
    ),
  )

  onCleanup(() => {
    const t = timer()
    if (t === undefined) return
    clearTimeout(t)
  })

  createEffect(() => {
    if (props.touched()) return
    if (!has()) return

    const status = sum().status
    if (status === "needs_attention") props.setExpanded(true)
    if (status === "running") props.setExpanded(true)
  })

  const subtitle = createMemo(() => {
    const s = sum()
    const text = head().text

    if (s.status === "needs_attention") return `${text} · 需要处理`
    if (s.status === "running") {
      const ms = elapsed()
      if (ms > 10000) return `${text} · 仍在运行中`
      if (ms > 2000) return `${text} · 执行中`
      return text
    }
    if (linger()) return "✅ 已完成"
    return text
  })

  const subtasks = createMemo(() => props.subtasks?.())
  const worker = createMemo(() => props.workerLifecycle?.())
  const badge = createMemo(() => {
    const summary = worker()
    if (!summary) return
    return workerBadge(summary)
  })

  const badgeClass = createMemo(() => {
    const tone = badge()?.tone
    if (tone === "success") return "border-border-success-base bg-surface-success-base text-text-on-success-base"
    if (tone === "warning") return "border-border-warning-base bg-surface-warning-base text-text-on-warning-base"
    return "border-border-weak-base bg-surface-raised-base text-text-subtle"
  })

  const toggle = () => props.setExpanded(!props.expanded(), true)

  if (!has()) return null

  return (
    <div data-component="turn-activity" class="pt-2">
      <div class="flex items-center gap-2">
        <Button variant="ghost" size="small" onClick={toggle} aria-expanded={props.expanded()}>
          <div class="flex items-center gap-2 flex-wrap">
            <Icon
              name="chevron-down"
              size="small"
              class="transition-transform"
              classList={{ "rotate-180": props.expanded() }}
            />
            <span class="text-12-medium text-text-strong">{subtitle()}</span>
            <span class="text-12-regular text-text-weak">{clock(elapsed())}</span>
            <Show when={(subtasks()?.running ?? 0) > 0}>
              <span class="text-12-regular text-text-weak">
                · 并行子任务 ×{subtasks()?.running}
              </span>
            </Show>
            <Show when={badge()}>
              {(b) => (
                <span class={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-11-regular ${badgeClass()}`}>
                  <span>{b().text}</span>
                  <span classList={{
                    "text-11-regular": true,
                    "text-text-subtle": b().tone === "info",
                    "text-text-on-success-base": b().tone === "success",
                    "text-text-on-warning-base": b().tone === "warning",
                  }}>
                    · {b().counts}
                  </span>
                  <Show when={b().roles.length > 0}>
                    <span classList={{
                      "text-11-regular": true,
                      "text-text-subtle": b().tone === "info",
                      "text-text-on-success-base": b().tone === "success",
                      "text-text-on-warning-base": b().tone === "warning",
                    }}>
                      · {b().roles.join(" · ")}
                    </span>
                  </Show>
                </span>
              )}
            </Show>
          </div>
        </Button>

        <Show when={props.onInspect}>
          <Button variant="ghost" size="small" onClick={() => props.onInspect?.()}>
            查看审计
          </Button>
        </Show>
      </div>

      <Show when={props.expanded()}>
        <div class="mt-2 max-h-[40vh] overflow-y-auto flex flex-col gap-2 pr-1">
          <For each={sliceTimeline(props.items())}>
            {(node) => {
              if (node.type === "gap") {
                return (
                  <div class="text-12-regular text-text-weak px-2 py-1">
                    …… 已折叠 {node.hidden} 条活动 ……
                  </div>
                )
              }
              return <ActivityCard item={node.item} />
            }}
          </For>
        </div>
      </Show>
    </div>
  )
}
