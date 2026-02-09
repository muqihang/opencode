import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { SandboxRunner } from "../../src/sandbox/runner"
import { evidenceCandidates, resolveTenantScope } from "../../src/util/tenant-context"

describe("evidence.pack view pointers", () => {
  test("pack.md includes pointers for execpolicy-eval and worktree-patch", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Make the repo dirty so patch capture triggers.
        await Bun.write(path.join(Instance.worktree, "hello.txt"), "hi")

        await SandboxRunner.run({
          sessionId: "view_ptr",
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
          limits: { timeoutMs: 5000 },
        })

        const scope = resolveTenantScope()
        const mdPath = await (async () => {
          const candidates = evidenceCandidates({
            base: Instance.worktree,
            sessionId: "view_ptr",
            tenantId: scope.tenantId,
            orgId: scope.orgId,
          }).map((dir) => path.join(dir, "pack.md"))
          for (const candidate of candidates) {
            const exists = await Bun.file(candidate).exists()
            if (exists) return candidate
          }
          return candidates[0]!
        })()
        const md = await Bun.file(mdPath).text()
        expect(md.includes(".opencode/artifacts/")).toBe(true)
        expect(md.includes("/view_ptr/policy/execpolicy.eval.json")).toBe(true)
        expect(md.includes("/view_ptr/worktree/changes.patch")).toBe(true)
      },
    })
  })
})
