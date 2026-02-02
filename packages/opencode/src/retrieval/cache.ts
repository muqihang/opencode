import { stableJson } from "@/util/stable-json"
import type { RetrievalPlanForKey } from "./spec"
import type { WorkspaceFingerprint } from "./workspace"

const sha256Text = (text: string): string => {
  const hash = new Bun.CryptoHasher("sha256")
  hash.update(text)
  return hash.digest("hex")
}

export const retrievalCacheKey = (input: {
  plan: RetrievalPlanForKey
  workspace: WorkspaceFingerprint
}) => {
  const payload = stableJson({
    specVersion: "retrieval-cache-key/1.0",
    plan: input.plan,
    workspace: input.workspace,
  })
  return sha256Text(payload)
}
