export type WorkerPhase = "planned" | "running" | "completed" | "degraded" | "skipped"

export type WorkerLifecycle = {
  sessionID: string
  messageID: string
  workerID: string
  phase: WorkerPhase
}

export type WorkerTurn = {
  triggered: boolean
  phase: "running" | "completed" | "degraded"
  workers: Record<string, WorkerPhase>
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null
}

function isWorkerPhase(input: unknown): input is WorkerPhase {
  return (
    input === "planned" ||
    input === "running" ||
    input === "completed" ||
    input === "degraded" ||
    input === "skipped"
  )
}

export function readWorkerLifecycle(input: { type: string; properties?: unknown }): WorkerLifecycle | undefined {
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
  if (!sessionID) return
  if (!messageID) return
  if (messageID === "unknown") return
  if (!workerID) return
  if (!isWorkerPhase(input.properties.phase)) return
  return {
    sessionID,
    messageID,
    workerID,
    phase: input.properties.phase,
  }
}

function phase(workers: Record<string, WorkerPhase>): "running" | "completed" | "degraded" {
  const states = Object.values(workers)
  if (states.some((item) => item === "planned" || item === "running")) return "running"
  if (states.some((item) => item === "degraded")) return "degraded"
  return "completed"
}

export function mergeWorkerTurn(current: WorkerTurn | undefined, event: WorkerLifecycle): WorkerTurn {
  const workers = {
    ...(current?.workers ?? {}),
    [event.workerID]: event.phase,
  }
  return {
    triggered: true,
    phase: phase(workers),
    workers,
  }
}

export function formatWorkerHint(turn: WorkerTurn | undefined): string | undefined {
  if (!turn?.triggered) return
  if (turn.phase === "running") return "本轮 worker 已触发 · 运行中"
  if (turn.phase === "degraded") return "本轮 worker 已触发 · 已降级"
  return "本轮 worker 已触发 · 已完成"
}
