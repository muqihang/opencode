import type { ActivityItem } from "@/lib/chronology/types"
import { ActivityStream } from "./activity-stream"

export function ActivityPanel(props: { items: () => ActivityItem[] }) {
  return (
    <div class="px-4 py-3">
      <ActivityStream items={props.items} />
    </div>
  )
}

