import { LlmWorkerResult } from "@/protocol/llm-worker-result"
import type { WorkerComputeInput } from "../worker-spec"

const clean = (value: string, max: number) => {
  const text = value.trim()
  if (text.length <= max) return text
  return text.slice(0, max)
}

const textLimit = (input: WorkerComputeInput) => {
  const scaled = input.rolePack.budget.maxOutputTokens * 4
  const capped = Math.min(380, scaled)
  return Math.max(24, capped)
}

const planNote = (input: WorkerComputeInput) =>
  clean(`retrieval plan: gather evidence for ${input.rolePack.planPointer}`, textLimit(input))

const retrievalRequests = (input: WorkerComputeInput) => {
  if (input.rolePack.budget.maxToolCalls <= 0) return undefined
  if (input.rolePack.workingSet.pointers.length > 0) return undefined
  return [{ kind: "retrieval" as const, input: clean(input.rolePack.planPointer, 1200) }]
}

export const retrievalPlanner = async (input: WorkerComputeInput) =>
  LlmWorkerResult.parse({
    specVersion: "llm-worker-result/1.0",
    status: "ok",
    notes: [planNote(input)],
    toolRequests: retrievalRequests(input),
  })
