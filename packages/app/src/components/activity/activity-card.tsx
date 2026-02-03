import type { ActivityItem } from "@/lib/chronology/types"
import { Icon } from "@opencode-ai/ui/icon"
import { createMemo, createSignal, Show, For, createEffect } from "solid-js"
import { getPulseMode, useNowMs } from "./pulse"
import { extractPointers, mapActivityItem, getFailureSuggestions } from "./activity-narrative"

function icon(category: ActivityItem["category"]) {
  if (category === "tool") return "console"
  if (category === "workbench") return "archive"
  if (category === "cache") return "dash"
  if (category === "routing") return "branch"
  return "bullet-list"
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
  const [expanded, setExpanded] = createSignal(false)
  const [copied, setCopied] = createSignal<string | undefined>(undefined)
  
  createEffect(() => {
    if (props.item.status === "failed" || props.item.status === "needs_attention") {
      setExpanded(true)
    }
  })

  const narrative = createMemo(() => mapActivityItem(props.item))
  const suggestions = createMemo(() => getFailureSuggestions(props.item))
  const time = createMemo(() => duration(props.item.tsStart, props.item.tsEnd))

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

  const jump = (e: MouseEvent) => {
    e.stopPropagation()
    const id = props.item.messageId
    if (!id) return
    if (!props.onJumpToMessageId) return
    props.onJumpToMessageId(id)
  }

  const pointers = createMemo(() => {
    if (!expanded()) return []
    return extractPointers(props.item.events)
  })

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(value)
      setTimeout(() => {
        if (copied() !== value) return
        setCopied(undefined)
      }, 1500)
    } catch {
      // Ignore copy errors (e.g. permission); UI remains readable.
    }
  }

  const cmdFrom = (event: { data?: Record<string, unknown> }) => {
    const cmd = event.data?.command
    if (typeof cmd !== "string") return
    const trimmed = cmd.trim()
    if (!trimmed) return
    return trimmed
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
      class="flex flex-col rounded-md border bg-surface-base transition-colors overflow-hidden"
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
      <div 
        class="flex items-start gap-3 px-3 py-2 cursor-pointer hover:bg-surface-raised-base/50"
        onClick={() => setExpanded(!expanded())}
      >
        <div class="mt-0.5 shrink-0 size-7 rounded-md bg-surface-raised-base flex items-center justify-center border border-border-weak-base">
          <Icon name={icon(props.item.category)} size="small" class="text-icon-weak-base" />
        </div>

        <div class="min-w-0 flex-1">
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              <div class="text-12-medium text-text-strong truncate">{narrative().titleZh}</div>
              <Show when={narrative().subtitleZh}>
                 <div class="text-12-regular text-text-weak truncate">{narrative().subtitleZh}</div>
              </Show>
            </div>

            <div class="shrink-0 flex items-center gap-2">
              <Show when={time()}>
                {(v) => <div class="text-11-regular text-text-weak tabular-nums">{v()}</div>}
              </Show>
              <Show when={narrative().badgeZh}>
                <div
                  class="text-11-regular px-2 py-0.5 rounded-full bg-surface-raised-base text-text-subtle border border-border-weak-base flex items-center gap-1.5"
                  classList={{
                    "text-text-on-critical-base bg-surface-critical-base border-border-critical-base":
                      narrative().severity === 'error',
                    "text-text-on-warning-base bg-surface-warning-base border-border-warning-base":
                      narrative().severity === 'warning',
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
                  {narrative().badgeZh}
                </div>
              </Show>
              <Icon 
                 name="chevron-down" 
                 size="small" 
                 class="text-icon-weak-base transition-transform" 
                 classList={{ "rotate-180": expanded() }}
              />
            </div>
          </div>
        </div>
      </div>
      
      <Show when={expanded()}>
        <div class="px-3 pb-3 pt-0 flex flex-col gap-2 border-t border-border-weak-base/50 mt-1">
          <Show when={suggestions().length > 0}>
            <div class="mt-2 p-2 rounded bg-surface-raised-base border border-border-warning-base/30">
              <div class="text-11-medium text-text-strong mb-1">建议操作</div>
              <ul class="list-disc list-inside text-11-regular text-text-weak flex flex-col gap-0.5">
                <For each={suggestions()}>
                  {(s) => <li>{s}</li>}
                </For>
              </ul>
            </div>
          </Show>

          <div class="flex items-center justify-between pt-2">
            <div class="text-11-medium text-text-subtle">审计明细</div>
            <Show when={canJump()}>
              <button
                type="button"
                class="text-11-regular text-text-interactive-base hover:text-text-strong"
                onClick={jump}
              >
                跳转到对话
              </button>
            </Show>
          </div>

          <Show when={pointers().length > 0}>
            <div class="flex flex-col gap-1">
              <div class="text-11-medium text-text-subtle">指针</div>
              <div class="flex flex-wrap gap-1">
                <For each={pointers()}>
                  {(p) => (
                    <button
                      type="button"
                      class="max-w-[32rem] text-11-regular font-mono text-text-weak bg-surface-raised-base px-1.5 py-0.5 rounded border border-border-weak-base hover:bg-surface-raised-base/70 truncate"
                      onClick={() => void copy(p.value)}
                      title={`${p.key}: ${p.value}`}
                    >
                      <span class="opacity-60">{p.key}:</span>{" "}
                      <span class="text-text-strong">{p.value}</span>
                      <Show when={copied() === p.value}>
                        <span class="ml-2 opacity-70">已复制</span>
                      </Show>
                    </button>
                  )}
                </For>
              </div>
            </div>
          </Show>

          <div class="flex flex-col gap-1">
            <div class="text-11-medium text-text-subtle">事件</div>
            <div class="flex flex-col gap-1">
              <For each={props.item.events}>
                {(event) => (
                  <div class="flex gap-2 font-mono text-11-regular text-text-weak break-all items-start">
                    <div class="shrink-0 opacity-50 select-none">{event.ts.slice(11, 23)}</div>
                    <div class="flex-1">
                      <span class="text-text-subtle">[{event.type}]</span> {event.summary}
                      <Show when={cmdFrom(event)}>
                        {(cmd) => (
                          <div class="mt-1 p-1 bg-surface-raised-base rounded border border-border-weak-base text-text-strong whitespace-pre-wrap">
                            {cmd()}
                          </div>
                        )}
                      </Show>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </div>

          <div class="flex gap-2 pt-1 border-t border-border-weak-base/30">
            <div class="text-11-regular text-text-weak font-mono bg-surface-raised-base px-1 rounded">
              活动ID: {props.item.id}
            </div>
            <Show when={props.item.traceId}>
              {(id) => (
                <div class="text-11-regular text-text-weak font-mono bg-surface-raised-base px-1 rounded">
                  Trace: {id()}
                </div>
              )}
            </Show>
          </div>
        </div>
      </Show>
    </div>
  )
}
