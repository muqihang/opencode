import type { ActivityItem } from "@/lib/chronology/types"
import { ActivityStream } from "./activity-stream"
import { createSignal } from "solid-js"
import { Switch } from "@opencode-ai/ui/switch"
import { useLocal } from "@/context/local"

export function ActivityPanel(props: {
  items: () => ActivityItem[]
  highlightMessageId?: () => string | undefined
  onHighlightMessageId?: (id: string | undefined) => void
  onJumpToMessageId?: (id: string) => void
}) {
  const [showAudit, setShowAudit] = createSignal(false)
  const local = useLocal()

  return (
    <div class="flex flex-col h-full overflow-hidden max-h-[80vh]">
      <div class="shrink-0 px-4 py-2 border-b border-border-weak-base flex items-center justify-end bg-surface-base sticky top-0 z-20">
         <div class="flex items-center gap-2">
            <span class="text-12-regular text-text-weak">显示系统事件（审计）</span>
            <Switch checked={showAudit()} onChange={setShowAudit} />
         </div>
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto px-4 py-3">
        <ActivityStream
          items={props.items}
          highlightMessageId={props.highlightMessageId}
          onHighlightMessageId={props.onHighlightMessageId}
          onJumpToMessageId={props.onJumpToMessageId}
          onOpenFile={(p) => local.file.open(p)}
          showAudit={showAudit}
        />
      </div>
    </div>
  )
}
