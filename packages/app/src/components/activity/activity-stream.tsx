import type { ActivityItem } from "@/lib/chronology/types"
import { ActivityCard } from "./activity-card"
import { For, Show, createMemo } from "solid-js"

export function ActivityStream(props: { items: ActivityItem[] }) {
  const now = createMemo(() => props.items.filter((i) => i.status !== "done"))
  const done = createMemo(() => props.items.filter((i) => i.status === "done"))

  return (
    <div class="flex flex-col gap-2">
      <Show when={now().length > 0}>
        <div class="sticky top-0 z-10 -mx-4 px-4 py-2 bg-surface-raised-stronger-non-alpha/90 backdrop-blur-sm border-b border-border-weak-base">
          <div class="text-12-medium text-text-strong">Now</div>
        </div>
        <div class="flex flex-col gap-2">
          <For each={now()}>{(item) => <ActivityCard item={item} />}</For>
        </div>
      </Show>

      <Show when={done().length > 0}>
        <div class="pt-2">
          <div class="text-12-medium text-text-subtle px-1">Recent</div>
        </div>
        <div class="flex flex-col gap-2">
          <For each={done()}>{(item) => <ActivityCard item={item} />}</For>
        </div>
      </Show>

      <Show when={props.items.length === 0}>
        <div class="text-12-regular text-text-weak px-2 py-4">No activity yet.</div>
      </Show>
    </div>
  )
}

