import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { SandboxRunner } from "../../src/sandbox/runner"
import { EvidenceManifest } from "../../src/protocol/evidence-manifest"
import { EventV1 } from "../../src/protocol/event"

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
        expect(entry!.path).toBe("policy/execpolicy.eval.json")

        const artifactPath = path.join(
          Instance.worktree,
          ".opencode",
          "artifacts",
          "policy",
          entry!.path,
        )
        const artifact = JSON.parse(await Bun.file(artifactPath).text()) as Record<string, unknown>
        expect(artifact.specVersion).toBe("execpolicy-eval/1.0")
        expect(artifact.env).toBeUndefined()
        expect(artifact.stdout).toBeUndefined()
        expect(artifact.stderr).toBeUndefined()
        expect(artifact.fileContents).toBeUndefined()
        expect(Array.isArray(artifact.notes)).toBe(true)
        expect(artifact.notes?.some((note) => String(note).includes("enforcement=soft"))).toBe(true)

        const eventsPath = path.join(
          Instance.worktree,
          ".opencode",
          "evidence",
          "policy",
          "events.jsonl",
        )
        const events = (await Bun.file(eventsPath).text())
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => EventV1.parse(JSON.parse(line)))
        const policyEvent = events.find((evt) => evt.type === "policy.exec_evaluated")
        expect(policyEvent).toBeDefined()
        expect(policyEvent?.data?.artifact).toBe(entry!.path)
      },
    })
  })
})
