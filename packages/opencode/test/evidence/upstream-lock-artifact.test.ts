import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { EvidenceWriter } from "../../src/evidence/writer"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { artifactCandidates, resolveTenantScope } from "../../src/util/tenant-context"

describe("evidence.upstream lockfile", () => {
  test("pack attaches UPSTREAM.lock.json as an artifact when present", async () => {
    await using tmp = await tmpdir()

    const root = tmp.path
    const repo = path.join(root, "repo")
    await fs.mkdir(repo, { recursive: true })
    await $`git init`.cwd(repo).quiet()
    await $`git commit --allow-empty -m "root commit"`.cwd(repo).quiet()

    const lock = path.join(root, "UPSTREAM.lock.json")
    const text = JSON.stringify(
      {
        schemaVersion: 1,
        generatedAtUtc: "2026-01-31T00:00:00.000Z",
        toolchain: { bun: "0.0.0", node: "v0.0.0" },
        repos: { opencode: { head: "deadbeef" } },
        patches: {},
      },
      null,
      2,
    )
    await Bun.write(lock, text)

    await Instance.provide({
      directory: repo,
      fn: async () => {
        const sessionId = "upstream_lock"
        const writer = await EvidenceWriter.open({ sessionId })
        const pack = await writer.pack({ handoff: "ok" })

        expect(pack.artifacts.some((a) => a.kind === "upstream-lock")).toBe(true)

        const scope = resolveTenantScope()
        const artifactPath = await (async () => {
          const candidates = artifactCandidates({
            base: Instance.worktree,
            sessionId,
            tenantId: scope.tenantId,
            orgId: scope.orgId,
          }).map((dir) => path.join(dir, "environment", "upstream.lock.json"))
          for (const candidate of candidates) {
            const exists = await Bun.file(candidate).exists()
            if (exists) return candidate
          }
          return candidates[0]!
        })()
        const file = Bun.file(artifactPath)
        expect(await file.exists()).toBe(true)
        expect(await file.text()).toBe(text)

        const manifest = await writer.manifest()
        expect(manifest.entries.some((e) => e.kind === "upstream-lock")).toBe(true)
      },
    })
  })
})
