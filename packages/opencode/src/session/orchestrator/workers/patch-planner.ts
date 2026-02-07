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

const buildNotes = (input: WorkerComputeInput) => {
  const max = textLimit(input)
  const base = clean(`patch plan: propose edits for ${input.rolePack.planPointer}`, max)
  const pointers = input.rolePack.workingSet.pointers.length
  const scope = clean(`context pointers: ${String(pointers)}`, max)
  return [base, scope]
}

export const patchPlanner = async (input: WorkerComputeInput) =>
  LlmWorkerResult.parse({
    specVersion: "llm-worker-result/1.0",
    status: "ok",
    notes: buildNotes(input),
  })
