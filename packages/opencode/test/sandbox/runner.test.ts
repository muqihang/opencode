import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { SandboxRunner } from "../../src/sandbox/runner"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { EvidenceManifest } from "../../src/protocol/evidence-manifest"
import { EventV1 } from "../../src/protocol/event"

describe("sandbox.runner", () => {
  test("soft backend executes and writes artifacts", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await SandboxRunner.run({
          sessionId: "session_test",
          toolName: "bash",
          command: "echo ok",
          capability: {
            readonlyPaths: [],
            writePaths: [tmp.path],
            exportPaths: [],
            network: { mode: "deny_all" },
            workdirMode: "isolated",
          },
          limits: { timeoutMs: 5000 },
        })
        expect(result.backend).toBe("soft")
        expect(result.enforcement).toBe("soft")
        const stdoutPath = path.isAbsolute(result.stdoutArtifactPath)
          ? result.stdoutArtifactPath
          : path.join(Instance.worktree, result.stdoutArtifactPath)
        const stderrPath = path.isAbsolute(result.stderrArtifactPath)
          ? result.stderrArtifactPath
          : path.join(Instance.worktree, result.stderrArtifactPath)
        await fs.stat(stdoutPath)
        await fs.stat(stderrPath)

        const manifestPath = path.join(
          Instance.worktree,
          ".opencode",
          "evidence",
          "session_test",
          "manifest.json",
        )
        const manifestText = await Bun.file(manifestPath).text()
        const manifest = EvidenceManifest.parse(JSON.parse(manifestText))
        const stdoutRel = path.isAbsolute(result.stdoutArtifactPath)
          ? path.relative(Instance.worktree, result.stdoutArtifactPath)
          : result.stdoutArtifactPath
        const stderrRel = path.isAbsolute(result.stderrArtifactPath)
          ? path.relative(Instance.worktree, result.stderrArtifactPath)
          : result.stderrArtifactPath
        const stdoutEntry = manifest.entries.find((entry) => entry.path === stdoutRel)
        const stderrEntry = manifest.entries.find((entry) => entry.path === stderrRel)
        expect(stdoutEntry).toBeDefined()
        expect(stderrEntry).toBeDefined()
      },
    })
  })

  test("aborts running command on signal", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const controller = new AbortController()
        setTimeout(() => controller.abort(), 50)
        const result = await SandboxRunner.run({
          sessionId: "session_abort",
          toolName: "bash",
          command: 'bun -e "setTimeout(() => {}, 2000)"',
          capability: {
            readonlyPaths: [],
            writePaths: [tmp.path],
            exportPaths: [],
            network: { mode: "deny_all" },
            workdirMode: "isolated",
          },
          limits: { timeoutMs: 5000 },
          abort: controller.signal,
        })
        expect(result.aborted).toBe(true)
        expect(result.timedOut).toBe(false)
      },
    })
  })

  test("emits completion event on spawn error", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        try {
          await SandboxRunner.run({
            sessionId: "session_error",
            toolName: "bash",
            command: "opencode_nonexistent_command_xyz",
            capability: {
              readonlyPaths: [],
              writePaths: [tmp.path],
              exportPaths: [],
              network: { mode: "deny_all" },
              workdirMode: "isolated",
            },
            limits: { timeoutMs: 1000 },
          })
        } catch {}

        const eventsPath = path.join(
          Instance.worktree,
          ".opencode",
          "evidence",
          "session_error",
          "events.jsonl",
        )
        const text = await Bun.file(eventsPath).text()
        const lines = text
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
        const types = lines.map((line) => {
          const data = JSON.parse(line) as unknown
          const event = EventV1.parse(data)
          return event.type
        })
        expect(types).toContain("tool.started")
        expect(types).toContain("tool.completed")
      },
    })
  })
})
