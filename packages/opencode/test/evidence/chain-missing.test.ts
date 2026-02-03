import { expect, test } from "bun:test"
import { verifyEvidenceChain } from "../../src/evidence/chain"

test("evidence.chain > missing artifact fails with Chinese reason", () => {
  const result = verifyEvidenceChain({
    entries: [
      { path: ".opencode/evidence/ses/manifest.json", kind: "evidence-manifest" },
      { path: ".opencode/artifacts/ses/routing/request.json", kind: "routing-request" },
    ],
    existing: [".opencode/evidence/ses/manifest.json"],
  })

  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.errorZh).toContain("证据断链")
  expect(result.errorZh).toContain(".opencode/artifacts/ses/routing/request.json")
})

