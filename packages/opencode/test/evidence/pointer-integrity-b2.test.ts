import { expect, test } from "bun:test"
import { verifyEvidenceChain } from "../../src/evidence/chain"

const badSha = "0".repeat(64)
const goodSha = "a".repeat(64)
const pointerPath = ".opencode/artifacts/ses/retrieval/r1/hits.json"

test("evidence.chain B2 > detects missing pointer references", () => {
  const result = verifyEvidenceChain({
    entries: [{ path: pointerPath, kind: "retrieval-hits" }],
    existing: [pointerPath],
    pointers: [
      { kind: "artifact", ref: pointerPath },
      { kind: "artifact", ref: ".opencode/artifacts/ses/retrieval/r1/missing.json" },
    ],
  } as any)

  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.missing).toContain(".opencode/artifacts/ses/retrieval/r1/missing.json")
  expect(result.errorZh).toContain("pointer")
})

test("evidence.chain B2 > detects pointer sha contamination", () => {
  const result = verifyEvidenceChain({
    entries: [{ path: pointerPath, kind: "retrieval-hits", sha256: goodSha }],
    existing: [pointerPath],
    pointers: [{ kind: "artifact", ref: pointerPath, sha256: badSha }],
    hashes: { [pointerPath]: goodSha },
  } as any)

  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.errorZh).toContain("污染")
  expect(result.errorZh).toContain(pointerPath)
})
