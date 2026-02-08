import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { EvidenceReader } from "../../src/evidence/reader"
import { extractFeatures } from "../../src/session/orchestrator/features"
import { buildPlan } from "../../src/session/orchestrator/plan"
import { runOrchestratorTurn } from "../../src/session/orchestrator"
import type { Tool } from "ai"
import { tool, jsonSchema } from "ai"

const makeTool = (): Tool =>
  tool({
    description: "test tool",
    inputSchema: jsonSchema({ type: "object", properties: {} }),
    execute: async () => ({ output: "", title: "", metadata: {} }),
  })

describe("orchestrator turn runner", () => {
  test("chat mode runs zero workers", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionId = "session-orch-chat"
        const messageId = "msg-orch-chat"
        const features = extractFeatures({
          uxMode: "fast",
          intentText: "hello",
          hasFileParts: false,
        })
        const plan = await buildPlan({
          sessionId,
          messageId,
          features,
          toolsetFingerprint: "toolset-chat",
        }).then((res) => res.plan)

        const result = await runOrchestratorTurn({
          sessionId,
          messageId,
          abort: new AbortController().signal,
          plan,
          features,
          intentText: "hello",
          system: [],
          tools: { read: makeTool() },
        })

        const events = await EvidenceReader.readEvents(sessionId, { cursor: 0 })
        const brokerCalls = events.events.filter((event) => event.type === "tool_broker.requested")
        expect(brokerCalls.length).toBe(0)

        const manifest = await EvidenceReader.readManifest(sessionId)
        const rolePackEntries = manifest.entries.filter((entry) => entry.kind === "orchestrator-worker-role-pack")
        expect(rolePackEntries.length).toBe(0)
        expect(result.system.length).toBe(0)
      },
    })
  })

  test("assist mode runs worker + broker once and includes intent in role pack", async () => {
    const keyword = "orchestrator-keyword"
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "src"), { recursive: true })
        await Bun.write(path.join(dir, "src", "keyword.ts"), `export const keyword = "${keyword}"\n`)
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionId = "session-orch-assist"
        const messageId = "msg-orch-assist"
        const intentText = `需要引用证据 ${keyword}`
        const features = extractFeatures({
          uxMode: "auto",
          intentText,
          hasFileParts: false,
        })
        const plan = await buildPlan({
          sessionId,
          messageId,
          features,
          toolsetFingerprint: "toolset-assist",
        }).then((res) => res.plan)

        const result = await runOrchestratorTurn({
          sessionId,
          messageId,
          abort: new AbortController().signal,
          plan,
          features,
          intentText,
          system: [],
          tools: { read: makeTool() },
        })

        expect(result.system.some((line) => line.includes("<orchestrator>"))).toBe(true)

        const events = await EvidenceReader.readEvents(sessionId, { cursor: 0 })
        const brokerCalls = events.events.filter((event) => event.type === "tool_broker.requested")
        expect(brokerCalls.length).toBe(1)

        const manifest = await EvidenceReader.readManifest(sessionId)
        const rolePackEntry = manifest.entries.find((entry) => entry.kind === "orchestrator-worker-role-pack")
        expect(Boolean(rolePackEntry)).toBe(true)
        const base = tmp.path
        const rolePackPath = path.join(base, rolePackEntry!.path)
        const rolePack = await Bun.file(rolePackPath).json()
        expect(String(rolePack.planPointer).includes("intent:")).toBe(true)
        expect(String(rolePack.planPointer).includes(keyword)).toBe(true)
      },
    })
  })

  test("assist mode keeps messageId passthrough in worker lifecycle evidence", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionId = "session-orch-bind"
        const messageId = "msg-orch-bind"
        const features = extractFeatures({
          uxMode: "auto",
          intentText: "请先做高风险证据核验再回答",
          hasFileParts: false,
        })
        const plan = await buildPlan({
          sessionId,
          messageId,
          features,
          toolsetFingerprint: "toolset-bind",
        }).then((res) => res.plan)

        await runOrchestratorTurn({
          sessionId,
          messageId,
          abort: new AbortController().signal,
          plan,
          features,
          intentText: "请先做高风险证据核验再回答",
          system: [],
          tools: { read: makeTool() },
        })

        const events = await EvidenceReader.readEvents(sessionId, { cursor: 0, limit: 200 })
        const lifecycle = events.events.filter((event) => event.type === "orchestrator.worker.lifecycle")

        expect(lifecycle.length).toBeGreaterThan(0)
        expect(lifecycle.every((event) => event.data?.messageID === messageId)).toBe(true)
        expect(lifecycle.every((event) => event.data?.messageId === messageId)).toBe(true)
      },
    })
  })
})
