import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { runVerification } from "../../src/verification"
import { VerificationMode } from "../../src/protocol/verification-report"
import { artifactCandidates, resolveTenantScope } from "../../src/util/tenant-context"

async function artifactRoot(sessionId: string) {
  const scope = resolveTenantScope()
  const candidates = artifactCandidates({
    base: Instance.worktree,
    sessionId,
    tenantId: scope.tenantId,
    orgId: scope.orgId,
  })
  for (const candidate of candidates) {
    const exists = await Bun.file(candidate).exists()
    if (exists) return candidate
  }
  return candidates[0]!
}

const buildCtx = (sessionId: string) => ({
  sessionID: sessionId,
  messageID: "",
  callID: "",
  agent: "verification",
  abort: AbortSignal.any([]),
  metadata: () => {},
  ask: async () => {},
})

describe("verification.mode guardrails", () => {
  test("protocol accepts loose mode", () => {
    expect(VerificationMode.parse("loose")).toBe("loose")
  })

  test("balanced may attempt retrieval; strict/loose must not", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const artifactBase = await artifactRoot("v")
        const file = path.join(artifactBase, "derived", "note.txt")
        await Bun.write(file, "hello\n")

        const calls = { value: 0 }
        const retrieval = {
          isAvailable: () => true,
          run: async () => {
            calls.value += 1
            return {}
          },
        }

        const input = {
          taskFrame: { specVersion: "task-frame/1.0", sessionId: "v", contextPackId: "ctx" },
          budget: { timeMs: 20000 },
          claims: [{ id: "c1", text: "hello", pointers: [{ path: "derived/note.txt" }] }],
          ctx: buildCtx("v"),
          retrieval,
        } satisfies Omit<Parameters<typeof runVerification>[0], "mode">

        const strict = await runVerification({ ...input, mode: "strict" })
        expect(strict.ok).toBe(true)
        expect(calls.value).toBe(0)

        const balanced = await runVerification({ ...input, mode: "balanced" })
        expect(balanced.ok).toBe(true)
        expect(calls.value).toBe(1)

        const loose = await runVerification({ ...input, mode: "loose" })
        expect(loose.ok).toBe(true)
        expect(calls.value).toBe(1)
      },
    })
  })
})
