import type { ActivityItem } from "@/lib/chronology/types"
import type { TurnSummary } from "@/lib/chronology/selectors"
import { latencyTier, shouldUpdateVisualHeadline } from "@/lib/chronology/selectors"
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js"
import { ActivityCard } from "./activity-card"
import { useNowMs } from "./pulse"
import { clock, sliceTimeline, turnElapsedMs } from "./turn-activity-logic"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"

type Headline = {
  kind: TurnSummary["kind"]
  status: TurnSummary["status"]
}

function kindLabel(kind: TurnSummary["kind"]) {
  if (kind === "tool") return "工具"
  if (kind === "workbench") return "文件"
  if (kind === "routing") return "规划"
  if (kind === "cache") return "缓存"
  if (kind === "other") return "系统"
  return "活动"
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
  subtasks?: () => { running: number; total: number }
  expanded: () => boolean
  touched: () => boolean
  setExpanded: (next: boolean, user?: boolean) => void
  onInspect?: () => void
}) {
  const now = useNowMs

  const has = createMemo(() => props.items().length > 0)
  const sum = createMemo(() => props.summary())
  const state = createMemo(() => ({ kind: sum().kind, status: sum().status } satisfies Headline))

  const elapsed = createMemo(() => turnElapsedMs(props.items(), now()))
  const tier = createMemo(() => latencyTier(elapsed()))

  const [head, setHead] = createSignal<Headline>(state())
  const [headAt, setHeadAt] = createSignal(now())

  createEffect(() => {
    const next = state()
    const prev = head()
    const ms = now() - headAt()
    if (!shouldUpdateVisualHeadline(prev, next, ms)) return
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
    if (s.status === "needs_attention") return `${kindLabel(head().kind)} · 需要处理`
    if (s.status === "running") {
      if (tier() === "fresh") return `${kindLabel(head().kind)} · 执行中`
      if (tier() === "long") return `${kindLabel(head().kind)} · 仍在执行中`
      return `${kindLabel(head().kind)} · 仍在运行中（请稍候）`
    }
    if (linger()) return "✅ 已完成"
    return summaryLabel(s)
  })

  const subtasks = createMemo(() => props.subtasks?.())

  const toggle = () => props.setExpanded(!props.expanded(), true)

  if (!has()) return null

  return (
    <div data-component="turn-activity" class="pt-2">
      <div class="flex items-center gap-2">
        <Button variant="ghost" size="small" onClick={toggle} aria-expanded={props.expanded()}>
          <div class="flex items-center gap-2">
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
