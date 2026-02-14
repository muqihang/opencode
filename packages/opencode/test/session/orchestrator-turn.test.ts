import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { EvidenceReader } from "../../src/evidence/reader"
import { extractFeatures } from "../../src/session/orchestrator/features"
import { buildPlan } from "../../src/session/orchestrator/plan"
import { runOrchestratorTurn } from "../../src/session/orchestrator"
import { writeOrchestratorArtifacts } from "../../src/session/orchestrator/writer"
import { enforceReferenceCheckPolicy } from "../../src/session/processor"
import type { Tool } from "ai"
import { tool, jsonSchema } from "ai"

const A2_FLAG = "OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V15_A2"

const withA2 = async (value: string | undefined, fn: () => Promise<void>) => {
  const prev = process.env[A2_FLAG]
  if (value === undefined) {
    delete process.env[A2_FLAG]
  }
  if (value !== undefined) {
    process.env[A2_FLAG] = value
  }

  return Promise.resolve(fn()).finally(() => {
    if (prev === undefined) {
      delete process.env[A2_FLAG]
      return
    }
    process.env[A2_FLAG] = prev
  })
}

const makeTool = (): Tool =>
  tool({
    description: "test tool",
    inputSchema: jsonSchema({ type: "object", properties: {} }),
    execute: async () => ({ output: "", title: "", metadata: {} }),
  })

describe("orchestrator turn runner", () => {
  test("verification intent injects reference-check policy even when workers are disabled", () => {
    const system = enforceReferenceCheckPolicy({
      system: ["base"],
      orchestratorEnabled: true,
      hasVerificationIntent: true,
      workerCount: 0,
    })
    const text = system.join("\n")

    expect(text.includes("事实必须给 file:line 引用")).toBe(true)
    expect(text.includes("无证据必须 unknown/evidence_insufficient")).toBe(true)
  })

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
      config: {
        experimental: {
          orchestrator_worker_timeout_ms: 2000,
        },
      },
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

        const injected = result.system.some((line) => line.includes("<orchestrator>"))
        const degradedFallback = result.degraded && result.system.includes("unknown-first")
        expect(injected || degradedFallback).toBe(true)

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
  }, 30000)

  test("assist mode keeps messageId passthrough in worker lifecycle evidence", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        experimental: {
          orchestrator_worker_timeout_ms: 2000,
        },
      },
    })
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
  }, 15000)

  test("tenant namespaced plan pointer and plan meta are injected into role pack", async () => {
    await withA2("1", async () => {
      await using tmp = await tmpdir({
        git: true,
        config: {
          experimental: {
            orchestrator_worker_timeout_ms: 2000,
          },
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const sessionId = "session-orch-a2"
          const messageId = "msg-orch-a2"
          const features = extractFeatures({
            uxMode: "auto",
            intentText: "需要引用证据并判定风险",
            hasFileParts: false,
          })
          const plan = await buildPlan({
            sessionId,
            messageId,
            features,
            toolsetFingerprint: "toolset-a2",
          }).then((res) => res.plan)

          await writeOrchestratorArtifacts({
            sessionId,
            plan,
            features,
          })

          await runOrchestratorTurn({
            sessionId,
            messageId,
            abort: new AbortController().signal,
            plan,
            features,
            intentText: "需要引用证据并判定风险",
            system: [],
            tools: { read: makeTool() },
          })

          const manifest = await EvidenceReader.readManifest(sessionId)
          const rolePackEntry = manifest.entries.find(
            (entry) =>
              entry.kind === "orchestrator-worker-role-pack" &&
              entry.path.includes(`${plan.orchestratorPlanId}/workers/`) &&
              entry.path.endsWith("/role-pack.json"),
          )
          expect(Boolean(rolePackEntry)).toBe(true)

          const rolePackPath = path.join(tmp.path, rolePackEntry!.path)
          const rolePack = await Bun.file(rolePackPath).json()
          const planPointer = String(rolePack.planPointer)

          expect(planPointer.includes(`.opencode/artifacts/local/default/${sessionId}/orchestrator/${plan.orchestratorPlanId}/orchestrator.plan.json`)).toBe(true)
          expect(planPointer.includes("plan_meta:")).toBe(true)

          const events = await EvidenceReader.readEvents(sessionId, { cursor: 0 })
          const planned = events.events.find(
            (event) => event.type === "orchestrator.planned" && event.data?.["messageId"] === messageId,
          )
          expect(Boolean(planned)).toBe(true)
          expect(planned?.data?.["specVersion"]).toBe("progress-ledger/1.0")
          expect(typeof planned?.data?.["cycle"]).toBe("number")
          expect(typeof planned?.data?.["coverageGain"]).toBe("number")
          expect(typeof planned?.data?.["newEvidenceCount"]).toBe("number")
          expect(typeof planned?.data?.["duplicateProbeRate"]).toBe("number")
          expect(["continue", "stop"].includes(String(planned?.data?.["decision"] ?? ""))).toBe(true)
          expect(typeof planned?.data?.["stopReason"]).toBe("string")
          expect(typeof planned?.data?.["evidence_gain_per_cycle"]).toBe("number")
        },
      })
    })
  }, 15000)

  test("same session/message/plan reuses orchestrator turn result without rerunning broker", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        experimental: {
          orchestrator_worker_timeout_ms: 2000,
        },
      },
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "src"), { recursive: true })
        await Bun.write(path.join(dir, "src", "cache-me.ts"), "export const cache = true\n")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionId = "session-orch-cache"
        const messageId = "msg-orch-cache"
        const features = extractFeatures({
          uxMode: "auto",
          intentText: "请检索 cache-me.ts 并给出证据引用",
          hasFileParts: false,
        })
        const plan = await buildPlan({
          sessionId,
          messageId,
          features,
          toolsetFingerprint: "toolset-cache",
        }).then((res) => res.plan)

        const input = {
          sessionId,
          messageId,
          abort: new AbortController().signal,
          plan,
          features,
          intentText: "请检索 cache-me.ts 并给出证据引用",
          system: [],
          tools: { read: makeTool() },
        }

        await runOrchestratorTurn(input)
        await runOrchestratorTurn(input)

        const events = await EvidenceReader.readEvents(sessionId, { cursor: 0 })
        const brokerCalls = events.events.filter((event) => event.type === "tool_broker.requested")
        expect(brokerCalls.length).toBe(1)
      },
    })
  }, 30000)
})
