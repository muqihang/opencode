import z from "zod"
import { BusEvent } from "@/bus/bus-event"

export const LifecyclePhase = z.enum(["planned", "running", "completed", "degraded", "skipped"])
export type LifecyclePhase = z.infer<typeof LifecyclePhase>

export const WorkerCache = z.object({
  status: z.enum(["hit", "miss", "expired", "disabled", "forced_rebuild"]),
  tier: z.enum(["memory", "disk", "none"]),
})
export type WorkerCache = z.infer<typeof WorkerCache>

export const LifecyclePayload = z.object({
  sessionID: z.string(),
  sessionId: z.string().optional(),
  messageID: z.string(),
  messageId: z.string().optional(),
  planID: z.string(),
  planId: z.string().optional(),
  workerID: z.string(),
  workerId: z.string().optional(),
  phase: LifecyclePhase,
  attempt: z.number().int().min(1),
  latencyMs: z.number().nonnegative().optional(),
  cache: WorkerCache.optional(),
  reason: z.string().optional(),
  summary: z.string().optional(),
  fromModel: z.string().min(1).optional(),
  toModel: z.string().min(1).optional(),
  gateReason: z.string().min(1).optional(),
  routeFromModel: z.string().min(1).optional(),
  routeToModel: z.string().min(1).optional(),
  routeGateReason: z.string().min(1).optional(),
})
export type LifecyclePayload = z.infer<typeof LifecyclePayload>

export const OrchestratorEvent = {
  WorkerLifecycle: BusEvent.define("orchestrator.worker.lifecycle", LifecyclePayload),
}
