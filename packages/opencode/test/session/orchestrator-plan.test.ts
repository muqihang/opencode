import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { extractA1Features, extractFeatures, extractScores } from "../../src/session/orchestrator/features"
import { buildPlan } from "../../src/session/orchestrator/plan"
import { defer } from "../../src/util/defer"

describe("orchestrator plan", () => {
  const assertWriteExecRoutesToFork = async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const intentText = `请帮我修改 foo.ts 并运行测试，再给出结论与引用 ${"context ".repeat(640)}`
        const features = extractFeatures({
          uxMode: "deep",
          intentText,
          hasFileParts: false,
        })

        expect(features.features.hasWriteIntent || features.features.hasExecIntent).toBe(true)

        const result = await buildPlan({
          sessionId: "s1",
          messageId: "m1",
          features,
          scores: {
            complexity_score: 0.95,
            risk_score: 0.9,
            tool_need_score: 0.9,
          },
          toolsetFingerprint: "toolset-1",
        })

        expect(result.plan.orchestratorMode).toBe("fork")
        expect(result.plan.workers.map((item) => item.id)).toEqual(["retrieval_planner", "evidence_critic"])
        expect(result.plan.reasons.some((item) => item.code === "ux.deep.high_complexity")).toBe(false)
      },
    })
  }

  test("write exec intent routes to fork", async () => {
    await assertWriteExecRoutesToFork()
  })

  test("write or exec intent forces fork", async () => {
    await assertWriteExecRoutesToFork()
  })

  test("verification intent chooses assist", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const features = extractFeatures({
          uxMode: "auto",
          intentText: "需要引用和证据",
          hasFileParts: false,
        })

        const result = await buildPlan({
          sessionId: "s2",
          messageId: "m2",
          features,
          toolsetFingerprint: "toolset-2",
        })

        expect(result.plan.orchestratorMode).toBe("assist")
      },
    })
  })

  test("generic decision phrasing stays on assist instead of fork", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const features = extractFeatures({
          uxMode: "auto",
          intentText: "请执行一次证据优先的业务判定，输出结论与引用，不要执行命令或脚本。",
          hasFileParts: false,
        })

        const result = await buildPlan({
          sessionId: "s2_generic_decision",
          messageId: "m2_generic_decision",
          features,
          toolsetFingerprint: "toolset-2-generic-decision",
        })

        expect(result.plan.orchestratorMode).toBe("assist")
        expect(result.plan.workers.map((item) => item.id)).toEqual(["retrieval_planner", "evidence_critic"])
      },
    })
  })

  test("deep + high complexity reaches heavy with explicit reason", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const intentText = `请深度分析并制定完整方案 ${"context ".repeat(640)}`
        const features = extractFeatures({
          uxMode: "deep",
          intentText,
          hasFileParts: false,
        })

        const result = await buildPlan({
          sessionId: "s2_heavy",
          messageId: "m2_heavy",
          features,
          toolsetFingerprint: "toolset-2-heavy",
        })

        expect(result.plan.orchestratorMode).toBe("heavy")
        expect(result.plan.reasons.some((item) => item.code === "ux.deep.high_complexity")).toBe(true)
      },
    })
  })

  test("file parts can escalate write/exec intent to fork", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const intentText = "请修复我上传文件里的问题并复现结果"
        const withoutFile = extractFeatures({
          uxMode: "auto",
          intentText,
          hasFileParts: false,
        })
        const withFile = extractFeatures({
          uxMode: "auto",
          intentText,
          hasFileParts: true,
        })

        const withoutFileResult = await buildPlan({
          sessionId: "s_file_1",
          messageId: "m_file_1",
          features: withoutFile,
          toolsetFingerprint: "toolset-file-1",
        })
        const withFileResult = await buildPlan({
          sessionId: "s_file_2",
          messageId: "m_file_2",
          features: withFile,
          toolsetFingerprint: "toolset-file-2",
        })

        expect(withoutFileResult.plan.orchestratorMode).not.toBe("fork")
        expect(withFileResult.plan.orchestratorMode).toBe("fork")
        expect(withFile.features.hasWriteIntent || withFile.features.hasExecIntent).toBe(true)
      },
    })
  })

  test("score mode routing prefers scorer output over legacy thresholds", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const intentText = `请深度分析并制定完整方案 ${"context ".repeat(640)}`
        const features = extractFeatures({
          uxMode: "deep",
          intentText,
          hasFileParts: false,
        })

        const result = await buildPlan({
          sessionId: "s-score-routing-priority",
          messageId: "m-score-routing-priority",
          features,
          scores: {
            complexity_score: 0.4,
            risk_score: 0.2,
            tool_need_score: 0.2,
          },
          toolsetFingerprint: "toolset-score-routing-priority",
        })

        expect(result.plan.orchestratorMode).toBe("assist")
      },
    })
  })

  test("score mode routing falls back to legacy mode when scores are missing", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const intentText = `请深度分析并制定完整方案 ${"context ".repeat(640)}`
        const features = extractFeatures({
          uxMode: "deep",
          intentText,
          hasFileParts: false,
        })

        const scored = await buildPlan({
          sessionId: "s-score-routing-scored",
          messageId: "m-score-routing-scored",
          features,
          scores: extractScores({
            uxMode: "deep",
            intentText,
            hasFileParts: false,
          }),
          toolsetFingerprint: "toolset-score-routing-scored",
        })
        const legacy = await buildPlan({
          sessionId: "s-score-routing-legacy",
          messageId: "m-score-routing-legacy",
          features,
          toolsetFingerprint: "toolset-score-routing-legacy",
        })

        expect(scored.plan.orchestratorMode).toBe("heavy")
        expect(legacy.plan.orchestratorMode).toBe("heavy")
      },
    })
  })

  test("chat keeps workers empty", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const features = extractFeatures({
          uxMode: "fast",
          intentText: "请解释一下这个函数",
          hasFileParts: false,
        })

        const result = await buildPlan({
          sessionId: "s3",
          messageId: "m3",
          features,
          toolsetFingerprint: "toolset-3",
        })

        expect(result.plan.orchestratorMode).toBe("chat")
        expect(result.plan.workers.length).toBe(0)
      },
    })
  })

  test("chat and fork stay outside rerun breaker semantics", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const chatFeatures = extractFeatures({
          uxMode: "fast",
          intentText: "请解释一下这个函数",
          hasFileParts: false,
        })
        const forkFeatures = extractFeatures({
          uxMode: "auto",
          intentText: "请修改 foo.ts 并执行测试，附上结果",
          hasFileParts: false,
        })
        const rounds = ["1", "2", "3", "4"]

        const chat = await Promise.all(
          rounds.map(() =>
            buildPlan({
              sessionId: "s-non-worker-chat",
              messageId: "m-non-worker-chat",
              features: chatFeatures,
              toolsetFingerprint: "toolset-non-worker-chat",
            }).then((item) => item.plan),
          ),
        )
        const fork = await Promise.all(
          rounds.map(() =>
            buildPlan({
              sessionId: "s-non-worker-fork",
              messageId: "m-non-worker-fork",
              features: forkFeatures,
              toolsetFingerprint: "toolset-non-worker-fork",
            }).then((item) => item.plan),
          ),
        )

        expect(chat.every((item) => item.orchestratorMode === "chat")).toBe(true)
        expect(fork.every((item) => item.orchestratorMode === "fork")).toBe(true)
        expect(chat.some((item) => item.reasons.some((reason) => reason.code === "adaptive.ttc.max_rerun.stop"))).toBe(false)
        expect(fork.some((item) => item.reasons.some((reason) => reason.code === "adaptive.ttc.max_rerun.stop"))).toBe(false)
      },
    })
  })

  test("worker timeout default is extended for v1.6 workers", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const features = extractFeatures({
          uxMode: "auto",
          intentText: "需要引用和证据",
          hasFileParts: false,
        })

        const result = await buildPlan({
          sessionId: "s-timeout-default",
          messageId: "m-timeout-default",
          features,
          toolsetFingerprint: "toolset-timeout-default",
        })

        expect(result.plan.orchestratorMode).toBe("assist")
        expect(result.plan.budgets.workerTimeoutMs).toBe(12000)
        expect(result.plan.workers.map((item) => item.budget.timeoutMs)).toEqual([12000, 12000])
      },
    })
  })

  test("worker timeout can be overridden from config experimental", async () => {
    await using fixture = await tmpdir({
      git: true,
      config: {
        experimental: {
          orchestrator_worker_timeout_ms: 21000,
        },
      },
    })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const features = extractFeatures({
          uxMode: "auto",
          intentText: "需要引用和证据",
          hasFileParts: false,
        })

        const result = await buildPlan({
          sessionId: "s-timeout-override",
          messageId: "m-timeout-override",
          features,
          toolsetFingerprint: "toolset-timeout-override",
        })

        expect(result.plan.orchestratorMode).toBe("assist")
        expect(result.plan.budgets.workerTimeoutMs).toBe(21000)
        expect(result.plan.workers.map((item) => item.budget.timeoutMs)).toEqual([21000, 21000])
      },
    })
  })

  test("inputsFingerprint is stable", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const features = extractFeatures({
          uxMode: "auto",
          intentText: "解释一下这个函数",
          hasFileParts: false,
        })

        const first = await buildPlan({
          sessionId: "s4",
          messageId: "m4",
          features,
          toolsetFingerprint: "toolset-4",
        })
        const second = await buildPlan({
          sessionId: "s4",
          messageId: "m4",
          features,
          toolsetFingerprint: "toolset-4",
        })

        expect(first.plan.inputsFingerprint.sha256).toBe(second.plan.inputsFingerprint.sha256)
      },
    })
  })

  test("cache hit on second call", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const prev = process.env["OPENCODE_DISABLE_CACHE_STORE"]
        process.env["OPENCODE_DISABLE_CACHE_STORE"] = "0"
        using _ = defer(() => {
          if (prev === undefined) delete process.env["OPENCODE_DISABLE_CACHE_STORE"]
          if (prev !== undefined) process.env["OPENCODE_DISABLE_CACHE_STORE"] = prev
        })

        const features = extractFeatures({
          uxMode: "auto",
          intentText: "解释一下这个函数",
          hasFileParts: false,
        })

        const first = await buildPlan({
          sessionId: "s5",
          messageId: "m5",
          features,
          toolsetFingerprint: "toolset-5",
        })
        const second = await buildPlan({
          sessionId: "s5",
          messageId: "m5",
          features,
          toolsetFingerprint: "toolset-5",
        })

        expect(first.cache.status).not.toBe("hit")
        expect(second.cache.status).toBe("hit")
      },
    })
  })

  test("high-risk citation candidate enables dual-pass by default", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const intentText = "请依据法律条款给出结论并提供可核验引用"
        const features = extractFeatures({
          uxMode: "auto",
          intentText,
          hasFileParts: false,
        })
        const a1 = extractA1Features({ intentText, hasFileParts: false })

        const result = await buildPlan({
          sessionId: "s6",
          messageId: "m6",
          features,
          toolsetFingerprint: "toolset-6",
          a1,
          dualPassSynthesis: true,
        })

        expect(result.plan.dualPass?.enabled).toBe(true)
      },
    })
  })

  test("non-candidate request keeps dual-pass disabled", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const intentText = "请解释这段代码在做什么"
        const features = extractFeatures({
          uxMode: "auto",
          intentText,
          hasFileParts: false,
        })
        const a1 = extractA1Features({ intentText, hasFileParts: false })

        const result = await buildPlan({
          sessionId: "s7",
          messageId: "m7",
          features,
          toolsetFingerprint: "toolset-7",
          a1,
          dualPassSynthesis: true,
        })

        expect(result.plan.dualPass).toBeUndefined()
      },
    })
  })

  test("dual-pass stays off when synthesis gate is closed", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const intentText = "请依据法律条款给出结论并提供可核验引用"
        const features = extractFeatures({
          uxMode: "auto",
          intentText,
          hasFileParts: false,
        })
        const a1 = extractA1Features({ intentText, hasFileParts: false })

        const result = await buildPlan({
          sessionId: "s8",
          messageId: "m8",
          features,
          toolsetFingerprint: "toolset-8",
          a1,
          dualPassSynthesis: false,
        })

        expect(result.plan.dualPass).toBeUndefined()
      },
    })
  })
})
