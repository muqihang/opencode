import { describe, expect, test } from "bun:test"
import { LlmWorkerRolePack } from "../../src/protocol/llm-worker-role-pack"
import { CriticVerdictV2, criticVerdictV1FromV2, criticVerdictV2FromV1 } from "../../src/protocol/llm-worker-result"
import { buildWorkerSystemPrompt, WorkerPromptRegistry } from "../../src/session/orchestrator/workers/prompt-registry"
import { evidenceCritic } from "../../src/session/orchestrator/workers/evidence-critic"
import { runStructured } from "../../src/session/orchestrator/worker-llm"
import { stableJson } from "../../src/util/stable-json"

const pack = (input: { pointers: string[]; maxToolCalls?: number; maxOutputTokens?: number }) =>
  LlmWorkerRolePack.parse({
    specVersion: "llm-worker-role-pack/1.0",
    planPointer: "orchestrator/plan-evidence/plan.json",
    policy: { mode: "balanced", unknown: "allow" },
    budget: {
      timeoutMs: 900,
      maxOutputTokens: input.maxOutputTokens ?? 256,
      maxToolCalls: input.maxToolCalls ?? 4,
    },
    workingSet: { pointers: input.pointers },
  })

const verdictFixture = (query: string) => ({
  specVersion: "critic-verdict/2.0" as const,
  status: "insufficient" as const,
  coverage: [{ requirementId: "req_rule_1", evidenceIds: ["E1"], pass: true }],
  missing: [{ requirementId: "req_fact_2", reason: "missing rule quote", suggestedQuery: query }],
  conflicts: [{ left: "E3", right: "E9", reason: "same symbol different semantics" }],
  confidence: 0.78,
  retry: {
    allowed: true,
    newQueries: [query],
    stopReason: "coverage_below_threshold",
  },
})

