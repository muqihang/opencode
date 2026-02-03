import type { ActivityItem } from "@/lib/chronology/types"
import { Icon } from "@opencode-ai/ui/icon"
import { createMemo, createSignal, Show, For, createEffect } from "solid-js"
import { getPulseMode, useNowMs } from "./pulse"
import { extractPointers, mapActivityItem, getFailureSuggestions } from "./activity-narrative"
import { getFilename } from "@opencode-ai/util/path"

type CapsuleAssistedStatus = "success" | "degraded" | "failed"

type CapsuleAssistedAnchor = {
  path: string
  sha256?: string
  kind: string
}

type CapsuleAssistedItem = {
  type: "decision" | "question"
  status: "known" | "unknown"
  text: string
  unknownReasonZh?: string
  evidenceIndices: number[]
}

type CapsuleAssistedPayload = {
  status: CapsuleAssistedStatus
  degradedReasonZh?: string
  items: CapsuleAssistedItem[]
  anchors: CapsuleAssistedAnchor[]
}

function assistedFromEvents(events: ActivityItem["events"]): CapsuleAssistedPayload | undefined {
  const event = events.find((e) => e.type.startsWith("capsule.assisted."))
  if (!event) return
  if (event.type === "capsule.assisted.requested") return

  const data = event.data
  const obj = data && typeof data === "object" ? (data as Record<string, unknown>) : undefined
  const capsuleRaw = obj?.capsule
  if (!capsuleRaw || typeof capsuleRaw !== "object") return
  const capsule = capsuleRaw as Record<string, unknown>

  const statusRaw = capsule.status
  const status =
    statusRaw === "success" || statusRaw === "degraded" || statusRaw === "failed"
      ? statusRaw
      : event.type.endsWith(".completed")
        ? "success"
        : event.type.endsWith(".failed")
          ? "failed"
          : "degraded"

  const degradedReasonZh =
    typeof capsule.degradedReasonZh === "string"
      ? capsule.degradedReasonZh
      : typeof obj?.degradedReasonZh === "string"
        ? (obj.degradedReasonZh as string)
        : undefined

  const anchorsRaw = Array.isArray(capsule.anchors) ? capsule.anchors : []
  const anchors = anchorsRaw
    .map((a) => {
      if (!a || typeof a !== "object") return
      const rec = a as Record<string, unknown>
      const path = typeof rec.path === "string" ? rec.path : ""
      const kind = typeof rec.kind === "string" ? rec.kind : "file"
      const sha256 = typeof rec.sha256 === "string" ? rec.sha256 : undefined
      if (!path) return
      return { path, kind, sha256 } satisfies CapsuleAssistedAnchor
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x))

  const itemsRaw = Array.isArray(capsule.items) ? capsule.items : []
  const items = itemsRaw
    .map((i) => {
      if (!i || typeof i !== "object") return
      const rec = i as Record<string, unknown>
      if (rec.type !== "decision" && rec.type !== "question") return
      if (rec.status !== "known" && rec.status !== "unknown") return
      const text = typeof rec.text === "string" ? rec.text.trim() : ""
      if (!text) return

      const evidenceRaw = Array.isArray(rec.evidenceIndices) ? rec.evidenceIndices : []
      const evidenceIndices = evidenceRaw.filter((v): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0)
      const unknownReasonZh = typeof rec.unknownReasonZh === "string" ? rec.unknownReasonZh : undefined

      return {
        type: rec.type,
        status: rec.status,
        text,
        unknownReasonZh,
        evidenceIndices,
      } satisfies CapsuleAssistedItem
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x))

  if (items.length === 0 && anchors.length === 0) return
  return { status, degradedReasonZh, items, anchors }
}

function assistedMarkdown(payload: CapsuleAssistedPayload) {
  const knownDecisions = payload.items.filter((i) => i.type === "decision" && i.status === "known")
  const knownQuestions = payload.items.filter((i) => i.type === "question" && i.status === "known")
  const unknowns = payload.items.filter((i) => i.status === "unknown")

  const lineFor = (item: CapsuleAssistedItem) => {
    const refs = item.evidenceIndices
      .map((idx) => payload.anchors[idx]?.path ?? "")
      .filter((p) => p.length > 0)
      .map((p) => `\`${p}\``)
    const tail = refs.length > 0 ? ` (${refs.join(", ")})` : ""
    const reason = item.status === "unknown" && item.unknownReasonZh ? ` — 无法核验：${item.unknownReasonZh}` : ""
    return `- ${item.text}${tail}${reason}`
  }

  const block = (title: string, list: CapsuleAssistedItem[]) => {
    const lines = list.length > 0 ? list.map(lineFor) : ["- (none)"]
    return [title, ...lines, ""]
  }

  return [
    "# AI 建议要点（可核验）",
    "",
    `- status: ${payload.status}`,
    ...(payload.degradedReasonZh ? [`- degradedReasonZh: ${payload.degradedReasonZh}`] : []),
    "",
    ...block("## 已形成的决策", knownDecisions),
    ...block("## 仍待确认的问题", knownQuestions),
    ...(unknowns.length > 0 ? block("## 未知/风险", unknowns) : []),
  ].join("\n")
}

