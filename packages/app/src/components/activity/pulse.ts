import type { ActivityItem } from "@/lib/chronology/types"

export type PulseMode = "breathing" | "flicker" | "arrhythmia" | "none"

export function getPulseMode(items: ActivityItem[], nowMs: number): PulseMode {
  const runningItems = items.filter((i) => i.status === "running")
  if (runningItems.length === 0) return "none"

  // Check for stalled/long-running items (> 20s)
  const stalled = runningItems.some((i) => {
    const start = new Date(i.tsStart).getTime()
    return nowMs - start > 20000
  })

  if (stalled) return "arrhythmia"

  // Check for high-throughput items (flicker)
  const hasHighThroughput = runningItems.some((i) => 
    i.category === "tool" || i.category === "workbench"
  )

  if (hasHighThroughput) return "flicker"

  // Default to breathing (routing, etc.)
  return "breathing"
}