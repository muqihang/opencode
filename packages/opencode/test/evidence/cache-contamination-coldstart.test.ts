import { expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { runRetrieval } from "../../src/retrieval/runner"
import { EvidenceReader } from "../../src/evidence/reader"
import { CodeRetrievalStats } from "../../src/retrieval/code"

test("retrieval cache contamination triggers coldstart", async () => {
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
      CodeRetrievalStats.runs = 0
      const sessionId = "session_cache_contam"
      const one = await runRetrieval({
        sessionId,
        messageId: "msg_1",
        intentText: "alpha",
        abort: new AbortController().signal,
      })

      expect(CodeRetrievalStats.runs).toBe(1)

      const firstEvents = await EvidenceReader.readEvents(sessionId, { cursor: 0, limit: 200 })
      const write = firstEvents.events.find(
        (item) => item.type === "cache.write" && item.data?.namespace === "retrieval",
      )
      const key = typeof write?.data?.key === "string" ? write.data.key : ""
      expect(key.length).toBeGreaterThan(0)

      const cacheFile = path.join(
        Instance.worktree,
        ".opencode",
        "cache",
        "store",
        "retrieval",
        "entries",
        `${key}.json`,
      )
      const exists = await Bun.file(cacheFile).exists()
      expect(exists).toBe(true)

      const payload = await Bun.file(cacheFile).json()
      const entry = payload as { value: { hits: Array<{ pointer?: { sha256?: string } }> } }
      if (!entry.value.hits[0]?.pointer) {
        expect.unreachable("expected cached hit pointer")
      }
      entry.value.hits[0].pointer!.sha256 = "0".repeat(64)
      await Bun.write(cacheFile, JSON.stringify(entry))

      const two = await runRetrieval({
        sessionId,
        messageId: "msg_2",
        intentText: "alpha",
        abort: new AbortController().signal,
      })

      expect(two.retrievalCacheKey).toBe(one.retrievalCacheKey)
      expect(CodeRetrievalStats.runs).toBe(2)

      const events = await EvidenceReader.readEvents(sessionId, { cursor: 0, limit: 400 })
      const cold = events.events.find((item) => item.type === "cache.coldstart")
      expect(Boolean(cold)).toBe(true)
      expect(cold?.data?.namespace).toBe("retrieval")
    },
  })
})
