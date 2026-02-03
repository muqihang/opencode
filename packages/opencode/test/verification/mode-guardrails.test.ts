import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { runVerification } from "../../src/verification"
import { VerificationMode } from "../../src/protocol/verification-report"

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
        const file = path.join(Instance.worktree, ".opencode", "artifacts", "v", "derived", "note.txt")
        await Bun.write(file, "hello\n")

        const calls = { value: 0 }
        const retrieval = {
          isAvailable: () => true,
          run: async () => {
            calls.value += 1
            return {}
          },
        }

        const base = {
          taskFrame: { specVersion: "task-frame/1.0", sessionId: "v", contextPackId: "ctx" },
          budget: { timeMs: 20000 },
          claims: [{ id: "c1", text: "hello", pointers: [{ path: "derived/note.txt" }] }],
          ctx: buildCtx("v"),
          retrieval,
        } as const

        const strict = await runVerification({ ...base, mode: "strict" })
        expect(strict.ok).toBe(true)
        expect(calls.value).toBe(0)

        const balanced = await runVerification({ ...base, mode: "balanced" })
        expect(balanced.ok).toBe(true)
        expect(calls.value).toBe(1)

        const loose = await runVerification({ ...base, mode: "loose" })
        expect(loose.ok).toBe(true)
        expect(calls.value).toBe(1)
      },
    })
  })
})
