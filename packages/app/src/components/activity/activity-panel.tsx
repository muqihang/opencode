import type { ActivityItem } from "@/lib/chronology/types"
import { ActivityStream } from "./activity-stream"

export function ActivityPanel(props: {
  items: () => ActivityItem[]
  highlightMessageId?: () => string | undefined
  onHighlightMessageId?: (id: string | undefined) => void
  onJumpToMessageId?: (id: string) => void
}) {
  return (
    <div class="px-4 py-3">
      <ActivityStream
        items={props.items}
        highlightMessageId={props.highlightMessageId}
        onHighlightMessageId={props.onHighlightMessageId}
        onJumpToMessageId={props.onJumpToMessageId}
      />
    </div>
  )
}
