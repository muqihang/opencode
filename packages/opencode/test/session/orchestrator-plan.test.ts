import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { extractFeatures } from "../../src/session/orchestrator/features"
import { buildPlan } from "../../src/session/orchestrator/plan"
import { defer } from "../../src/util/defer"

describe("orchestrator plan", () => {
  test("write or exec intent forces fork", async () => {
    await using fixture = await tmpdir({ git: true })
    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const features = extractFeatures({
          uxMode: "fast",
          intentText: "请帮我修改 foo.ts 并运行测试",
          hasFileParts: false,
        })

        const result = await buildPlan({
          sessionId: "s1",
          messageId: "m1",
          features,
          toolsetFingerprint: "toolset-1",
        })

        expect(result.plan.orchestratorMode).toBe("fork")
      },
    })
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
})
