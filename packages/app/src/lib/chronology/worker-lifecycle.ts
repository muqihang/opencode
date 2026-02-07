import type { EventV1 } from "./types"

export type WorkerLifecyclePhase = "planned" | "running" | "completed" | "degraded" | "skipped"

export type WorkerLifecycleCounts = {
  planned: number
  running: number
  completed: number
  degraded: number
  skipped: number
}

export type WorkerLifecycleSummary = {
  phase: WorkerLifecyclePhase
  counts: WorkerLifecycleCounts
  total: number
  workers: number
  latestTs: string
}

export type WorkerLifecycleEvent = {
  sessionID: string
  messageID: string
  workerID: string
  phase: WorkerLifecyclePhase
  attempt: number
}

type WorkerState = {
  worker: string
  attempt: number
  phase: WorkerLifecyclePhase
  ts: string
}

type WorkerBadgeTone = "info" | "success" | "warning"

export type WorkerBadge = {
  tone: WorkerBadgeTone
  phase: string
  text: string
  counts: string
}

const emptyCounts = (): WorkerLifecycleCounts => ({
  planned: 0,
  running: 0,
  completed: 0,
  degraded: 0,
  skipped: 0,
})

function lifecycleData(event: EventV1) {
  const data = event.data
  if (!data || typeof data !== "object") return
  return data
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null
}

function lifecyclePhase(input: unknown): WorkerLifecyclePhase | undefined {
  if (input === "planned") return input
  if (input === "running") return input
  if (input === "completed") return input
  if (input === "degraded") return input
  if (input === "skipped") return input
}

function messageId(event: EventV1) {
  const data = lifecycleData(event)
  if (!data) return

  const id = data.messageId
  if (typeof id === "string" && id.length > 0) return id

  const legacy = data.messageID
  if (typeof legacy === "string" && legacy.length > 0) return legacy
}

function workerId(event: EventV1) {
  const data = lifecycleData(event)
  if (!data) return "unknown"

  const id = data.workerId
  if (typeof id === "string" && id.length > 0) return id

  const legacy = data.workerID
  if (typeof legacy === "string" && legacy.length > 0) return legacy

  const actor = event.actor
  const fromActor = actor.includes(":") ? actor.split(":").slice(1).join(":") : actor
  if (fromActor.length > 0) return fromActor
  return "unknown"
}

function phase(event: EventV1): WorkerLifecyclePhase | undefined {
  const data = lifecycleData(event)
  if (!data) return

  return lifecyclePhase(data.phase)
}

function attempt(event: EventV1) {
  const data = lifecycleData(event)
  if (!data) return 1

  const value = data.attempt
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value

  if (typeof value !== "string") return 1

  const num = Number(value)
  if (Number.isInteger(num) && num > 0) return num
  return 1
}

function summaryPhase(counts: WorkerLifecycleCounts): WorkerLifecyclePhase {
  if (counts.degraded > 0) return "degraded"
  if (counts.running > 0) return "running"
  if (counts.planned > 0) return "planned"
  if (counts.completed > 0) return "completed"
  return "skipped"
}

function phaseLabel(phase: WorkerLifecyclePhase) {
  if (phase === "degraded") return "已降级"
  if (phase === "running") return "执行中"
  if (phase === "planned") return "已规划"
  if (phase === "completed") return "已完成"
  return "已跳过"
}

function phaseTone(phase: WorkerLifecyclePhase): WorkerBadgeTone {
  if (phase === "degraded") return "warning"
  if (phase === "completed") return "success"
  return "info"
}

function state(event: EventV1): WorkerState | undefined {
  if (event.type !== "orchestrator.worker.lifecycle") return

  const message = messageId(event)
  if (!message) return

  const worker = workerId(event)
  if (!worker) return

  const next = phase(event)
  if (!next) return

  return {
    worker,
    attempt: attempt(event),
    phase: next,
    ts: event.ts,
  }
}

