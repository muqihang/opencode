import type { ActivityCategory, ActivityItem, ActivityStatus } from "./types"

export type TurnStatus = "idle" | "running" | "needs_attention" | "done"
export type TurnKind = ActivityCategory | "idle"

export type TurnSummary = {
  routing: number
  tool: number
  workbench: number
  cache: number
  other: number
  running: number
  failed: number
  status: TurnStatus
  kind: TurnKind
  last?: ActivityItem
}

function stamp(i: ActivityItem) {
  return i.tsEnd ?? i.tsStart
}

function isFail(s: ActivityStatus) {
  return s === "failed" || s === "needs_attention"
}

function pick(items: ActivityItem[], pred: (i: ActivityItem) => boolean) {
  const filtered = items.filter(pred)
  if (filtered.length === 0) return
  return filtered.reduce((a, b) => (stamp(b) > stamp(a) ? b : a))
}

export function groupActivitiesByMessageId(items: ActivityItem[]) {
  const map = new Map<string, ActivityItem[]>()

  for (const i of items) {
    const id = i.messageId
    if (!id) continue
    const list = map.get(id)
    if (list) {
      list.push(i)
      continue
    }
    map.set(id, [i])
  }

  return map
}

export function summarizeTurn(items: ActivityItem[]): TurnSummary {
  if (items.length === 0) {
    return {
      routing: 0,
      tool: 0,
      workbench: 0,
      cache: 0,
      other: 0,
      running: 0,
      failed: 0,
      status: "idle",
      kind: "idle",
    }
  }

  const counts = items.reduce(
    (acc, i) => {
      if (i.category === "routing") acc.routing++
      if (i.category === "tool") acc.tool++
      if (i.category === "workbench") acc.workbench++
      if (i.category === "cache") acc.cache++
      if (i.category === "other") acc.other++
      if (i.status === "running") acc.running++
      if (isFail(i.status)) acc.failed++
      return acc
    },
    { routing: 0, tool: 0, workbench: 0, cache: 0, other: 0, running: 0, failed: 0 },
  )

  const last = items.reduce((a, b) => (stamp(b) > stamp(a) ? b : a))
  const attention = pick(items, (i) => isFail(i.status))
  const active = pick(items, (i) => i.status === "running")
  const kind = attention?.category ?? active?.category ?? last.category

  if (counts.failed > 0) {
    return { ...counts, status: "needs_attention", kind, last }
  }

  if (counts.running > 0) {
    return { ...counts, status: "running", kind, last }
  }

  return { ...counts, status: "done", kind, last }
}

export function formatTurnSummary(_t: unknown, summary: TurnSummary) {
  // Returns semantic data only; UI decides final copy.
  return summary
}

export function shouldUpdateVisualHeadline(
  prev: { kind: TurnKind; status: TurnStatus },
  next: { kind: TurnKind; status: TurnStatus },
  elapsedMs: number,
) {
  if (prev.kind === next.kind && prev.status === next.status) return false
  if (next.status === "needs_attention") return true
  if (prev.status === "running" && next.status === "done") return true
  if (elapsedMs >= 900) return true
  return false
}

export function latencyTier(elapsedMs: number) {
  if (elapsedMs < 2000) return "fresh"
  if (elapsedMs < 10000) return "long"
  return "very_long"
}

