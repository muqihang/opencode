import { expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { runToolBroker } from "../../src/session/orchestrator/tool-broker"

const keywordPath = path.join(import.meta.dir, "..", "fixture", "orchestrator-broker-retrieval.txt")
const readKeyword = async () => (await Bun.file(keywordPath).text()).trim()

test("tool broker rejects verification requests in v0", async () => {
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const result = await runToolBroker({
        sessionId: "session_tb_reject",
        messageId: "msg_tb_reject",
        toolRequests: [{ kind: "verification", input: "confirm" }],
        abort: new AbortController().signal,
      })

      expect(result.results.length).toBe(1)
      const entry = result.results[0]!
      expect(entry.kind).toBe("verification")
      expect(entry.status).toBe("rejected")
      expect(entry.reason).toBe("unsupported_kind_v0")
    },
  })
})

test("tool broker returns retrieval pointers", async () => {
  const keyword = await readKeyword()
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      await fs.mkdir(path.join(dir, "src"), { recursive: true })
      await Bun.write(path.join(dir, "src", "keyword.ts"), `export const keyword = "${keyword}"\n`)
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const sessionId = "session_tb_retrieval"
      const result = await runToolBroker({
        sessionId,
        messageId: "msg_tb_retrieval",
        toolRequests: [{ kind: "retrieval", input: keyword }],
        abort: new AbortController().signal,
      })

      expect(result.results.length).toBe(1)
      const entry = result.results[0]!
      expect(entry.kind).toBe("retrieval")
      expect(entry.status).toBe("ok")
      expect(Boolean(entry.pointers)).toBe(true)
      const pointers = entry.pointers!
      const hit = pointers.artifacts.find((artifact) =>
        artifact.path.includes(`.opencode/artifacts/${sessionId}/retrieval/`),
      )
      expect(Boolean(hit)).toBe(true)
      expect(entry.summary?.total).toBeGreaterThan(0)
    },
  })
})