export function readWorkerLifecycle(input: { type: string; properties?: unknown }): WorkerLifecycleEvent | undefined {
  if (input.type !== "orchestrator.worker.lifecycle") return
  if (!isRecord(input.properties)) return

  const sessionID =
    typeof input.properties.sessionID === "string"
      ? input.properties.sessionID
      : typeof input.properties.sessionId === "string"
        ? input.properties.sessionId
        : undefined
  const messageID =
    typeof input.properties.messageID === "string"
      ? input.properties.messageID
      : typeof input.properties.messageId === "string"
        ? input.properties.messageId
        : undefined
  const workerID =
    typeof input.properties.workerID === "string"
      ? input.properties.workerID
      : typeof input.properties.workerId === "string"
        ? input.properties.workerId
        : undefined
  const phase = lifecyclePhase(input.properties.phase)

  if (!sessionID) return
  if (!messageID) return
  if (!workerID) return
  if (!phase) return

  const attemptRaw = input.properties.attempt
  const attempt =
    typeof attemptRaw === "number" && Number.isInteger(attemptRaw) && attemptRaw > 0
      ? attemptRaw
      : typeof attemptRaw === "string" && Number.isInteger(Number(attemptRaw)) && Number(attemptRaw) > 0
        ? Number(attemptRaw)
        : 1

  return {
    sessionID,
    messageID,
    workerID,
    phase,
    attempt,
  }
}

export function lifecycleEventV1(event: WorkerLifecycleEvent, ts: string): EventV1 {
  return {
    specVersion: "event/1.0",
    ts,
    sessionId: event.sessionID,
    severity: "info",
    actor: "orchestrator:worker",
    type: "orchestrator.worker.lifecycle",
    summary: "worker lifecycle",
    data: {
      messageID: event.messageID,
      workerID: event.workerID,
      phase: event.phase,
      attempt: event.attempt,
    },
    redaction: { applied: true, policyVersion: "v1" },
  }
}

export function groupWorkerLifecycleByMessage(events: EventV1[]) {
  const sorted = events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => {
      if (a.event.ts === b.event.ts) return a.index - b.index
      return a.event.ts.localeCompare(b.event.ts)
    })

  const byMessage = new Map<string, Map<string, WorkerState>>()

  for (const node of sorted) {
    const parsed = state(node.event)
    if (!parsed) continue

    const message = messageId(node.event)
    if (!message) continue

    const key = `${parsed.worker}:${parsed.attempt}`
    const group = byMessage.get(message)
    if (!group) {
      const next = new Map<string, WorkerState>()
      next.set(key, parsed)
      byMessage.set(message, next)
      continue
    }

    group.set(key, parsed)
  }

  const result = new Map<string, WorkerLifecycleSummary>()

  for (const [message, group] of byMessage) {
    const values = [...group.values()]
    if (values.length === 0) continue

    const counts = values.reduce(
      (acc, item) => {
        if (item.phase === "planned") acc.planned++
        if (item.phase === "running") acc.running++
        if (item.phase === "completed") acc.completed++
        if (item.phase === "degraded") acc.degraded++
        if (item.phase === "skipped") acc.skipped++
        return acc
      },
      emptyCounts(),
    )

    const latest = values.reduce((prev, item) => (item.ts > prev.ts ? item : prev))
    const workers = new Set(values.map((item) => item.worker)).size

    result.set(message, {
      phase: summaryPhase(counts),
      counts,
      total: values.length,
      workers,
      latestTs: latest.ts,
    })
  }

  return result
}

export function workerBadge(summary: WorkerLifecycleSummary): WorkerBadge {
  const phase = phaseLabel(summary.phase)
  const tone = phaseTone(summary.phase)
  const text = `本轮 worker 已触发 · ${phase}`

  const extra = [
    summary.counts.planned > 0 ? `规划 ${summary.counts.planned}` : "",
    summary.counts.skipped > 0 ? `跳过 ${summary.counts.skipped}` : "",
  ]
    .filter(Boolean)
    .join(" · ")

  const base = `运行 ${summary.counts.running} · 完成 ${summary.counts.completed} · 降级 ${summary.counts.degraded}`
  const counts = extra ? `${base} · ${extra}` : base

  return { tone, phase, text, counts }
}
