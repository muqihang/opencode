import type { LlmWorkerRolePack } from "@/protocol/llm-worker-role-pack"
import type { LlmWorkerResult } from "@/protocol/llm-worker-result"
import { evidenceCritic } from "./workers/evidence-critic"
import { patchPlanner } from "./workers/patch-planner"
import { retrievalPlanner } from "./workers/retrieval-planner"

export type OrchestratorWorkerId = "evidence_critic" | "retrieval_planner" | "patch_planner"

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
    compute: async (input) => evidenceCritic(input),
  },
  retrieval_planner: {
    id: "retrieval_planner",
    compute: async (input) => retrievalPlanner(input),
  },
  patch_planner: {
    id: "patch_planner",
    compute: async (input) => patchPlanner(input),
  },
}

const workerIds: OrchestratorWorkerId[] = ["evidence_critic", "retrieval_planner", "patch_planner"]
const plannerIds: OrchestratorWorkerId[] = ["retrieval_planner", "patch_planner"]

const isWorkerId = (workerId: string): workerId is OrchestratorWorkerId => workerIds.includes(workerId as OrchestratorWorkerId)

export const isPlannerWorker = (workerId: string): workerId is Extract<OrchestratorWorkerId, "retrieval_planner" | "patch_planner"> =>
  plannerIds.includes(workerId as OrchestratorWorkerId)

const get = (workerId: string) => (isWorkerId(workerId) ? registry[workerId] : undefined)

export const WorkerSpec = { get }
