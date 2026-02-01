import type { ActivityItem } from "@/lib/chronology/types"

export type SliceNode =
  | { type: "item"; item: ActivityItem }
  | { type: "gap"; hidden: number }

export function sliceTimeline(items: ActivityItem[], opts?: { head?: number; tail?: number }): SliceNode[] {
  const head = opts?.head ?? 5
  const tail = opts?.tail ?? 2
  const total = items.length

  if (total === 0) return []
  if (total <= head + tail) return items.map((item) => ({ type: "item", item }))

  const first = items.slice(0, head).map((item) => ({ type: "item", item }) as const)
  const last = items.slice(total - tail).map((item) => ({ type: "item", item }) as const)
  return [...first, { type: "gap", hidden: total - head - tail }, ...last]
}

function pad2(n: number) {
  return n < 10 ? `0${n}` : String(n)
}

export function clock(elapsedMs: number) {
  const secs = Math.max(0, Math.floor(elapsedMs / 1000))
  const mins = Math.floor(secs / 60)
  const rem = secs % 60
  return `${pad2(mins)}:${pad2(rem)}`
}

export function turnElapsedMs(items: ActivityItem[], nowMs: number) {
  const start = items.reduce((acc, i) => {
    const ms = Date.parse(i.tsStart)
    if (!Number.isFinite(ms)) return acc
    if (acc === undefined) return ms
    return Math.min(acc, ms)
  }, undefined as number | undefined)

  if (start === undefined) return 0

  const running = items.some((i) => i.status === "running")
  if (running) return Math.max(0, nowMs - start)

  const end = items.reduce((acc, i) => {
    const ms = Date.parse(i.tsEnd ?? i.tsStart)
    if (!Number.isFinite(ms)) return acc
    if (acc === undefined) return ms
    return Math.max(acc, ms)
  }, undefined as number | undefined)

  if (end === undefined) return 0
  return Math.max(0, end - start)
}
