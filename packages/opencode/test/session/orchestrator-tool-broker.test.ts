import { expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { runToolBroker } from "../../src/session/orchestrator/tool-broker"
import { EvidenceReader } from "../../src/evidence/reader"
import { ToolRequestV2, toolRequestV1FromV2, toolRequestV2FromV1 } from "../../src/protocol/llm-worker-result"
import { stableJson } from "../../src/util/stable-json"

const keywordPath = path.join(import.meta.dir, "..", "fixture", "orchestrator-broker-retrieval.txt")
const readKeyword = async () => (await Bun.file(keywordPath).text()).trim()

const requestFixture = (query: string) => ({
  specVersion: "tool-request/2.0" as const,
  kind: "retrieval" as const,
  queries: [
    {
      id: "q1",
      type: "symbol" as const,
      query,
      pathHints: ["packages/opencode/src/session"],
      why: "验证 claims#2",
    },
  ],
  filters: {
    extensions: [".ts", ".md"],
    exclude: [".opencode/**", ".git/**"],
  },
  expectedEvidence: ["req_rule_1"],
  dedupeKey: "sha256(intent+queries+filters)",
})

test("tool request v2 fixture keeps fields and supports v1/v2 downgrade", () => {
  const fixture = requestFixture("UserService.updatePolicy")
  const parsed = ToolRequestV2.parse(fixture)
  const replay = ToolRequestV2.parse(JSON.parse(stableJson(parsed)))

  expect(replay).toEqual(fixture)

  const downgraded = toolRequestV1FromV2(parsed)
  expect(downgraded).toEqual({ kind: "retrieval", input: "UserService.updatePolicy" })

  const upgraded = toolRequestV2FromV1(downgraded)
  expect(upgraded.specVersion).toBe("tool-request/2.0")
  expect(upgraded.kind).toBe("retrieval")
  expect(upgraded.queries[0]).toEqual({ id: "q1", type: "text", query: "UserService.updatePolicy" })
  expect(upgraded.dedupeKey.length > 0).toBe(true)
})

test("tool broker accepts v2 request by downgrading to retrieval v1", async () => {
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
      const sessionId = "session_tb_v2_bridge"
      const result = await runToolBroker({
        sessionId,
        messageId: "msg_tb_v2_bridge",
        toolRequests: [ToolRequestV2.parse(requestFixture(keyword))],
        toolPolicy: { allowed: ["retrieval"], bounceMax: 1 },
        abort: new AbortController().signal,
      })

      expect(result.status).toBe("ok")
      expect(result.results[0]?.status).toBe("ok")
      expect(result.results[0]?.kind).toBe("retrieval")
      expect(result.results[0]?.summary?.total).toBeGreaterThan(0)
    },
  })
})

test("tool broker rejects verification requests in v0", async () => {
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const result = await runToolBroker({
        sessionId: "session_tb_reject",
        messageId: "msg_tb_reject",
        toolRequests: [{ kind: "verification", input: "confirm" }],
        toolPolicy: { allowed: ["retrieval"], bounceMax: 1 },
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
        toolPolicy: { allowed: ["retrieval"], bounceMax: 1 },
        abort: new AbortController().signal,
      })

      expect(result.results.length).toBe(1)
      const entry = result.results[0]!
      expect(entry.kind).toBe("retrieval")
      expect(entry.status).toBe("ok")
      expect(Boolean(entry.pointers)).toBe(true)
      const pointers = entry.pointers!
      const hit = pointers.artifacts.find(
        (artifact) => artifact.path.includes(".opencode/artifacts/") && artifact.path.includes(`/${sessionId}/retrieval/`),
      )
      expect(Boolean(hit)).toBe(true)
      expect(entry.summary?.total).toBeGreaterThan(0)
    },
  })
})

test("tool broker persists pointer artifact for each tool result", async () => {
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
      const sessionId = "session_tb_pointer_pack"
      const result = await runToolBroker({
        sessionId,
        messageId: "msg_tb_pointer_pack",
        toolRequests: [{ kind: "retrieval", input: keyword }],
        toolPolicy: { allowed: ["retrieval"], bounceMax: 1 },
        abort: new AbortController().signal,
      })

      const entry = result.results[0]!
      const pointer = entry.pointers?.artifacts.find((item) => item.kind === "tool-broker-pointer")
      expect(Boolean(pointer)).toBe(true)
      expect(pointer?.path.includes(".opencode/artifacts/")).toBe(true)
      expect(pointer?.path.includes(`/${sessionId}/tool-broker/`)).toBe(true)

      const pointerData = await Bun.file(path.join(tmp.path, pointer!.path)).json()
      expect(pointerData).toMatchObject({
        specVersion: "tool-broker-pointer/1.0",
        sessionId,
        messageId: "msg_tb_pointer_pack",
        kind: "retrieval",
        status: "ok",
      })

      const manifest = await EvidenceReader.readManifest(sessionId)
      expect(manifest.entries.some((item) => item.path === pointer?.path)).toBe(true)
    },
  })
})
