import type { LlmWorkerRolePack } from "@/protocol/llm-worker-role-pack"
import type { LlmWorkerResult } from "@/protocol/llm-worker-result"
import { evidenceCritic } from "./workers/evidence-critic"

export type OrchestratorWorkerId = "evidence_critic"

export type WorkerModel = {
  providerID: string
  modelID: string
}

export type WorkerComputeInput = {
  rolePack: LlmWorkerRolePack
  model?: WorkerModel
  now?: string
}

export type WorkerSpecItem = {
  id: OrchestratorWorkerId
  compute: (input: WorkerComputeInput) => Promise<LlmWorkerResult>
}

const registry: Record<OrchestratorWorkerId, WorkerSpecItem> = {
  evidence_critic: {
    id: "evidence_critic",
    compute: async (input) => evidenceCritic(input.rolePack),
  },
}

const get = (workerId: string) => registry[workerId as OrchestratorWorkerId]

export const WorkerSpec = { get }
