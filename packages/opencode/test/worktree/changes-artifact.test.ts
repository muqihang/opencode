import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { SandboxRunner } from "../../src/sandbox/runner"
import { EvidenceManifest } from "../../src/protocol/evidence-manifest"

describe("worktree change-set artifact", () => {
  test("runner registers a patch artifact for isolated git workdir", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Make the repo dirty without relying on any shell-specific commands.
        await Bun.write(path.join(Instance.worktree, "hello.txt"), "hi")

        await SandboxRunner.run({
          sessionId: "patchy",
          toolName: "bash",
          command: "echo ok",
          cwd: Instance.worktree,
          capability: {
            readonlyPaths: [Instance.worktree],
            writePaths: [Instance.worktree, path.join(Instance.worktree, ".opencode")],
            exportPaths: [],
            network: { mode: "deny_all" },
            workdirMode: "isolated",
          },
          limits: { timeoutMs: 10_000 },
        })

        const manifestPath = path.join(
          Instance.worktree,
          ".opencode",
          "evidence",
          "patchy",
          "manifest.json",
        )
        const manifest = EvidenceManifest.parse(JSON.parse(await Bun.file(manifestPath).text()))

        const patchEntry = manifest.entries.find((e) => e.kind === "worktree-patch")
        expect(patchEntry).toBeDefined()
        expect(patchEntry!.path).toContain(".opencode/artifacts/patchy")
      },
    })
  })
})
