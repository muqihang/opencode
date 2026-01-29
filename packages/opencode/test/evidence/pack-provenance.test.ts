import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { SandboxRunner } from "../../src/sandbox/runner"
import { EvidencePack } from "../../src/protocol/evidence-pack"

describe("evidence.pack provenance", () => {
  test("pack.json records os/runtime/repo metadata", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await SandboxRunner.run({
          sessionId: "prov",
          toolName: "bash",
          command: "echo ok",
          cwd: Instance.worktree,
          capability: {
            readonlyPaths: [Instance.worktree],
            writePaths: [path.join(Instance.worktree, ".opencode")],
            exportPaths: [],
            network: { mode: "deny_all" },
            workdirMode: "isolated",
          },
          limits: { timeoutMs: 5000 },
        })

        const packPath = path.join(
          Instance.worktree,
          ".opencode",
          "evidence",
          "prov",
          "pack.json",
        )
        const data = JSON.parse(await Bun.file(packPath).text()) as unknown
        const pack = EvidencePack.parse(data)

        expect(pack.environment.os).toBeDefined()
        expect(pack.environment.runtime).toBeDefined()
        expect(pack.environment.repo).toBeDefined()
        expect(pack.environment.repo?.commit).toBeDefined()
        expect(pack.environment.repo?.dirty).toBeDefined()
        expect(typeof pack.environment.repo?.dirty).toBe("boolean")
      },
    })
  })
})
