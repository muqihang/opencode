import { expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { resolveWorkspaceFingerprint } from "../../src/retrieval/workspace"
import { retrievalCacheKey } from "../../src/retrieval/cache"
import type { RetrievalPlanForKey } from "../../src/retrieval/spec"

test("retrieval cache key excludes session/message but includes workspace fingerprint", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      await fs.mkdir(path.join(dir, "src"), { recursive: true })
      await Bun.write(path.join(dir, "src", "alpha.ts"), "export const alpha = 1\n")
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const plan: RetrievalPlanForKey = {
        specVersion: "retrieval-plan/1.0",
        intent: { normalized: "alpha test" },
        queries: [{ role: "precision", q: "alpha test", lang: "auto", kind: "code" }],
        filters: { paths: [], symbols: [], kinds: [] },
        budget: { maxHits: 20, topK: 10, maxWallClockMs: 2000 },
        sources: ["code"],
        versions: { rules: "v1", stableJson: "v1" },
      }

      const clean = await resolveWorkspaceFingerprint({ root: Instance.worktree })
      const keyA = retrievalCacheKey({ plan, workspace: clean })

      await Bun.write(path.join(tmp.path, "src", "alpha.ts"), "export const alpha = 2\n")
      const dirty = await resolveWorkspaceFingerprint({ root: Instance.worktree })
      const keyB = retrievalCacheKey({ plan, workspace: dirty })

      expect(keyA).not.toBe(keyB)
    },
  })
})


test("workspace fingerprint tolerates recursive symlink loops in non-git trees", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const loopRoot = path.join(dir, "vendor", "clawdbot", "packages", "moltbot", "node_modules")
      const target = path.join(dir, "vendor", "clawdbot", "vendor", "a2ui", "renderers", "lit", "src", "0.8", "ui", "custom-components")
      await fs.mkdir(loopRoot, { recursive: true })
      await fs.mkdir(target, { recursive: true })
      await Bun.write(path.join(target, "marker.txt"), "ok\n")
      const linked = await fs
        .symlink(path.join("..", "..", ".."), path.join(loopRoot, "openclaw"))
        .then(() => true)
        .catch(() => false)
      return { linked }
    },
  })

  if (!tmp.extra.linked) return

  const fingerprint = await resolveWorkspaceFingerprint({ root: tmp.path })
  expect(fingerprint.vcs).toBe("none")
  expect(fingerprint.fsFingerprint.length).toBeGreaterThan(0)
})