describe("orchestrator evidence_critic", () => {
  test("critic verdict v2 fixture keeps fields and supports v1/v2 downgrade", () => {
    const fixture = verdictFixture("cross-check policy evidence")
    const parsed = CriticVerdictV2.parse(fixture)
    const replay = CriticVerdictV2.parse(JSON.parse(stableJson(parsed)))

    expect(replay).toEqual(fixture)

    const downgraded = criticVerdictV1FromV2(parsed)
    expect(downgraded.status).toBe("degraded")
    expect(downgraded.toolRequests?.[0]).toEqual({
      kind: "retrieval",
      input: "cross-check policy evidence",
    })

    const upgraded = criticVerdictV2FromV1(downgraded)
    expect(upgraded.specVersion).toBe("critic-verdict/2.0")
    expect(upgraded.retry.allowed).toBe(true)
    expect(upgraded.retry.newQueries).toEqual(["cross-check policy evidence"])
  })

  test("evidence critic accepts critic-verdict v2 and degrades by retry queries", async () => {
    const rolePack = pack({ pointers: ["ptr-1"], maxToolCalls: 2 })
    const result = await evidenceCritic(
      { rolePack },
      {
        run: (async () => ({
          status: "ok" as const,
          object: verdictFixture("cross-check policy evidence"),
        })) as typeof runStructured,
      },
    )

    expect(result.status).toBe("degraded")
    expect(result.toolRequests?.[0]).toEqual({
      kind: "retrieval",
      input: "cross-check policy evidence",
    })
    expect(result.notes?.some((item) => item.includes("coverage_below_threshold"))).toBe(true)
  })

  test("evidence critic prompt template is versioned and registry-driven", async () => {
    const rolePack = pack({ pointers: ["ptr-1"] })
    const seen: string[] = []
    const result = await evidenceCritic(
      { rolePack },
      {
        run: (async (req) => {
          const data = req as { messages: Array<{ role: string; content: string }> }
          const system = data.messages.find((item) => item.role === "system")
          seen.push(system?.content ?? "")

          return {
            status: "ok" as const,
            object: {
              status: "ok" as const,
              notes: ["evidence looks enough"],
            },
          }
        }) as typeof runStructured,
      },
    )

    expect(result.status).toBe("ok")
    expect(WorkerPromptRegistry.evidence_critic.version).toBe("v1")
    expect(seen[0]).toBe(buildWorkerSystemPrompt("evidence_critic"))
    expect(seen[0]).toContain("template_version=v1")
  })

  test("empty pointers force retrieval request", async () => {
    let hits = 0
    const rolePack = pack({ pointers: [] })
    const result = await evidenceCritic(
      { rolePack },
      {
        run: (async () => {
          hits += 1
          return {
            status: "ok" as const,
            object: {
              status: "ok" as const,
              notes: ["worker note"],
            },
          }
        }) as typeof runStructured,
      },
    )

    expect(hits).toBe(1)
    expect(result.toolRequests?.some((item) => item.kind === "retrieval")).toBe(true)
  })

  test("non-empty pointers do not force retrieval", async () => {
    const rolePack = pack({ pointers: ["ptr-1"] })
    const result = await evidenceCritic(
      { rolePack },
      {
        run: (async () => ({
          status: "ok" as const,
          object: {
            status: "ok" as const,
            notes: ["evidence looks enough"],
          },
        })) as typeof runStructured,
      },
    )

    expect(result.status).toBe("ok")
    expect(result.toolRequests ?? []).toHaveLength(0)
  })

  test("model failure degrades without throwing", async () => {
    const rolePack = pack({ pointers: ["ptr-1"] })
    const result = await evidenceCritic(
      { rolePack },
      {
        run: (async () => ({
          status: "degraded",
          reason: "timeout",
          object: {
            status: "degraded" as const,
            notes: ["worker degraded: timeout"],
          },
        })) as typeof runStructured,
      },
    )

    expect(result.status).toBe("degraded")
    expect(result.notes?.[0]?.includes("timeout")).toBe(true)
  })

  test("tool requests are bounded by budget", async () => {
    const rolePack = pack({ pointers: ["ptr-1"], maxToolCalls: 1 })
    const result = await evidenceCritic(
      { rolePack },
      {
        run: (async () => ({
          status: "ok" as const,
          object: {
            status: "ok" as const,
            toolRequests: [
              { kind: "verification" as const, input: "check-a" },
              { kind: "retrieval" as const, input: "check-b" },
            ],
          },
        })) as typeof runStructured,
      },
    )

    expect(result.toolRequests?.length).toBe(1)
  })


  test("verification requests are normalized to retrieval for broker compatibility", async () => {
    const rolePack = pack({ pointers: ["ptr-1"], maxToolCalls: 2 })
    const result = await evidenceCritic(
      { rolePack },
      {
        run: (async () => ({
          status: "ok" as const,
          object: {
            status: "ok" as const,
            toolRequests: [{ kind: "verification" as const, input: "cross-check policy evidence" }],
          },
        })) as typeof runStructured,
      },
    )

    expect(result.toolRequests?.map((item) => item.kind)).toEqual(["retrieval"])
  })

  test("worker permissions stay no-write/no-exec/no-ask after llm degradation", async () => {
    const rolePack = pack({ pointers: ["ptr-1"] })
    const result = await evidenceCritic(
      { rolePack },
      {
        run: (async () => ({
          status: "degraded",
          reason: "error",
          object: {
            status: "degraded" as const,
            notes: [
              "worker degraded: error",
              "from_model=openai/gpt-5",
              "to_model=opencode/gpt-5-nano",
              "gate_reason=error_degraded",
            ],
            toolRequests: [{ kind: "retrieval" as const, input: "safe" }],
          },
        })) as typeof runStructured,
      },
    )

    const kinds = (result.toolRequests ?? []).map((item) => item.kind)
    expect(kinds.includes("retrieval") || kinds.includes("verification")).toBe(true)
    expect(result.notes?.some((item) => item.includes("gate_reason="))).toBe(true)
  })
})