function statusTone(status: CapsuleAssistedStatus) {
  if (status === "success") return { badge: "可核验", tone: "blue" as const }
  if (status === "degraded") return { badge: "已降级", tone: "amber" as const }
  return { badge: "失败", tone: "red" as const }
}

function AssistedPanel(props: {
  payload: CapsuleAssistedPayload
  onCopy: (text: string, mark: string) => void
  copied: () => string | undefined
  onOpenFile?: (path: string) => void | Promise<void>
}) {
  const [lens, setLens] = createSignal<number | undefined>(undefined)
  const [unknownOpen, setUnknownOpen] = createSignal(false)

  const tone = createMemo(() => statusTone(props.payload.status))

  const knownDecisions = createMemo(() => props.payload.items.filter((i) => i.type === "decision" && i.status === "known"))
  const knownQuestions = createMemo(() => props.payload.items.filter((i) => i.type === "question" && i.status === "known"))
  const unknowns = createMemo(() => props.payload.items.filter((i) => i.status === "unknown"))

  const anchor = createMemo(() => {
    const idx = lens()
    if (idx === undefined) return
    return { idx, value: props.payload.anchors[idx] }
  })

  const openFile = async (p: string) => {
    if (!props.onOpenFile) return
    await props.onOpenFile(p)
  }

  const toggleLens = (idx: number) => setLens(lens() === idx ? undefined : idx)

  const chip = (idx: number) => {
    const a = props.payload.anchors[idx]
    if (!a) return null
    const name = getFilename(a.path)
    const active = createMemo(() => lens() === idx)
    return (
      <button
        type="button"
        class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-11-regular transition-colors"
        classList={{
          "bg-surface-raised-base border-border-weak-base text-text-strong hover:bg-surface-raised-base/70": !active(),
          "bg-surface-info-base border-border-info-base text-text-on-info-base": active() && tone().tone === "blue",
          "bg-surface-warning-base border-border-warning-base text-text-on-warning-base": active() && tone().tone === "amber",
          "bg-surface-critical-base border-border-critical-base text-text-on-critical-base": active() && tone().tone === "red",
        }}
        onClick={() => toggleLens(idx)}
        title={a.path}
      >
        <span class="opacity-80 select-none">📄</span>
        <span class="truncate max-w-56">{name || a.path}</span>
      </button>
    )
  }

  const sectionTitle = (icon: string, text: string) => (
    <div class="flex items-center gap-2">
      <span class="select-none">{icon}</span>
      <div class="text-12-medium text-text-strong">{text}</div>
    </div>
  )

  const itemRow = (item: CapsuleAssistedItem) => {
    const indices = item.evidenceIndices.filter((n) => n < props.payload.anchors.length)
    return (
      <div class="flex flex-col gap-1.5">
        <div class="text-12-regular text-text-strong">{item.text}</div>
        <Show when={indices.length > 0}>
          <div class="flex flex-wrap gap-1">
            <For each={indices}>{(idx) => chip(idx)}</For>
          </div>
        </Show>
      </div>
    )
  }

  const unknownRow = (item: CapsuleAssistedItem) => (
    <div class="rounded border border-border-warning-base bg-surface-warning-base/10 px-3 py-2">
      <div class="text-12-regular text-text-strong">{item.text}</div>
      <Show when={item.unknownReasonZh}>
        {(r) => <div class="text-11-regular text-text-weak mt-1">⚠️ 无法核验：{r()}</div>}
      </Show>
    </div>
  )

  const unknownList = createMemo(() => {
    const list = unknowns()
    if (unknownOpen()) return list
    return list.slice(0, 3)
  })

  const unknownMore = createMemo(() => Math.max(0, unknowns().length - unknownList().length))

  const blueprint = createMemo(() => assistedMarkdown(props.payload))

  return (
    <div class="flex flex-col gap-3">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="text-14-medium text-text-strong">AI 建议要点</div>
          <div class="text-12-regular text-text-weak">以下内容基于当前上下文推演，请人工核实。</div>
        </div>
        <div class="shrink-0 flex items-center gap-2">
          <div
            class="text-11-regular px-2 py-0.5 rounded-full border select-none"
            classList={{
              "bg-surface-info-base border-border-info-base text-text-on-info-base": tone().tone === "blue",
              "bg-surface-warning-base border-border-warning-base text-text-on-warning-base": tone().tone === "amber",
              "bg-surface-critical-base border-border-critical-base text-text-on-critical-base": tone().tone === "red",
            }}
          >
            {tone().badge}
          </div>
          <button
            type="button"
            class="text-11-regular px-2 py-1 rounded border border-border-weak-base bg-surface-raised-base hover:bg-surface-raised-base/70"
            onClick={() => void props.onCopy(blueprint(), "blueprint")}
          >
            复制蓝图
            <Show when={props.copied() === "blueprint"}>
              <span class="ml-2 opacity-70">已复制</span>
            </Show>
          </button>
        </div>
      </div>

      <Show when={props.payload.degradedReasonZh && props.payload.status !== "success"}>
        {(r) => (
          <div class="rounded border border-border-warning-base bg-surface-warning-base/10 px-3 py-2 text-12-regular text-text-weak">
            {r()}
          </div>
        )}
      </Show>

      <div class="grid grid-cols-1 gap-3">
        <div class="flex flex-col gap-2">
          {sectionTitle("✅", "已决之理（Decisions）")}
          <Show when={knownDecisions().length > 0} fallback={<div class="text-12-regular text-text-weak">暂无</div>}>
            <div class="flex flex-col gap-2">
              <For each={knownDecisions()}>{(i) => itemRow(i)}</For>
            </div>
          </Show>
        </div>

        <div class="flex flex-col gap-2">
          {sectionTitle("❓", "未决之疑（Open Questions）")}
          <Show when={knownQuestions().length > 0} fallback={<div class="text-12-regular text-text-weak">暂无</div>}>
            <div class="flex flex-col gap-2">
              <For each={knownQuestions()}>{(i) => itemRow(i)}</For>
            </div>
          </Show>
        </div>

        <Show when={unknowns().length > 0}>
          <div class="flex flex-col gap-2">
            {sectionTitle("⚠️", "未知/风险（Unknowns）")}
            <div class="flex flex-col gap-2">
              <For each={unknownList()}>{(i) => unknownRow(i)}</For>
              <Show when={unknownMore() > 0}>
                <button
                  type="button"
                  class="text-12-regular text-text-interactive-base hover:text-text-strong self-start"
                  onClick={() => setUnknownOpen(true)}
                >
                  展开剩余 {unknownMore()} 条未知项
                </button>
              </Show>
            </div>
          </div>
        </Show>
      </div>

      <Show when={anchor()}>
        {(a) => (
          <div class="rounded border border-border-weak-base bg-surface-raised-base px-3 py-2">
            <div class="text-11-medium text-text-subtle mb-1">Evidence Lens</div>
            <div class="text-11-regular text-text-strong font-mono break-all">{a().value.path}</div>
            <Show when={a().value.sha256}>
              {(s) => <div class="text-11-regular text-text-weak font-mono mt-1">SHA: {s()}</div>}
            </Show>
            <div class="flex gap-2 mt-2">
              <button
                type="button"
                class="text-11-regular px-2 py-1 rounded border border-border-weak-base bg-surface-base hover:bg-surface-raised-base/70"
                onClick={() => void props.onCopy(a().value.path, a().value.path)}
              >
                复制路径
                <Show when={props.copied() === a().value.path}>
                  <span class="ml-2 opacity-70">已复制</span>
                </Show>
              </button>
              <button
                type="button"
                class="text-11-regular px-2 py-1 rounded border border-border-weak-base bg-surface-base hover:bg-surface-raised-base/70"
                onClick={() => void openFile(a().value.path)}
              >
                打开文件
              </button>
              <button
                type="button"
                class="text-11-regular px-2 py-1 rounded border border-border-weak-base bg-surface-base hover:bg-surface-raised-base/70"
                onClick={() => setLens(undefined)}
              >
                关闭
              </button>
            </div>
          </div>
        )}
      </Show>
    </div>
  )
}

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
  onOpenFile?: (path: string) => void | Promise<void>
}) {
  const [expanded, setExpanded] = createSignal(false)
  const [copied, setCopied] = createSignal<string | undefined>(undefined)
  const assisted = createMemo(() => assistedFromEvents(props.item.events))
  
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

  const copy = async (text: string, mark: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(mark)
      setTimeout(() => {
        if (copied() !== mark) return
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
        <Show
          when={assisted()}
          fallback={<div class="px-3 pb-3 pt-0 flex flex-col gap-2 border-t border-border-weak-base/50 mt-1">
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
                      onClick={() => void copy(p.value, p.value)}
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
        </div>}
        >
          {(payload) => (
            <div class="px-3 pb-3 pt-3 flex flex-col gap-2 border-t border-border-weak-base/50 mt-1">
              <AssistedPanel payload={payload()} onCopy={copy} copied={copied} onOpenFile={props.onOpenFile} />
            </div>
          )}
        </Show>
      </Show>
    </div>
  )
}
