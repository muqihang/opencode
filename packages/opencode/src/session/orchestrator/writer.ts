import z from "zod"
import { EvidenceWriter } from "@/evidence/writer"
import { OrchestratorFeatures } from "@/protocol/orchestrator-features"
import { OrchestratorPlan } from "@/protocol/orchestrator-plan"
import { stableJson } from "@/util/stable-json"

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
      orchestratorMode: data.plan.orchestratorMode,
      uxMode: data.plan.uxMode,
      plan_artifact: { path: planEntry.path, sha256: planEntry.sha256 },
      features_artifact: { path: featuresEntry.path, sha256: featuresEntry.sha256 },
    },
    redaction: { applied: true, policyVersion: "v1" },
  })
}
