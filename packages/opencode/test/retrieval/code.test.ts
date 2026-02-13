import { expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { runCodeRetrieval } from "../../src/retrieval/code"

test("code retrieval produces stable hits with anchors", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      await fs.mkdir(path.join(dir, "src"), { recursive: true })
      await Bun.write(path.join(dir, "src", "alpha.ts"), "export const alpha = 1\n")
      await Bun.write(path.join(dir, "src", "beta.ts"), "export function beta() {}\n")
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const input: Parameters<typeof runCodeRetrieval>[0] = {
        sessionId: "session_code",
        retrievalId: "retrieval-test",
        root: Instance.worktree,
        queries: [
          { role: "precision", q: "alpha", lang: "auto", kind: "code" },
          { role: "precision", q: "beta", lang: "auto", kind: "code" },
        ],
        budget: { maxHits: 5, topK: 5, maxWallClockMs: 2000 },
        abort: new AbortController().signal,
      }

      const first = await runCodeRetrieval(input)
      const second = await runCodeRetrieval(input)

      expect(first.hits.length).toBeGreaterThan(0)
      expect(first.hits.map((hit) => hit.pointer.path)).toEqual(second.hits.map((hit) => hit.pointer.path))

      for (const hit of first.hits) {
        expect(hit.pointer.path).toContain("retrieval/retrieval-test/snippets/")
        expect(hit.pointer.anchor?.lineStart).toBeGreaterThan(0)
        expect(typeof hit.observed_at).toBe("string")
        expect(Number.isNaN(Date.parse(hit.observed_at))).toBe(false)
        expect(typeof hit.freshness_score).toBe("number")
        expect(typeof hit.stale_reason).toBe("string")
      }
    },
  })
})

test("code retrieval handles complex zh query with list markers safely", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      await fs.mkdir(path.join(dir, "src"), { recursive: true })
      await Bun.write(path.join(dir, "src", "guide.ts"), "export const plan = `问题(中文) 1) 先定位 2) 再修复`\n")
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const input: Parameters<typeof runCodeRetrieval>[0] = {
        sessionId: "session_code_complex",
        retrievalId: "retrieval-complex-query",
        root: Instance.worktree,
        queries: [{ role: "precision", q: "问题(中文) 1) 先定位 2) 再修复", lang: "auto", kind: "code" }],
        budget: { maxHits: 5, topK: 5, maxWallClockMs: 2000 },
        abort: new AbortController().signal,
      }

      const result = await runCodeRetrieval(input)

      expect(result.hits.length).toBeGreaterThan(0)
      expect(result.hits.some((hit) => hit.source === "rg")).toBe(true)
    },
  })
})
