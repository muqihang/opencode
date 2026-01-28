import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { SandboxRunner } from "../../src/sandbox/runner"

describe("sandbox.runner args", () => {
  test("passes args to spawned process (no quoting required)", async () => {
    const python = Bun.which("python3")
    if (!python) return

    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const run = await SandboxRunner.run({
          sessionId: "runner_args",
          toolName: "test",
          command: python,
          args: ["-c", "print('ok')"],
          capability: {
            readonlyPaths: [Instance.worktree],
            writePaths: [path.join(Instance.worktree, ".opencode")],
            exportPaths: [],
            network: { mode: "deny_all" },
            workdirMode: "isolated",
          },
          limits: { timeoutMs: 10_000 },
        })
        expect(run.exitCode).toBe(0)
        expect(run.stdout).toContain("ok")
      },
    })
  })
})
