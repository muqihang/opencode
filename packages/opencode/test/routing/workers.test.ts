import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { WorkerA } from "../../src/routing/worker-a"
import { WorkerB } from "../../src/routing/worker-b"
import { WorkerC } from "../../src/routing/worker-c"

describe("routing.workers", () => {
  test("worker a returns deterministic file list", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "src"), { recursive: true })
        await Bun.write(path.join(dir, "src", "zeta.ts"), "export const zeta = 1\n")
        await Bun.write(path.join(dir, "src", "alpha.ts"), "export const alpha = 2\n")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await WorkerA.run({
          root: Instance.worktree,
          topK: 2,
          intent: "routing test",
        })

        expect(result.status).toBe("ok")
        const paths = result.result.files.map((item) => item.path)
        expect(paths).toEqual(["src/alpha.ts", "src/zeta.ts"])
      },
    })
  })

  test("worker a stops when signal is aborted", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "src"), { recursive: true })
        for (const idx of Array.from({ length: 5000 }).keys()) {
          await Bun.write(path.join(dir, "src", `file-${idx}.ts`), `export const n${idx} = ${idx}\n`)
        }
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await WorkerA.run({
          root: Instance.worktree,
          topK: 200,
          intent: "routing test",
          signal: AbortSignal.timeout(1),
        })

        expect(result.status).toBe("error")
        expect(result.errors[0]?.message).toContain("aborted")
      },
    })
  })

  test("worker b/c degrade when unavailable", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const resultB = await WorkerB.run({
          root: Instance.worktree,
          topK: 5,
          intent: "routing test",
        })
        const resultC = await WorkerC.run({
          root: Instance.worktree,
          topK: 5,
          intent: "routing test",
        })

        expect(resultB.status).toBe("unavailable")
        expect(resultB.result.hits).toEqual([])
        expect(resultC.status).toBe("unavailable")
        expect(resultC.result.nodes).toEqual([])
      },
    })
  })
})
