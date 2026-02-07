import { expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { runToolBroker } from "../../src/session/orchestrator/tool-broker"
import { tmpdir } from "../fixture/fixture"

test("tool broker rejects kind not listed in policy.allowed", async () => {
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const input = {
        sessionId: "session_tb_policy_kind",
        messageId: "msg_tb_policy_kind",
        toolRequests: [{ kind: "retrieval" as const, input: "alpha" }],
        toolPolicy: { allowed: ["verification"], bounceMax: 1 as const },
        abort: new AbortController().signal,
      } as Parameters<typeof runToolBroker>[0]

      const result = await runToolBroker(input)
      const entry = result.results[0]!
      expect(entry.status).toBe("rejected")
      expect(entry.reason).toBe("policy_kind_not_allowed_v1")
    },
  })
})

test("tool broker enforces bounceMax=1 by rejecting second cycle", async () => {
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const input = {
        sessionId: "session_tb_bounce",
        messageId: "msg_tb_bounce",
        toolRequests: [{ kind: "retrieval" as const, input: "alpha" }],
        toolPolicy: { allowed: ["retrieval"], bounceMax: 1 as const },
        cycle: 2,
        abort: new AbortController().signal,
      } as Parameters<typeof runToolBroker>[0]

      const result = await runToolBroker(input)
      const entry = result.results[0]!
      expect(entry.status).toBe("rejected")
      expect(entry.reason).toBe("bounce_limit_v1")
    },
  })
})
