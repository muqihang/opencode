import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { SandboxRunner } from "../../src/sandbox/runner"
import { EvidenceManifest } from "../../src/protocol/evidence-manifest"
import { evidenceCandidates, resolveTenantScope } from "../../src/util/tenant-context"

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

        const scope = resolveTenantScope()
        const manifestPath = await (async () => {
          const candidates = evidenceCandidates({
            base: Instance.worktree,
            sessionId: "patchy",
            tenantId: scope.tenantId,
            orgId: scope.orgId,
          }).map((dir) => path.join(dir, "manifest.json"))
          for (const candidate of candidates) {
            const exists = await Bun.file(candidate).exists()
            if (exists) return candidate
          }
          return candidates[0]!
        })()
        const manifest = EvidenceManifest.parse(JSON.parse(await Bun.file(manifestPath).text()))

        const patchEntry = manifest.entries.find((e) => e.kind === "worktree-patch")
        expect(patchEntry).toBeDefined()
        const pointer = patchEntry!.path.replaceAll("\\", "/")
        expect(pointer.includes(".opencode/artifacts/")).toBe(true)
        expect(pointer.includes("/patchy/")).toBe(true)
      },
    })
  })
})
