import z from "zod"
import { EvidenceWriter } from "@/evidence/writer"
import { OrchestratorFeatures } from "@/protocol/orchestrator-features"
import { OrchestratorPlan } from "@/protocol/orchestrator-plan"
import { stableJson } from "@/util/stable-json"
import { normalizeOrchestratorDegraded } from "./degraded-taxonomy"
import { OrchestratorProgressStore } from "./progress-store"

const AdaptiveDegradedCodes = new Set([
  "adaptive.ttc.scale_blocked_budget",
  "adaptive.ttc.guard.budget",
  "adaptive.ttc.budget_overrun",
  "adaptive.ttc.early_stop",
  "adaptive.ttc.degrade_3_to_2",
  "adaptive.ttc.degrade_2_to_1",
  "adaptive.ttc.max_rerun.stop",
  "adaptive.ttc.breaker.active",
  "adaptive.ttc.breaker.trip",
  "adaptive.ttc.fallback.unknown_first",
])

const StopCodes = new Set([
  "adaptive.ttc.early_stop",
  "adaptive.ttc.degrade_3_to_2",
  "adaptive.ttc.degrade_2_to_1",
  "adaptive.ttc.max_rerun.stop",
  "adaptive.ttc.breaker.active",
  "adaptive.ttc.breaker.trip",
])

type Decision = "continue" | "stop"

type Mode = z.infer<typeof OrchestratorPlan>["orchestratorMode"]

type Progress = {
  specVersion: "progress-ledger/1.0"
  messageId: string
  idempotencyKey: string
  cycle: number
  rerunCount: number
  maxRerun: number
  coverageGain: number
  newEvidenceCount: number
  duplicateProbeRate: number
  decision: Decision
  stopReason: string
  fallbackPath: string
  evidence_gain_per_cycle: number
}

const workerMode = (mode: Mode) => mode === "assist" || mode === "heavy"

const progress = (input: { sessionId: string; plan: z.infer<typeof OrchestratorPlan>; cycle: number }): Progress => {
  const maxRerun = input.plan.budgets.maxRerun ?? 1
  const idempotencyKey = `${input.sessionId}:${input.plan.messageId}:${input.plan.orchestratorPlanId}`
  if (!workerMode(input.plan.orchestratorMode)) {
    return {
      specVersion: "progress-ledger/1.0",
      messageId: input.plan.messageId,
      idempotencyKey,
      cycle: 1,
      rerunCount: 0,
      maxRerun,
      coverageGain: 1,
      newEvidenceCount: 1,
      duplicateProbeRate: 0,
      decision: "continue",
      stopReason: "not_stopped",
      fallbackPath: "adaptive.ttc.continue -> dual_pass.draft",
      evidence_gain_per_cycle: 1,
    }
  }

  const adaptive = input.plan.reasons
    .map((item) => item.code)
    .filter((code) => code.startsWith("adaptive.ttc."))
  const rerunStop = adaptive.includes("adaptive.ttc.max_rerun.stop")
  const stop = adaptive.some((code) => StopCodes.has(code))
  if (stop) {
    return {
      specVersion: "progress-ledger/1.0",
      messageId: input.plan.messageId,
      idempotencyKey,
      cycle: input.cycle,
      rerunCount: Math.max(0, input.cycle - 1),
      maxRerun,
      coverageGain: 0,
      newEvidenceCount: 0,
      duplicateProbeRate: 1,
      decision: "stop",
      stopReason: rerunStop ? "max_rerun_exceeded" : "no_new_evidence",
      fallbackPath: "adaptive.ttc.breaker.stop -> dual_pass.unknown-first",
      evidence_gain_per_cycle: 0,
    }
  }

  return {
    specVersion: "progress-ledger/1.0",
    messageId: input.plan.messageId,
    idempotencyKey,
    cycle: input.cycle,
    rerunCount: Math.max(0, input.cycle - 1),
    maxRerun,
    coverageGain: 1,
    newEvidenceCount: 1,
    duplicateProbeRate: 0,
    decision: "continue",
    stopReason: "not_stopped",
    fallbackPath: "adaptive.ttc.continue -> dual_pass.draft",
    evidence_gain_per_cycle: 1,
  }
}

const OrchestratorArtifactsInput = z
  .object({
    sessionId: z.string().min(1),
    plan: OrchestratorPlan,
    features: OrchestratorFeatures,
  })
  .strict()

export async function writeOrchestratorArtifacts(input: z.infer<typeof OrchestratorArtifactsInput>) {
  const data = OrchestratorArtifactsInput.parse(input)
  const writer = await EvidenceWriter.open({ sessionId: data.sessionId })
  const planId = data.plan.orchestratorPlanId
  const durable = await OrchestratorProgressStore.reserve({
    sessionId: data.sessionId,
    messageId: data.plan.messageId,
    worker: workerMode(data.plan.orchestratorMode),
  })
  const cycle = durable.cycle
  const ledger = progress({ sessionId: data.sessionId, plan: data.plan, cycle })
  const base = `orchestrator/${planId}`

  const featuresEntry = await writer.artifact({
    kind: "orchestrator-features",
    path: `${base}/orchestrator.features.json`,
    data: stableJson(data.features),
  })
  const planEntry = await writer.artifact({
    kind: "orchestrator-plan",
    path: `${base}/orchestrator.plan.json`,
    data: stableJson(data.plan),
  })

  const stopExceeded = ledger.stopReason === "max_rerun_exceeded"
  if (stopExceeded) {
    await OrchestratorProgressStore.stop({ sessionId: data.sessionId, messageId: data.plan.messageId })
  }
  const writePlanned = !(stopExceeded && durable.stopped)
  if (writePlanned) {
    await writer.event({
      specVersion: "event/1.0",
      ts: new Date().toISOString(),
      sessionId: data.sessionId,
      severity: "info",
      actor: "orchestrator:writer",
      type: "orchestrator.planned",
      summary: "orchestrator plan recorded",
      data: {
        planId,
        orchestratorEnabled: data.plan.orchestratorMode === "assist" || data.plan.orchestratorMode === "heavy",
        orchestratorMode: data.plan.orchestratorMode,
        uxMode: data.plan.uxMode,
        ...ledger,
        plan_artifact: { path: planEntry.path, sha256: planEntry.sha256 },
        features_artifact: { path: featuresEntry.path, sha256: featuresEntry.sha256 },
      },
      redaction: { applied: true, policyVersion: "v1" },
    })
  }
  const adaptive = data.plan.reasons
    .map((item) => item.code)
    .filter((code) => code.startsWith("adaptive.ttc."))
  const degradedAdaptive = adaptive.filter((code) => AdaptiveDegradedCodes.has(code))
  if (degradedAdaptive.length === 0) return

  const reason = [...new Set(degradedAdaptive)].sort().join(",")
  if (durable.degraded.has(reason)) return
  await OrchestratorProgressStore.degraded({
    sessionId: data.sessionId,
    messageId: data.plan.messageId,
    reason,
  })
  const taxonomy = normalizeOrchestratorDegraded({
    stage: "adaptive_ttc",
    reason,
  })

  await writer
    .event({
      specVersion: "event/1.0",
      ts: new Date().toISOString(),
      sessionId: data.sessionId,
      severity: "warn",
      actor: "orchestrator:writer",
      type: "orchestrator.degraded",
      summary: "orchestrator adaptive ttc degraded",
      data: {
        planId,
        messageId: data.plan.messageId,
        stage: "adaptive_ttc",
        reason,
        ...taxonomy,
      },
      redaction: { applied: true, policyVersion: "v1" },
    })
    .catch(() => {})
}
