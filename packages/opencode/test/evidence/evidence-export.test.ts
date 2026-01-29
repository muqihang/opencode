import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { SandboxRunner } from "../../src/sandbox/runner"
import { exportEvidence } from "../../src/evidence/export"

describe("evidence export", () => {
  test("exports allowlisted evidence + safe artifacts and verifies sha256", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Make the repo dirty so the exported bundle has a patch artifact too.
        await Bun.write(path.join(Instance.worktree, "hello.txt"), "hi")

        await SandboxRunner.run({
          sessionId: "exp",
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

        const outDir = path.join(tmp.path, "exported", "exp")
        await exportEvidence({
          sessionId: "exp",
          outDir,
        })

        expect(await Bun.file(path.join(outDir, "pack.json")).exists()).toBe(true)
        expect(await Bun.file(path.join(outDir, "pack.md")).exists()).toBe(true)
        expect(await Bun.file(path.join(outDir, "manifest.json")).exists()).toBe(true)
        expect(await Bun.file(path.join(outDir, "events.jsonl")).exists()).toBe(true)
        // "Safe-by-default" export includes explainability artifacts but should not require raw stdout/stderr.
        expect(
          await Bun.file(path.join(outDir, "artifacts", "policy", "execpolicy.eval.json")).exists(),
        ).toBe(true)
        expect(
          await Bun.file(path.join(outDir, "artifacts", "worktree", "changes.patch")).exists(),
        ).toBe(true)

        // Safety: ensure no symlinks were created in output.
        const stat = await fs.lstat(outDir)
        expect(stat.isSymbolicLink()).toBe(false)
      },
    })
  })

  test("rejects export when a manifest entry sha256 does not match", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await SandboxRunner.run({
          sessionId: "tamper",
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

        // Tamper with pack.json AFTER manifest was written by the runner.
        const packPath = path.join(
          Instance.worktree,
          ".opencode",
          "evidence",
          "tamper",
          "pack.json",
        )
        await Bun.write(packPath, "tampered")

        const outDir = path.join(tmp.path, "exported", "tamper")
        await expect(exportEvidence({ sessionId: "tamper", outDir })).rejects.toThrow()
      },
    })
  })
})
