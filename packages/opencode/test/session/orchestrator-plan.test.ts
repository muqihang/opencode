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
