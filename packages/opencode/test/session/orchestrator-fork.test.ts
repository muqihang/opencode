import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Agent } from "../../src/agent/agent"
import { Identifier } from "../../src/id/id"
import { MessageV2 } from "../../src/session/message-v2"
import { Bus } from "../../src/bus"
import { PermissionNext } from "../../src/permission/next"
import { EvidenceReader } from "../../src/evidence/reader"
import { runForkTask } from "../../src/session/orchestrator/fork"

describe("orchestrator fork task", () => {
  test("permission reject degrades with notice and tool audit", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({
          permission: [
            {
              permission: "task",
              pattern: "*",
              action: "ask",
            },
          ],
        })
        const agent = await Agent.get("build")
        const model = { providerID: "test-provider", modelID: "test-model" }
        const ruleset = PermissionNext.merge(agent.permission, session.permission ?? [])
        expect(PermissionNext.evaluate("task", "general", ruleset).action).toBe("ask")
        const userMessageId = Identifier.ascending("message")
        await Session.updateMessage({
          id: userMessageId,
          role: "user",
          sessionID: session.id,
          time: { created: Date.now() },
          agent: agent.name,
          model: model,
        })
        const assistantMessageId = Identifier.ascending("message")
        await Session.updateMessage({
          id: assistantMessageId,
          parentID: userMessageId,
          role: "assistant",
          mode: agent.name,
          agent: agent.name,
          path: { cwd: tmp.path, root: tmp.path },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: model.modelID,
          providerID: model.providerID,
          time: { created: Date.now() },
          sessionID: session.id,
        })

        let asked: PermissionNext.Request | undefined
        const unsub = Bus.subscribe(PermissionNext.Event.Asked, (event) => {
          if (event.properties.sessionID !== session.id) return
          asked = event.properties
          PermissionNext.reply({ requestID: event.properties.id, reply: "reject" })
        })

        const directAsk = PermissionNext.ask({
          permission: "task",
          patterns: ["general"],
          metadata: {},
          always: ["*"],
          sessionID: session.id,
          ruleset,
        })
          .then(() => "allowed")
          .catch(() => "rejected")
        const directResult = await Promise.race([
          directAsk,
          new Promise<string>((resolve) => setTimeout(() => resolve("timeout"), 1000)),
        ])
        expect(directResult).toBe("rejected")

        const forkCall = runForkTask({
          sessionId: session.id,
          assistantMessageId,
          agent,
          session,
          model: {
            providerID: model.providerID,
            id: model.modelID,
            api: { npm: "test", id: "test" },
          },
          abort: new AbortController().signal,
          task: {
            description: "orchestrator task",
            subagentType: "general",
            prompt: "请在子会话完成写入任务",
          },
        })
        const forkOutcome = await Promise.race([
          forkCall,
          new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 1000)),
        ])
        if (forkOutcome === "timeout") {
          throw new Error(`fork task timed out; asked=${Boolean(asked)}`)
        }
        const result = forkOutcome
        unsub()

        expect(result.status).toBe("degraded")
        expect(result.notice?.includes("派工提示")).toBe(true)
        expect(result.notice?.includes("description:")).toBe(true)
        expect(result.notice?.includes("subagent_type:")).toBe(true)
        expect(result.notice?.includes("prompt:")).toBe(true)

        expect(Boolean(asked)).toBe(true)
        expect(asked?.tool?.messageID).toBe(assistantMessageId)
        expect(asked?.tool?.callID).toBe(result.callId)

        const parts = await MessageV2.parts(assistantMessageId)
        const toolPart = parts.find(
          (part) => part.type === "tool" && part.tool === "task" && part.callID === result.callId,
        ) as MessageV2.ToolPart | undefined
        expect(Boolean(toolPart)).toBe(true)
        expect(toolPart?.state.status).toBe("error")

        const events = await EvidenceReader.readEvents(session.id, { cursor: 0 })
        const degraded = events.events.find((event) => event.type === "orchestrator.degraded")
        expect(Boolean(degraded)).toBe(true)
        expect(degraded?.data?.stage).toBe("fork_task")
      },
    })
  })
})
