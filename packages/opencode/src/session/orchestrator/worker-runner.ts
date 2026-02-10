import { EvidenceWriter } from "@/evidence/writer"
import { CachePolicy } from "@/cache/policy"
import { CacheStore } from "@/cache/store"
import { Instance } from "@/project/instance"
import { stableJson } from "@/util/stable-json"
import { sha256Text } from "@/routing/cache"
import { LlmWorkerRolePack } from "@/protocol/llm-worker-role-pack"
import { LlmWorkerResult } from "@/protocol/llm-worker-result"
import { WorkerSpec, type WorkerModel } from "./worker-spec"
import { Bus } from "@/bus"
import { OrchestratorEvent } from "./event"

type WorkerCache = {
  status: "hit" | "miss" | "expired" | "disabled" | "forced_rebuild"
  tier: "memory" | "disk" | "none"
}

type LifecycleReason =
  | "role_pack_invalid"
  | "evidence_unavailable"
  | "role_pack_artifact_failed"
  | "worker_unknown"
  | "worker_compute_failed"
  | "worker_result_invalid"
  | "worker_degraded"
  | "worker_output_invalid"

type WorkerCompute = (input: {
  rolePack: LlmWorkerRolePack
  model?: WorkerModel
  now?: string
}) => Promise<LlmWorkerResult>

type RunInput = {
  sessionId: string
  messageId?: string
  workerId: string
  rolePack: LlmWorkerRolePack
  model?: WorkerModel
  now?: number
  compute?: WorkerCompute
}

const ttlMs = 15 * 60 * 1000
const toolLimit = 4

const baseDir = () => (Instance.worktree === "/" ? Instance.directory : Instance.worktree)

const trimNote = (value: string) => (value.length > 380 ? `${value.slice(0, 380)}...` : value)

