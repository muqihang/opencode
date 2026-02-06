import { describe, expect, test } from "bun:test"
import { tool, jsonSchema, type Tool } from "ai"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { EvidenceReader } from "../../src/evidence/reader"
import { prepareOrchestratorPlan } from "../../src/session/orchestrator/prepare"

const makeTool = (): Tool =>
  tool({
    description: "test tool",
    inputSchema: jsonSchema({ type: "object", properties: {} }),
    execute: async () => ({ output: "", title: "", metadata: {} }),
  })

describe("orchestrator integration", () => {
  test("prepare writes artifacts without mutating messages or tools", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionId = "session-orch-integrate"
        const messageId = "msg-orch-integrate"
        const tools = {
          read: makeTool(),
          write: makeTool(),
        }
        const messages = [
          {
            role: "user" as const,
            content: [{ type: "text" as const, text: "Please review the file." }],
          },
        ]
        const toolsSnapshot = Object.keys(tools)
        const messagesSnapshot = JSON.stringify(messages)

        const result = await prepareOrchestratorPlan({
          sessionId,
          messageId,
          uxMode: "auto",
          messages,
          tools,
        })

        expect(result.plan.sessionId).toBe(sessionId)
        expect(result.plan.messageId).toBe(messageId)
        expect(Object.keys(tools)).toEqual(toolsSnapshot)
        expect(JSON.stringify(messages)).toBe(messagesSnapshot)

        const events = await EvidenceReader.readEvents(sessionId, { cursor: 0 })
        const planned = events.events.some((event) => event.type === "orchestrator.planned")
        expect(planned).toBe(true)

        const manifest = await EvidenceReader.readManifest(sessionId)
        const hasPlan = manifest.entries.some((entry) => entry.kind === "orchestrator-plan")
        const hasFeatures = manifest.entries.some((entry) => entry.kind === "orchestrator-features")
        expect(hasPlan).toBe(true)
        expect(hasFeatures).toBe(true)
      },
    })
  })
})
