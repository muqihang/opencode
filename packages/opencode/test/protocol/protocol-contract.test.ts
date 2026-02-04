import { describe, expect, test } from "bun:test"

import { RoutingRunRequest } from "../../src/protocol/routing-run-request"
import { RoutingWorkerResult } from "../../src/protocol/routing-worker-result"
import { ContextPack } from "../../src/protocol/context-pack"
import { OrchestratorPlan } from "../../src/protocol/orchestrator-plan"
import { OrchestratorFeatures } from "../../src/protocol/orchestrator-features"
import { LlmWorkerRolePack } from "../../src/protocol/llm-worker-role-pack"
import { LlmWorkerResult } from "../../src/protocol/llm-worker-result"
import { ToolBroker } from "../../src/protocol/tool-broker"

describe("protocol.contracts", () => {
  test("routing-run-request fixture parses and is strict", () => {
    const fixture = {
      specVersion: "routing-run-request/1.0",
      routingRunId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      sessionId: "session_01ARZ3NDEKTSV4RRFFQ69G5FAV",
      messageId: "message_01ARZ3NDEKTSV4RRFFQ69G5FAV",
      tier: "limited",
      intent: {
        text: "Find the relevant files and explain the impact",
        normalized: "Find the relevant files and explain the impact",
        fingerprint: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      project: {
        projectId: "project_01ARZ3NDEKTSV4RRFFQ69G5FAV",
        worktreeRoot: "/repo",
      },
      repo: {
        vcs: "git",
        head: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        dirty: true,
        diffFingerprint: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      },
      budgets: {
        maxWallClockMs: 15_000,
        workerTimeoutMs: 8_000,
        topK: 20,
      },
      workers: {
        worker_a_repo: { enabled: true, topK: 20 },
        worker_b_kb: { enabled: true, topK: 20 },
        worker_c_graph: { enabled: true, topK: 20 },
      },
      versions: {
        routingTemplate: "v1",
        capsuleSchema: "v1",
        workerSchemas: "v1",
      },
    } as const

    expect(RoutingRunRequest.parse(fixture)).toMatchObject(fixture)
    expect(() => RoutingRunRequest.parse({ ...fixture, extra: "nope" })).toThrow()
  })

  test("routing-worker-result fixture parses and is strict", () => {
    const fixture = {
      specVersion: "routing-worker-result/1.0",
      routingRunId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      sessionId: "session_01ARZ3NDEKTSV4RRFFQ69G5FAV",
      workerId: "worker_a_repo",
      status: "ok",
      cache: {
        hit: false,
        key: "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
        scope: "worktree",
        reason: "exact_match",
      },
      timing: {
        startedAtUtc: "2026-01-25T00:00:00.000Z",
        endedAtUtc: "2026-01-25T00:00:01.234Z",
        durationMs: 1234,
      },
      inputs: {
        intentFingerprint: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        repoFingerprint: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        configFingerprint: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      },
      result: {
        kind: "repo-lsp",
        files: [
          {
            path: "packages/opencode/src/tool/task.ts",
            reason: "subagent orchestration entrypoint",
            score: 0.93,
            symbols: [{ name: "TaskTool", kind: "const", location: { line: 1, col: 1 } }],
          },
        ],
        snippets: [
          {
            path: ".opencode/artifacts/session/routing/run/snippets/task.ts#L1",
            sha256: "1111111111111111111111111111111111111111111111111111111111111111",
            why: "shows session creation + permission defaults",
          },
        ],
      },
      capsule: {
        handoff: "Relevant file: packages/opencode/src/tool/task.ts",
        pointers: [
          { kind: "file", ref: "packages/opencode/src/tool/task.ts", label: "Task tool" },
          { kind: "artifact", ref: ".opencode/artifacts/session/routing/run/worker-a.result.json" },
        ],
        openQuestions: [],
      },
      errors: [],
    } as const

    expect(RoutingWorkerResult.parse(fixture)).toMatchObject(fixture)
    expect(() => RoutingWorkerResult.parse({ ...fixture, extra: "nope" })).toThrow()
  })

  test("context-pack fixture parses and is strict", () => {
    const fixture = {
      specVersion: "context-pack/1.0",
      contextPackId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      sessionId: "session_01ARZ3NDEKTSV4RRFFQ69G5FAV",
      messageId: "message_01ARZ3NDEKTSV4RRFFQ69G5FAV",
      createdAtUtc: "2026-01-25T00:00:00.000Z",
      model: { providerId: "openai", modelId: "gpt-5.2" },
      window: { maxTokens: 128000, budgetTokens: 60000 },
      tokenEstimate: { method: "approx", version: "v1" },
      versions: { systemTemplate: "v1", toolsTemplate: "v1", capsuleSchema: "v1", stableJson: "v1" },
      ledger: { mode: "full" },
      segments: [
        {
          id: "seg:capsule",
          kind: "capsule",
          priority: "p0",
          tokenEstimate: 512,
          sources: [{ kind: "artifact", ref: ".opencode/evidence/session/manifest.json" }],
        },
      ],
      totals: { segments: 1, tokenEstimate: 512 },
    } as const

    expect(ContextPack.parse(fixture)).toMatchObject(fixture)
    expect(() => ContextPack.parse({ ...fixture, extra: "nope" })).toThrow()
  })

  test("orchestrator-plan fixture parses and is strict", () => {
    const fixture = {
      specVersion: "orchestrator-plan/1.0",
      orchestratorPlanId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      sessionId: "session_01ARZ3NDEKTSV4RRFFQ69G5FAV",
      messageId: "message_01ARZ3NDEKTSV4RRFFQ69G5FAV",
      orchestratorMode: "assist",
      uxMode: "auto",
      mainTools: ["read", "grep"],
      workers: [{ id: "worker_retrieval", model: "small", budget: { timeoutMs: 8000 } }],
      budgets: {
        maxWallClockMs: 20_000,
        workerTimeoutMs: 10_000,
        maxOutputTokens: 900,
        maxToolCalls: 6,
      },
      evidencePolicy: { enabled: true, mode: "balanced" },
      toolPolicy: { allowed: ["retrieval", "verification"], bounceMax: 1 },
      reasons: [{ code: "needs_retrieval", message: "Requires citations for claims." }],
      inputsFingerprint: { sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    } as const

    expect(OrchestratorPlan.parse(fixture)).toMatchObject(fixture)
    expect(() => OrchestratorPlan.parse({ ...fixture, extra: "nope" })).toThrow()
  })

  test("orchestrator-features fixture parses and is strict", () => {
    const fixture = {
      specVersion: "orchestrator-features/1.0",
      features: {
        uxMode: "auto",
        intentBytes: 256,
        intentTokensEstimate: 64,
        hasFileParts: false,
        hasWriteIntent: true,
        hasExecIntent: false,
        hasVerificationIntent: true,
        parentSessionId: "session_01ARZ3NDEKTSV4RRFFQ69G5FAV",
      },
    } as const

    expect(OrchestratorFeatures.parse(fixture)).toMatchObject(fixture)
    expect(() => OrchestratorFeatures.parse({ ...fixture, extra: "nope" })).toThrow()
  })

  test("llm-worker-role-pack fixture parses and is strict", () => {
    const fixture = {
      specVersion: "llm-worker-role-pack/1.0",
      planPointer: ".opencode/artifacts/session/orchestrator/orchestrator.plan.json",
      policy: { mode: "balanced", unknown: "deny" },
      budget: { timeoutMs: 5000, maxOutputTokens: 800, maxToolCalls: 2 },
      workingSet: {
        pointers: [
          {
            kind: "artifact",
            ref: ".opencode/artifacts/session/retrieval/worker.result.json",
            label: "retrieval result",
          },
          "packages/opencode/src/session/processor.ts",
        ],
      },
    } as const

    expect(LlmWorkerRolePack.parse(fixture)).toMatchObject(fixture)
    expect(() => LlmWorkerRolePack.parse({ ...fixture, extra: "nope" })).toThrow()
  })

  test("llm-worker-result fixture parses and is strict", () => {
    const fixture = {
      specVersion: "llm-worker-result/1.0",
      status: "ok",
      toolRequests: [
        { kind: "retrieval", input: "orchestrator plan schema" },
        { kind: "verification", input: "check citations for manifest pointers" },
      ],
      notes: ["Return pointers only."],
    } as const

    expect(LlmWorkerResult.parse(fixture)).toMatchObject(fixture)
    expect(() => LlmWorkerResult.parse({ ...fixture, extra: "nope" })).toThrow()
  })

  test("tool-broker fixture parses and is strict", () => {
    const fixture = {
      specVersion: "tool-broker/1.0",
      toolRequests: [{ kind: "retrieval", input: "find orchestrator-plan docs" }],
    } as const

    expect(ToolBroker.parse(fixture)).toMatchObject(fixture)
    expect(() => ToolBroker.parse({ ...fixture, extra: "nope" })).toThrow()
  })
})
