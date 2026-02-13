import z from "zod"
import { EvidenceWriter } from "@/evidence/writer"
import { OrchestratorFeatures } from "@/protocol/orchestrator-features"
import { OrchestratorPlan } from "@/protocol/orchestrator-plan"
import { stableJson } from "@/util/stable-json"

const AdaptiveDegradedCodes = new Set([
  "adaptive.ttc.scale_blocked_budget",
  "adaptive.ttc.guard.budget",
  "adaptive.ttc.budget_overrun",
  "adaptive.ttc.early_stop",
  "adaptive.ttc.degrade_3_to_2",
  "adaptive.ttc.degrade_2_to_1",
  "adaptive.ttc.breaker.active",
  "adaptive.ttc.breaker.trip",
])

const StopCodes = new Set([
  "adaptive.ttc.early_stop",
  "adaptive.ttc.degrade_3_to_2",
  "adaptive.ttc.degrade_2_to_1",
  "adaptive.ttc.breaker.active",
  "adaptive.ttc.breaker.trip",
])

type Decision = "continue" | "stop"

type Progress = {
  specVersion: "progress-ledger/1.0"
  messageId: string
  cycle: number
  coverageGain: number
  newEvidenceCount: number
  duplicateProbeRate: number
  decision: Decision
  stopReason: string
  evidence_gain_per_cycle: number
}

const cycles = new Map<string, number>()

const nextCycle = (input: { sessionId: string; messageId: string }) => {
  const key = `${input.sessionId}:${input.messageId}`
  const value = (cycles.get(key) ?? 0) + 1
  cycles.set(key, value)
  return value
}

const progress = (input: { plan: z.infer<typeof OrchestratorPlan>; cycle: number }): Progress => {
  const adaptive = input.plan.reasons
    .map((item) => item.code)
    .filter((code) => code.startsWith("adaptive.ttc."))
  const stop = adaptive.some((code) => StopCodes.has(code))
  if (stop) {
    return {
      specVersion: "progress-ledger/1.0",
      messageId: input.plan.messageId,
      cycle: input.cycle,
      coverageGain: 0,
      newEvidenceCount: 0,
      duplicateProbeRate: 1,
      decision: "stop",
      stopReason: "no_new_evidence",
      evidence_gain_per_cycle: 0,
    }
  }

  return {
    specVersion: "progress-ledger/1.0",
    messageId: input.plan.messageId,
    cycle: input.cycle,
    coverageGain: 1,
    newEvidenceCount: 1,
    duplicateProbeRate: 0,
    decision: "continue",
    stopReason: "not_stopped",
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
  const cycle = nextCycle({ sessionId: data.sessionId, messageId: data.plan.messageId })
  const ledger = progress({ plan: data.plan, cycle })
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

  const adaptive = data.plan.reasons
    .map((item) => item.code)
    .filter((code) => code.startsWith("adaptive.ttc."))
  const degradedAdaptive = adaptive.filter((code) => AdaptiveDegradedCodes.has(code))
  if (degradedAdaptive.length === 0) return

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
        reason: degradedAdaptive.join(","),
      },
      redaction: { applied: true, policyVersion: "v1" },
    })
    .catch(() => {})
}
