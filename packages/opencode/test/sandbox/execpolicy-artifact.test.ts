import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { SandboxRunner } from "../../src/sandbox/runner"
import { EvidenceManifest } from "../../src/protocol/evidence-manifest"
import { EventV1 } from "../../src/protocol/event"
import { artifactCandidates, evidenceCandidates, resolveTenantScope } from "../../src/util/tenant-context"


async function artifactRoot(sessionId: string) {
  const scope = resolveTenantScope()
  const candidates = artifactCandidates({
    base: Instance.worktree,
    sessionId,
    tenantId: scope.tenantId,
    orgId: scope.orgId,
  })
  for (const candidate of candidates) {
    const exists = await Bun.file(candidate).exists()
    if (exists) return candidate
  }
  return candidates[0]!
}

async function evidenceRoot(sessionId: string) {
  const scope = resolveTenantScope()
  const candidates = evidenceCandidates({
    base: Instance.worktree,
    sessionId,
    tenantId: scope.tenantId,
    orgId: scope.orgId,
  })
  for (const candidate of candidates) {
    const exists = await Bun.file(candidate).exists()
    if (exists) return candidate
  }
  return candidates[0]!
}

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

        const evidenceDir = await evidenceRoot("policy")
        const manifest = EvidenceManifest.parse(JSON.parse(await Bun.file(path.join(evidenceDir, "manifest.json")).text()))
        const entry = manifest.entries.find((e) => e.kind === "execpolicy-eval")
        expect(entry).toBeDefined()
        expect(entry!.path).toBe("policy/execpolicy.eval.json")

        const artifactDir = await artifactRoot("policy")
        const artifact = JSON.parse(await Bun.file(path.join(artifactDir, entry!.path)).text()) as Record<string, unknown>
        expect(artifact.specVersion).toBe("execpolicy-eval/1.0")
        expect(artifact.env).toBeUndefined()
        expect(artifact.stdout).toBeUndefined()
        expect(artifact.stderr).toBeUndefined()
        expect(artifact.fileContents).toBeUndefined()
        const notes = (artifact as Record<string, unknown>).notes
        expect(Array.isArray(notes)).toBe(true)
        expect(
          (notes as unknown[]).some((note: unknown) =>
            String(note).includes("enforcement=soft"),
          ),
        ).toBe(true)

        const events = (await Bun.file(path.join(evidenceDir, "events.jsonl")).text())
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
