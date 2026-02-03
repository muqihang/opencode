import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { EventV1 } from "../../src/protocol/event"
import { EvidenceWriter } from "../../src/evidence/writer"
import { runSecureOutput } from "../../src/secure-output"

const sha256 = (text: string) => {
  const hash = new Bun.CryptoHasher("sha256")
  hash.update(text)
  return hash.digest("hex")
}

const buildCtx = (sessionId: string, messageId: string) => ({
  sessionID: sessionId,
  messageID: messageId,
  callID: "",
  agent: "secure-output",
  abort: AbortSignal.any([]),
  metadata: () => {},
  ask: async () => {},
})

describe("secure-output", () => {
  test("strict: missing claims block degrades with chinese next steps and writes protocol.violation", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionId = "so-1"
        const messageId = "m-1"
        const text = "这是一个确定事实：仓库已经配置了安全门禁。"

        const result = await runSecureOutput({
          sessionId,
          messageId,
          mode: "strict",
          budget: { timeMs: 20000, maxScripts: 2 },
          text,
          ctx: buildCtx(sessionId, messageId),
        })

        expect(result.status).toBe("degraded")
        expect(result.text).toContain("未知")
        expect(result.text).toContain("下一步")

        const eventsPath = path.join(Instance.worktree, ".opencode", "evidence", sessionId, "events.jsonl")
        const eventsText = await Bun.file(eventsPath).text()
        const types = eventsText
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => EventV1.parse(JSON.parse(line)).type)
        expect(types).toContain("protocol.violation")
        expect(types).toContain("secure_output.degraded")
      },
    })
  })

  test("strict: valid fact claims pass and writes claims artifact", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionId = "so-2"
        const messageId = "m-2"
        const base = path.join(Instance.worktree, ".opencode", "artifacts", sessionId)
        const root = path.join(base, "derived", "input")
        const content = "hello\nworld\n"
        const rel = "derived/input/note.txt"
        await Bun.write(path.join(root, "note.txt"), content)

        const answer = [
          "我建议先核验证据，然后再给出结论。",
          "",
          "<assistant_claims_json>",
          JSON.stringify({
            specVersion: "assistant-claims/1.0",
            policyVersion: "v1",
            claims: [
              {
                id: "c1",
                kind: "fact",
                text: "note contains hello",
                pointers: [
                  {
                    path: rel,
                    sha256: sha256(content),
                    anchor: { lineStart: 1, lineEnd: 1 },
                  },
                ],
              },
            ],
          }),
          "</assistant_claims_json>",
        ].join("\n")

        const result = await runSecureOutput({
          sessionId,
          messageId,
          mode: "strict",
          budget: { timeMs: 20000, maxScripts: 4 },
          text: answer,
          ctx: buildCtx(sessionId, messageId),
        })

        expect(result.status).toBe("ok")
        expect(result.text).toContain("我建议")
        expect(result.text).not.toContain("<assistant_claims_json>")

        const writer = await EvidenceWriter.open({ sessionId })
        const manifest = await writer.manifest()
        const claims = manifest.entries.find((entry) => entry.path.includes("secure-output") && entry.path.endsWith("claims.json"))
        expect(claims).toBeDefined()

        const eventsPath = path.join(Instance.worktree, ".opencode", "evidence", sessionId, "events.jsonl")
        const eventsText = await Bun.file(eventsPath).text()
        const types = eventsText
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => EventV1.parse(JSON.parse(line)).type)
        expect(types).toContain("secure_output.completed")
      },
    })
  })

  test("balanced: missing evidence degrades with chinese reason", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionId = "so-3"
        const messageId = "m-3"
        const rel = "derived/missing/note.txt"

        const answer = [
          "这是一个事实，但我需要证据指针才能核验。",
          "",
          "<assistant_claims_json>",
          JSON.stringify({
            specVersion: "assistant-claims/1.0",
            policyVersion: "v1",
            claims: [
              {
                id: "c1",
                kind: "fact",
                text: "missing file",
                pointers: [
                  {
                    path: rel,
                    sha256: "0".repeat(64),
                    anchor: { lineStart: 1, lineEnd: 1 },
                  },
                ],
              },
            ],
          }),
          "</assistant_claims_json>",
        ].join("\n")

        const result = await runSecureOutput({
          sessionId,
          messageId,
          mode: "balanced",
          budget: { timeMs: 20000, maxScripts: 4 },
          text: answer,
          ctx: buildCtx(sessionId, messageId),
        })

        expect(result.status).toBe("degraded")
        expect(result.text).toContain("证据")
        expect(result.text).toContain("缺失")
        expect(result.text).toContain("下一步")
      },
    })
  })
})