const safeNote = (value: string) => trimNote(value.replace(/```/g, "''"))

const routeDebug = (value: string) => {
  const text = value.trim().toLowerCase()
  return text.startsWith("from_model=") || text.startsWith("to_model=") || text.startsWith("gate_reason=")
}

const summaryText = (value: string) => safeNote(value).replace(/\s+/g, " ").trim()

const resultSummary = (value: LlmWorkerResult) => {
  const note = (value.notes ?? []).find((item) => {
    const text = item.trim()
    if (!text) return false
    return !routeDebug(text)
  })
  if (!note) return
  const summary = summaryText(note)
  if (!summary) return
  return summary
}

const errorText = (error: unknown) => {
  if (error instanceof Error) return error.message
  return String(error)
}

const planIdFromPointer = (value: string) => {
  const normalized = value.trim().replace(/\\/g, "/")
  if (!normalized) return
  if (!normalized.includes("/")) return normalized
  const match = normalized.match(/orchestrator\/([^/]+)/)
  if (match?.[1]) return match[1]
  const parts = normalized.split("/").filter(Boolean)
  const tail = parts[parts.length - 1]
  if (tail && tail !== "plan.json" && tail !== "plan") return tail
  if (parts.length > 1) return parts[parts.length - 2]
}

const storeScope = () => ({
  projectId: Instance.project.id,
  worktreeRoot: baseDir(),
})

const cacheKey = (input: { workerId: string; rolePack: LlmWorkerRolePack; model?: WorkerModel }) => {
  const scope = storeScope()
  return CacheStore.key({
    namespace: "orchestrator-worker",
    scope,
    input: {
      specVersion: "orchestrator-worker-cache-key/1.0",
      workerId: input.workerId,
      model: input.model ?? null,
      rolePack: input.rolePack,
      versions: { stableJson: "v1" },
    },
  })
}

const degraded = (reason: string, tools?: LlmWorkerResult["toolRequests"]) =>
  LlmWorkerResult.parse({
    specVersion: "llm-worker-result/1.0",
    status: "degraded",
    toolRequests: tools && tools.length > 0 ? tools : undefined,
    notes: [safeNote(reason)],
  })

const verify = (value: LlmWorkerResult) => {
  const notes = (value.notes ?? []).filter((note) => !routeDebug(note))
  const tools = value.toolRequests ?? []
  const issues: string[] = []

  if (notes.some((note) => note.includes("```"))) issues.push("notes contain code fences")
  if (tools.length > toolLimit) issues.push(`toolRequests limit exceeded (${toolLimit})`)
  if (issues.length === 0) return { ok: true as const, result: value }

  const safeTools = tools.length > toolLimit ? [] : tools
  const safeNotes = issues.map((issue) => safeNote(`degraded: ${issue}`))
  const result = LlmWorkerResult.parse({
    specVersion: "llm-worker-result/1.0",
    status: "degraded",
    toolRequests: safeTools.length > 0 ? safeTools : undefined,
    notes: safeNotes,
  })
  return { ok: false as const, result }
}

const emptyCache = { status: "miss", tier: "none" } as const

const toLifecycleReason = (input: {
  type: LifecycleReason
  detail?: string
  safeDetail?: boolean
}) => {
  if (input.safeDetail && input.detail) {
    const text = safeNote(input.detail)
    if (text.length > 0) return `${input.type}:${text}`
  }
  return input.type
}

const writeLifecycleEvidence = async (input: {
  sessionId: string
  messageId?: string
  planId: string
  workerId: string
  phase: "planned" | "running" | "completed" | "degraded" | "skipped"
  attempt: number
  cache?: WorkerCache
  reason?: string
  summary?: string
  latencyMs?: number
}) => {
  const writer = await EvidenceWriter.open({ sessionId: input.sessionId }).catch(() => undefined)
  if (!writer) return
  await writer
    .event({
      specVersion: "event/1.0",
      ts: new Date().toISOString(),
      sessionId: input.sessionId,
      severity: input.phase === "degraded" ? "warn" : "info",
      actor: "orchestrator:worker",
      type: "orchestrator.worker.lifecycle",
      summary: "worker lifecycle",
      data: {
        messageID: input.messageId,
        messageId: input.messageId,
        planID: input.planId,
        planId: input.planId,
        workerID: input.workerId,
        workerId: input.workerId,
        phase: input.phase,
        attempt: input.attempt,
        cache: input.cache,
        reason: input.reason,
        summary: input.summary,
        latencyMs: input.latencyMs,
      },
      redaction: { applied: true, policyVersion: "v1" },
    })
    .catch(() => {})
}

const emitLifecycle = async (input: {
  sessionId: string
  messageId?: string
  planId: string
  workerId: string
  phase: "planned" | "running" | "completed" | "degraded" | "skipped"
  attempt: number
  cache?: WorkerCache
  reason?: string
  summary?: string
  latencyMs?: number
}) => {
  const messageId = input.messageId
  if (!messageId || messageId === "unknown") return

  await Bus.publish(OrchestratorEvent.WorkerLifecycle, {
    sessionID: input.sessionId,
    sessionId: input.sessionId,
    messageID: messageId,
    messageId,
    planID: input.planId,
    planId: input.planId,
    workerID: input.workerId,
    workerId: input.workerId,
    phase: input.phase,
    attempt: input.attempt,
    cache: input.cache,
    reason: input.reason,
    summary: input.summary,
    latencyMs: input.latencyMs,
  }).catch(() => {})

  await writeLifecycleEvidence({
    sessionId: input.sessionId,
    messageId,
    planId: input.planId,
    workerId: input.workerId,
    phase: input.phase,
    attempt: input.attempt,
    cache: input.cache,
    reason: input.reason,
    summary: input.summary,
    latencyMs: input.latencyMs,
  })
}

export const WorkerRunner = {
  async run(input: RunInput): Promise<{ result: LlmWorkerResult; cache: WorkerCache }> {
    const parsed = LlmWorkerRolePack.safeParse(input.rolePack)
    const rolePackForPlan = parsed.success ? parsed.data : undefined
    const planId = rolePackForPlan ? (planIdFromPointer(rolePackForPlan.planPointer) ?? sha256Text(rolePackForPlan.planPointer).slice(0, 12)) : "invalid"
    const started = typeof input.now === "number" ? input.now : Date.now()
    await emitLifecycle({
      sessionId: input.sessionId,
      messageId: input.messageId,
      planId,
      workerId: input.workerId,
      phase: "planned",
      attempt: 1,
    })

    if (!parsed.success) {
      await emitLifecycle({
        sessionId: input.sessionId,
        messageId: input.messageId,
        planId,
        workerId: input.workerId,
        phase: "degraded",
        attempt: 1,
        reason: toLifecycleReason({ type: "role_pack_invalid" }),
      })
      return { result: degraded("role pack invalid"), cache: emptyCache }
    }

    const rolePack = parsed.data

    const writer = await EvidenceWriter.open({ sessionId: input.sessionId }).catch(() => undefined)
    if (!writer) {
      await emitLifecycle({
        sessionId: input.sessionId,
        messageId: input.messageId,
        planId,
        workerId: input.workerId,
        phase: "skipped",
        attempt: 1,
        reason: toLifecycleReason({ type: "evidence_unavailable" }),
      })
      return { result: degraded("evidence writer unavailable"), cache: emptyCache }
    }

    const rolePath = `orchestrator/${planId}/workers/${input.workerId}/role-pack.json`

    const wrote = await writer
      .artifact({
        kind: "orchestrator-worker-role-pack",
        path: rolePath,
        data: stableJson(rolePack),
      })
      .then((entry) => ({ ok: true as const, entry }))
      .catch((error) => ({ ok: false as const, error }))

    if (!wrote.ok) {
      const reason = errorText(wrote.error)
      await emitLifecycle({
        sessionId: input.sessionId,
        messageId: input.messageId,
        planId,
        workerId: input.workerId,
        phase: "degraded",
        attempt: 1,
        reason: toLifecycleReason({
          type: "role_pack_artifact_failed",
          detail: reason,
          safeDetail: true,
        }),
      })
      return { result: degraded(`role pack artifact failed: ${reason}`), cache: emptyCache }
    }

    const worker = input.compute ? { compute: input.compute } : WorkerSpec.get(input.workerId)
    if (!worker) {
      await emitLifecycle({
        sessionId: input.sessionId,
        messageId: input.messageId,
        planId,
        workerId: input.workerId,
        phase: "skipped",
        attempt: 1,
        reason: toLifecycleReason({ type: "worker_unknown", safeDetail: true, detail: input.workerId }),
      })
      return { result: degraded(`unknown worker: ${input.workerId}`), cache: emptyCache }
    }

    await emitLifecycle({
      sessionId: input.sessionId,
      messageId: input.messageId,
      planId,
      workerId: input.workerId,
      phase: "running",
      attempt: 1,
    })

    const scope = storeScope()
    const capturedNow = input.now
    const clock = typeof capturedNow === "number" ? { nowMs: () => capturedNow } : undefined
    const store = CacheStore.open({
      namespace: "orchestrator-worker",
      scope,
      limits: CachePolicy.limits(),
      ...(clock ? { clock } : {}),
    })

    const key = cacheKey({ workerId: input.workerId, rolePack, model: input.model })
    const policy = { enabled: CachePolicy.effective().storeEnabled, force: false }
    const nowMs = typeof input.now === "number" ? input.now : Date.now()
    const nowIso = new Date(nowMs).toISOString()
    const compute = () => worker.compute({ rolePack, model: input.model, now: nowIso })

    const read = (nextPolicy: { enabled: boolean; force: boolean }) =>
      store
        .getOrCompute({ key, ttlMs, policy: nextPolicy, compute })
        .then((value) => ({ ok: true as const, value }))
        .catch((error) => ({ ok: false as const, error }))

    const resolved = await (async () => {
      const first = await read(policy)
      if (!first.ok) return { state: "compute_error" as const, error: first.error }

      const firstCache = { status: first.value.status, tier: first.value.tier }
      const firstResult = LlmWorkerResult.safeParse(first.value.value)
      if (!firstResult.success) {
        return { state: "result_invalid" as const, cache: firstCache }
      }

      if (firstCache.status !== "hit") {
        return { state: "ok" as const, cache: firstCache, result: firstResult.data }
      }
      if (firstResult.data.status === "ok") {
        return { state: "ok" as const, cache: firstCache, result: firstResult.data }
      }

      const forced = await read({ enabled: policy.enabled, force: true })
      if (!forced.ok) return { state: "compute_error" as const, error: forced.error }

      const forcedCache = { status: forced.value.status, tier: forced.value.tier }
      const forcedResult = LlmWorkerResult.safeParse(forced.value.value)
      if (!forcedResult.success) {
        return { state: "result_invalid" as const, cache: forcedCache }
      }
      return { state: "ok" as const, cache: forcedCache, result: forcedResult.data }
    })()

    if (resolved.state === "compute_error") {
      const reason = errorText(resolved.error)
      await emitLifecycle({
        sessionId: input.sessionId,
        messageId: input.messageId,
        planId,
        workerId: input.workerId,
        phase: "degraded",
        attempt: 1,
        reason: toLifecycleReason({
          type: "worker_compute_failed",
          detail: reason,
          safeDetail: false,
        }),
      })
      return { result: degraded(`worker compute failed: ${reason}`), cache: emptyCache }
    }

    if (resolved.state === "result_invalid") {
      await emitLifecycle({
        sessionId: input.sessionId,
        messageId: input.messageId,
        planId,
        workerId: input.workerId,
        phase: "degraded",
        attempt: 1,
        cache: resolved.cache,
        reason: toLifecycleReason({ type: "worker_result_invalid" }),
      })
      return { result: degraded("worker result schema invalid"), cache: resolved.cache }
    }

    const cache = resolved.cache
    const verified = verify(resolved.result)
    const ended = typeof input.now === "number" ? input.now : Date.now()
    const phase = verified.result.status === "degraded" ? "degraded" : "completed"
    await emitLifecycle({
      sessionId: input.sessionId,
      messageId: input.messageId,
      planId,
      workerId: input.workerId,
      phase,
      attempt: 1,
      cache,
      latencyMs: Math.max(0, ended - started),
      reason: verified.result.status === "degraded" ? toLifecycleReason({ type: "worker_degraded" }) : undefined,
      summary: resultSummary(verified.result),
    })
    return { result: verified.result, cache }
  },
}
