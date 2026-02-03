import type { ActivityItem } from "@/lib/chronology/types"
import { ActivityCard } from "./activity-card"
import { For, Show, createMemo } from "solid-js"
import { mapActivityItem } from "./activity-narrative"

export function ActivityStream(props: {
  items: () => ActivityItem[]
  highlightMessageId?: () => string | undefined
  onHighlightMessageId?: (id: string | undefined) => void
  onJumpToMessageId?: (id: string) => void
  onOpenFile?: (path: string) => void | Promise<void>
  showAudit?: () => boolean
}) {
  const visible = createMemo(() => {
    const all = props.items()
    const showAudit = props.showAudit?.() ?? false
    if (showAudit) return all
    return all.filter((i) => !mapActivityItem(i).isNoise)
  })

  const now = createMemo(() => visible().filter((i) => i.status !== "done"))
  const done = createMemo(() => visible().filter((i) => i.status === "done"))
  const empty = createMemo(() => visible().length === 0)

  return (
    <div class="flex flex-col gap-2 pb-4">
      <Show when={now().length > 0}>
        <div class="sticky top-0 z-10 -mx-4 px-4 py-2 bg-surface-raised-stronger-non-alpha/90 backdrop-blur-sm border-b border-border-weak-base">
          <div class="text-12-medium text-text-strong">进行中</div>
        </div>
        <div class="flex flex-col gap-2">
          <For each={now()}>
            {(item) => (
              <ActivityCard
                item={item}
                highlightMessageId={props.highlightMessageId}
                onHighlightMessageId={props.onHighlightMessageId}
                onJumpToMessageId={props.onJumpToMessageId}
                onOpenFile={props.onOpenFile}
              />
            )}
          </For>
        </div>
      </Show>

      <Show when={done().length > 0}>
        <div class="pt-2">
          <div class="text-12-medium text-text-subtle px-1">最近活动</div>
        </div>
        <div class="flex flex-col gap-2">
          <For each={done()}>
            {(item) => (
              <ActivityCard
                item={item}
                highlightMessageId={props.highlightMessageId}
                onHighlightMessageId={props.onHighlightMessageId}
                onJumpToMessageId={props.onJumpToMessageId}
                onOpenFile={props.onOpenFile}
              />
            )}
          </For>
        </div>
      </Show>

      <Show when={empty()}>
        <div class="text-12-regular text-text-weak px-2 py-4">
          {props.items().length === 0 ? "暂无活动" : "暂无可显示的活动（可打开“显示系统事件（审计）”）"}
        </div>
      </Show>
    </div>
  )
}
