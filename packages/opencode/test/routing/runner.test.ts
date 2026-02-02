import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { RoutingRunner } from "../../src/routing/runner"
import { RoutingRunRequest } from "../../src/protocol/routing-run-request"
import { RoutingWorkerResult } from "../../src/protocol/routing-worker-result"
import { resolveRoutingConfig } from "../../src/routing/config"
import { routingConfigFingerprint } from "../../src/routing/cache"

describe("routing.runner", () => {
  test("writes routing artifacts and strict protocol results", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "src"), { recursive: true })
        await Bun.write(path.join(dir, "src", "alpha.ts"), "export const alpha = 1\n")
        await Bun.write(path.join(dir, "src", "beta.ts"), "export const beta = 2\n")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const run = await RoutingRunner.run({
          sessionId: "session_test",
          messageId: "message_test",
          intentText: "Check routing",
          tier: "plan",
        })

        const base = path.join(
          Instance.worktree,
          ".opencode",
          "artifacts",
          "session_test",
          "routing",
          run.routingRunId,
        )
        const requestPath = path.join(base, "request.json")
        const workerAPath = path.join(base, "worker-a.result.json")
        const workerBPath = path.join(base, "worker-b.result.json")
        const workerCPath = path.join(base, "worker-c.result.json")
        const capsulePath = path.join(base, "routing.capsule.md")

        expect(await Bun.file(requestPath).exists()).toBe(true)
        expect(await Bun.file(workerAPath).exists()).toBe(true)
        expect(await Bun.file(workerBPath).exists()).toBe(true)
        expect(await Bun.file(workerCPath).exists()).toBe(true)
        expect(await Bun.file(capsulePath).exists()).toBe(true)

        const request = RoutingRunRequest.parse(await Bun.file(requestPath).json())
        expect(request.intent.text).toBe("Check routing")
        expect(request.sessionId).toBe("session_test")

        const workerA = RoutingWorkerResult.parse(await Bun.file(workerAPath).json())
        const workerB = RoutingWorkerResult.parse(await Bun.file(workerBPath).json())
        const workerC = RoutingWorkerResult.parse(await Bun.file(workerCPath).json())

        expect(workerA.workerId).toBe("worker_a_repo")
        expect(workerB.workerId).toBe("worker_b_kb")
        expect(workerC.workerId).toBe("worker_c_graph")
      },
    })
  })

  test("routing config defaults and overrides are stable", () => {
    const base = resolveRoutingConfig()
    expect(base.maxWallClockMs).toBe(15000)
    expect(base.workerTimeoutMs).toBe(8000)
    expect(base.topK).toBe(20)

    const override = resolveRoutingConfig({
      workerTimeoutMs: 7000,
      workers: {
        worker_a_repo: {
          topK: 5,
        },
      },
    })

    expect(override.workerTimeoutMs).toBe(7000)
    expect(override.workers.worker_a_repo.topK).toBe(5)

    const first = routingConfigFingerprint(override)
    const second = routingConfigFingerprint(override)
    expect(first).toBe(second)
  })

  test("cache hit writes evidence artifacts", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "src"), { recursive: true })
        await Bun.write(path.join(dir, "src", "cache.ts"), "export const cache = true\n")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await RoutingRunner.run({
          sessionId: "session_cache",
          messageId: "message_cache",
          intentText: "Cache test",
          tier: "plan",
        })

        const second = await RoutingRunner.run({
          sessionId: "session_cache",
          messageId: "message_cache_2",
          intentText: "Cache test",
          tier: "plan",
        })

        const base = path.join(
          Instance.worktree,
          ".opencode",
          "artifacts",
          "session_cache",
          "routing",
          second.routingRunId,
        )
        const requestPath = path.join(base, "request.json")
        const workerAPath = path.join(base, "worker-a.result.json")
        const workerBPath = path.join(base, "worker-b.result.json")
        const workerCPath = path.join(base, "worker-c.result.json")
        const capsulePath = path.join(base, "routing.capsule.md")

        expect(await Bun.file(requestPath).exists()).toBe(true)
        expect(await Bun.file(workerAPath).exists()).toBe(true)
        expect(await Bun.file(workerBPath).exists()).toBe(true)
        expect(await Bun.file(workerCPath).exists()).toBe(true)
        expect(await Bun.file(capsulePath).exists()).toBe(true)

        const workerA = RoutingWorkerResult.parse(await Bun.file(workerAPath).json())
        const workerB = RoutingWorkerResult.parse(await Bun.file(workerBPath).json())
        const workerC = RoutingWorkerResult.parse(await Bun.file(workerCPath).json())

        expect(workerA.cache.hit).toBe(true)
        expect(workerA.cache.reason).toBe("exact_match")
        expect(workerB.cache.hit).toBe(true)
        expect(workerB.cache.reason).toBe("exact_match")
        expect(workerC.cache.hit).toBe(true)
        expect(workerC.cache.reason).toBe("exact_match")
      },
    })
  })

  test("superseded run writes routing.cancelled event", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "src"), { recursive: true })
        for (const idx of Array.from({ length: 3000 }).keys()) {
          await Bun.write(path.join(dir, "src", `file-${idx}.ts`), `export const n${idx} = ${idx}\n`)
        }
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const first = RoutingRunner.run({
          sessionId: "session_cancel",
          messageId: "message_first",
          intentText: "Cancel test",
          tier: "plan",
        })

        const second = await RoutingRunner.run({
          sessionId: "session_cancel",
          messageId: "message_second",
          intentText: "Cancel test",
          tier: "plan",
        })

        const firstRun = await first
        const base = path.join(
          Instance.worktree,
          ".opencode",
          "evidence",
          "session_cancel",
          "events.jsonl",
        )
        const lines = (await Bun.file(base).text())
          .trim()
          .split("\n")
          .filter((line) => line.trim())
        const events = lines.map((line) => JSON.parse(line))
        const match = events.find(
          (item) => item.type === "routing.cancelled" && item.data?.newRunId === second.routingRunId,
        )
        expect(match?.data?.previousRunId).toBe(firstRun.routingRunId)
        expect(match?.data?.newRunId).toBe(second.routingRunId)
        expect(match?.data?.reason).toBe("superseded")
      },
    })
  })

  test("max wall clock writes routing.timeout and routing.completed", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "src"), { recursive: true })
        for (const idx of Array.from({ length: 5000 }).keys()) {
          await Bun.write(path.join(dir, "src", `slow-${idx}.ts`), `export const n${idx} = ${idx}\n`)
        }
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const run = await RoutingRunner.run({
          sessionId: "session_timeout",
          messageId: "message_timeout",
          intentText: "Timeout test",
          tier: "plan",
          config: {
            maxWallClockMs: 5,
            workerTimeoutMs: 5,
          },
        })

        const base = path.join(
          Instance.worktree,
          ".opencode",
          "evidence",
          "session_timeout",
          "events.jsonl",
        )
        const lines = (await Bun.file(base).text())
          .trim()
          .split("\n")
          .filter((line) => line.trim())
        const events = lines.map((line) => JSON.parse(line))
        const timeoutEvent = events.find((item) => item.type === "routing.timeout")
        const completedEvent = events.find((item) => item.type === "routing.completed")
        expect(timeoutEvent?.data?.routingRunId).toBe(run.routingRunId)
        expect(Array.isArray(timeoutEvent?.data?.cancelledWorkers)).toBe(true)
        expect(completedEvent?.data?.routingRunId).toBe(run.routingRunId)
      },
    })
  })

  test("non-git projects write routing cache under directory (not /)", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "src"), { recursive: true })
        await Bun.write(path.join(dir, "src", "alpha.ts"), "export const alpha = 1\n")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const run = await RoutingRunner.run({
          sessionId: "session_non_git",
          messageId: "message_non_git",
          intentText: "Check routing",
          tier: "plan",
          config: {
            workers: {
              worker_a_repo: { enabled: false },
            },
          },
        })

        expect(run.routingRunId).toBeTruthy()
        const cacheDir = path.join(tmp.path, ".opencode", "cache", "routing")
        const glob = new Bun.Glob("*.json")
        const hits: string[] = []
        for await (const item of glob.scan({ cwd: cacheDir, onlyFiles: true })) {
          hits.push(item)
        }
        expect(hits.length).toBeGreaterThan(0)
      },
    })
  })
})
