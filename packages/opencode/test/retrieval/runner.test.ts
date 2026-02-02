import { expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { runRetrieval } from "../../src/retrieval/runner"
import { ContextPackBuilder } from "../../src/session/context-pack"

test("retrieval events are call-scoped and context pack includes evidence pointers", async () => {
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
      const run = await runRetrieval({
        sessionId: "session_r",
        messageId: "msg_r",
        intentText: "alpha",
        abort: new AbortController().signal,
      })

      expect(run.retrievalId.length).toBeGreaterThan(0)
      expect(run.artifacts.hits.endsWith(`retrieval/${run.retrievalId}/hits.json`)).toBe(true)

      const eventsPath = path.join(
        Instance.worktree,
        ".opencode",
        "evidence",
        "session_r",
        "events.jsonl",
      )
      const events = (await Bun.file(eventsPath).text())
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
      const started = events.find((item) => item.type === "retrieval.started" && item.data?.retrievalId === run.retrievalId)
      const terminal = events.find(
        (item) =>
          item.data?.retrievalId === run.retrievalId &&
          item.type !== "retrieval.started" &&
          item.type.startsWith("retrieval."),
      )

      expect(Boolean(started)).toBe(true)
      expect(Boolean(terminal)).toBe(true)

      const pack = ContextPackBuilder.build({
        sessionId: "session_r",
        messageId: "msg_r",
        model: { providerID: "test", id: "test", limit: { context: 4000, output: 512 } },
        system: [],
        messages: [],
        tools: {},
        evidencePointers: run.evidencePointers,
      })
      const seg = pack.segments.find((item) => item.kind === "evidence_pointers")
      expect(Boolean(seg)).toBe(true)
    },
  })
})
