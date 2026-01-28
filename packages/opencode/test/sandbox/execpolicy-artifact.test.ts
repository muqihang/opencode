import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { SandboxRunner } from "../../src/sandbox/runner"
import { EvidenceManifest } from "../../src/protocol/evidence-manifest"

describe("sandbox execpolicy eval artifact", () => {
  test("runner writes execpolicy.eval.json and registers it in manifest", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await SandboxRunner.run({
          sessionId: "policy",
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

        const manifestPath = path.join(
          Instance.worktree,
          ".opencode",
          "evidence",
          "policy",
          "manifest.json",
        )
        const manifest = EvidenceManifest.parse(JSON.parse(await Bun.file(manifestPath).text()))
        const entry = manifest.entries.find((e) => e.kind === "execpolicy-eval")
        expect(entry).toBeDefined()
      },
    })
  })
})
