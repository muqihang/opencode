import { LlmWorkerRolePack } from "@/protocol/llm-worker-role-pack"
import { LlmWorkerResult } from "@/protocol/llm-worker-result"

const noteFor = (count: number) => (count >= 2 ? "证据看起来足够" : "证据可能不足")

export const evidenceCritic = async (rolePack: LlmWorkerRolePack) => {
  const pointers = rolePack.workingSet.pointers
  if (pointers.length === 0) {
    return LlmWorkerResult.parse({
      specVersion: "llm-worker-result/1.0",
      status: "ok",
      toolRequests: [{ kind: "retrieval", input: rolePack.planPointer }],
      notes: ["需要补充证据"],
    })
  }

  return LlmWorkerResult.parse({
    specVersion: "llm-worker-result/1.0",
    status: "ok",
    notes: [noteFor(pointers.length)],
  })
}
