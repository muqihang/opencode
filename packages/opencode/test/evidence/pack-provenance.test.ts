import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { SandboxRunner } from "../../src/sandbox/runner"
import { EvidencePack } from "../../src/protocol/evidence-pack"
import { evidenceCandidates, resolveTenantScope } from "../../src/util/tenant-context"

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

        const scope = resolveTenantScope()
        const candidates = evidenceCandidates({
          base: Instance.worktree,
          sessionId: "prov",
          tenantId: scope.tenantId,
          orgId: scope.orgId,
        }).map((dir) => path.join(dir, "pack.json"))
        const packPath = await (async () => {
          for (const candidate of candidates) {
            const exists = await Bun.file(candidate).exists()
            if (exists) return candidate
          }
          return candidates[0]!
        })()
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
