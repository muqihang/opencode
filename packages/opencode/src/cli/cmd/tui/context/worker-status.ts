export type WorkerPhase = "planned" | "running" | "completed" | "degraded" | "skipped"

export type WorkerLifecycle = {
  sessionID: string
  messageID: string
  workerID: string
  phase: WorkerPhase
  reason?: string
}

export type WorkerTurn = {
  triggered: boolean
  phase: "running" | "completed" | "degraded"
  workers: Record<string, WorkerPhase>
  reason?: string
}

const roleLabel = (workerID: string) => {
  if (workerID === "evidence_critic") return "证据审查"
  if (workerID === "retrieval_planner") return "检索规划"
  if (workerID === "patch_planner") return "修改规划"
  return "协助任务"
}

const phaseLabel = (phase: WorkerPhase) => {
  if (phase === "planned") return "已启动"
  if (phase === "running") return "进行中"
  if (phase === "completed") return "已完成"
  if (phase === "degraded") return "已降级（继续回答）"
  return "未启用"
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
  const reason = typeof input.properties.reason === "string" ? input.properties.reason : undefined
  return {
    sessionID,
    messageID,
    workerID,
    phase: input.properties.phase,
    reason,
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

  const reason = event.phase === "degraded" && event.reason ? event.reason : current?.reason

  return {
    triggered: true,
    phase: phase(workers),
    workers,
    reason,
  }
}

export function formatWorkerHint(turn: WorkerTurn | undefined): string | undefined {
  if (!turn?.triggered) return
  const workers = Object.entries(turn.workers)
  if (workers.length === 0) {
    if (turn.phase === "running") return "协助过程：进行中"
    if (turn.phase === "degraded") return "协助过程：已降级（继续回答）"
    return "协助过程：已完成"
  }

  const labels = workers
    .slice(0, 3)
    .map(([workerID, workerPhase]) => `${roleLabel(workerID)}：${phaseLabel(workerPhase)}`)
  const body = labels.join(" · ")
  return `协助过程：${body}`
}
