import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { EvidenceWriter } from "../../src/evidence/writer"
import { EvidenceReader } from "../../src/evidence/reader"
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
  test("strict: missing claims block degrades but keeps the original answer text (no intrusive fallback)", async () => {
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
        expect(result.text).toContain("这是一个确定事实")
        expect(result.text).not.toContain("为了避免把未核验内容当作事实输出")

        const events = await EvidenceReader.readEvents(sessionId, { cursor: 0, limit: 80 })
        const types = events.events.map((item) => item.type)
        expect(types).toContain("protocol.violation")
        expect(types).toContain("secure_output.degraded")
      },
    })
  })

  test("balanced: missing claims block degrades but keeps the original answer text (no intrusive fallback)", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionId = "so-4"
        const messageId = "m-4"
        const text = "这是一个确定事实：仓库已经配置了安全门禁。"

        const result = await runSecureOutput({
          sessionId,
          messageId,
          mode: "balanced",
          budget: { timeMs: 20000, maxScripts: 2 },
          text,
          ctx: buildCtx(sessionId, messageId),
        })

        expect(result.status).toBe("degraded")
        expect(result.text).toContain("这是一个确定事实")
        expect(result.text).not.toContain("为了避免把未核验内容当作事实输出")

        const events = await EvidenceReader.readEvents(sessionId, { cursor: 0, limit: 80 })
        const types = events.events.map((item) => item.type)
        expect(types).toContain("protocol.violation")
        expect(types).toContain("secure_output.degraded")
      },
    })
  })

  test("strict: auto-drafts minimal fact claims from inline file:line evidence", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionId = "so-auto-draft"
        const messageId = "m-auto-draft"
        const rel = "derived/input/auto-proof.txt"
        const content = ["line 1", "line 2", "line 3", "line 4"].join("\n")
        const roots = [
          path.join(Instance.worktree, ".opencode", "artifacts", sessionId, "derived", "input"),
          path.join(Instance.worktree, ".opencode", "artifacts", "local", "default", sessionId, "derived", "input"),
        ]
        await Promise.all(roots.map((root) => Bun.write(path.join(root, "auto-proof.txt"), content)))

        const text = [
          "结论：证据已经在仓库内。",
          `可核验引用为 ${rel}:2-3。`,
          "请据此给出结果。",
        ].join("\n")

        const result = await runSecureOutput({
          sessionId,
          messageId,
          mode: "strict",
          budget: { timeMs: 20000, maxScripts: 4 },
          text,
          ctx: buildCtx(sessionId, messageId),
        })

        expect(result.status).toBe("ok")
        expect(result.text).toContain("结论")

        const writer = await EvidenceWriter.open({ sessionId })
        const manifest = await writer.manifest()
        const claims = manifest.entries.find((entry) => entry.path.includes("secure-output") && entry.path.endsWith("claims.json"))
        expect(claims).toBeDefined()
        if (!claims) return

        const payload = (await Bun.file(path.join(Instance.worktree, claims.path)).json()) as {
          claims?: Array<{
            pointers?: Array<{
              path?: string
              sha256?: string
              anchor?: { lineStart?: number; lineEnd?: number }
            }>
          }>
        }
        expect(payload.claims?.[0]?.pointers?.[0]?.path).toBe(rel)
        expect(payload.claims?.[0]?.pointers?.[0]?.sha256).toBe(sha256(content))
        expect(payload.claims?.[0]?.pointers?.[0]?.anchor).toEqual({ lineStart: 2, lineEnd: 3 })

        const events = await EvidenceReader.readEvents(sessionId, { cursor: 0, limit: 120 })
        const drafted = events.events.find((event) => event.type === "secure_output.claims_drafted")
        expect(Boolean(drafted)).toBe(true)
      },
    })
  }, { timeout: 30000 })

  test("strict: valid fact claims pass and writes claims artifact", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionId = "so-2"
        const messageId = "m-2"
        const content = "hello\nworld\n"
        const rel = "derived/input/note.txt"
        const roots = [
          path.join(Instance.worktree, ".opencode", "artifacts", sessionId, "derived", "input"),
          path.join(Instance.worktree, ".opencode", "artifacts", "local", "default", sessionId, "derived", "input"),
        ]
        await Promise.all(roots.map((root) => Bun.write(path.join(root, "note.txt"), content)))

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

        const events = await EvidenceReader.readEvents(sessionId, { cursor: 0, limit: 80 })
        const types = events.events.map((item) => item.type)
        expect(types).toContain("secure_output.completed")
      },
    })
  }, { timeout: 30000 })

  test("strict: legacy claim block is normalized and accepted", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionId = "so-legacy"
        const messageId = "m-legacy"
        const content = "hello\nworld\n"
        const rel = "derived/input/note.txt"
        const roots = [
          path.join(Instance.worktree, ".opencode", "artifacts", sessionId, "derived", "input"),
          path.join(Instance.worktree, ".opencode", "artifacts", "local", "default", sessionId, "derived", "input"),
        ]
        await Promise.all(roots.map((root) => Bun.write(path.join(root, "note.txt"), content)))

        const answer = [
          "这是结论。",
          "",
          "<assistant_claims_json>",
          JSON.stringify({
            specVersion: "assistant-claims/1.0",
            claims: [
              {
                kind: "fact",
                statement: "note contains hello",
                pointers: [
                  {
                    path: rel,
                    sha256: sha256(content),
                    anchor: "lineStart:1,lineEnd:1",
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
        expect(result.text).not.toContain("<assistant_claims_json>")

        const writer = await EvidenceWriter.open({ sessionId })
        const manifest = await writer.manifest()
        const claims = manifest.entries.find((entry) => entry.path.includes("secure-output") && entry.path.endsWith("claims.json"))
        expect(claims).toBeDefined()
        if (!claims) return

        const payload = (await Bun.file(path.join(Instance.worktree, claims.path)).json()) as {
          policyVersion?: string
          claims?: Array<{
            id?: string
            text?: string
            pointers?: Array<{ anchor?: Record<string, number> }>
          }>
        }
        expect(payload.policyVersion).toBe("v1")
        expect(payload.claims?.[0]?.id).toBe("c1")
        expect(payload.claims?.[0]?.text).toBe("note contains hello")
        expect(payload.claims?.[0]?.pointers?.[0]?.anchor).toEqual({ lineStart: 1, lineEnd: 1 })
      },
    })
  }, { timeout: 30000 })

  test("strict: fills missing sha256 from safe relative pointer and passes verification", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionId = "so-fill-missing-sha"
        const messageId = "m-fill-missing-sha"
        const content = "line-1\nline-2\n"
        const rel = "derived/input/missing-sha.txt"
        const roots = [
          path.join(Instance.worktree, ".opencode", "artifacts", sessionId, "derived", "input"),
          path.join(Instance.worktree, ".opencode", "artifacts", "local", "default", sessionId, "derived", "input"),
        ]
        await Promise.all(roots.map((root) => Bun.write(path.join(root, "missing-sha.txt"), content)))

        const answer = [
          "这是可核验结论。",
          "",
          "<assistant_claims_json>",
          JSON.stringify({
            specVersion: "assistant-claims/1.0",
            policyVersion: "v1",
            claims: [
              {
                id: "c1",
                kind: "fact",
                text: "file contains line-1",
                pointers: [
                  {
                    path: rel,
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

        const writer = await EvidenceWriter.open({ sessionId })
        const manifest = await writer.manifest()
        const claims = manifest.entries.find((entry) => entry.path.includes("secure-output") && entry.path.endsWith("claims.json"))
        expect(claims).toBeDefined()
        if (!claims) return

        const payload = (await Bun.file(path.join(Instance.worktree, claims.path)).json()) as {
          claims?: Array<{
            pointers?: Array<{ sha256?: string }>
          }>
        }
        expect(payload.claims?.[0]?.pointers?.[0]?.sha256).toBe(sha256(content))
      },
    })
  }, { timeout: 30000 })

  test("strict: replaces placeholder sha256 for safe relative pointer and avoids false citations_required degrade", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionId = "so-fill-placeholder-sha"
        const messageId = "m-fill-placeholder-sha"
        const content = "placeholder-check\n"
        const rel = "derived/input/placeholder-sha.txt"
        const roots = [
          path.join(Instance.worktree, ".opencode", "artifacts", sessionId, "derived", "input"),
          path.join(Instance.worktree, ".opencode", "artifacts", "local", "default", sessionId, "derived", "input"),
        ]
        await Promise.all(roots.map((root) => Bun.write(path.join(root, "placeholder-sha.txt"), content)))

        const answer = [
          "这是可核验结论。",
          "",
          "<assistant_claims_json>",
          JSON.stringify({
            specVersion: "assistant-claims/1.0",
            policyVersion: "v1",
            claims: [
              {
                id: "c1",
                kind: "fact",
                text: "file contains placeholder-check",
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
          mode: "strict",
          budget: { timeMs: 20000, maxScripts: 4 },
          text: answer,
          ctx: buildCtx(sessionId, messageId),
        })

        expect(result.status).toBe("ok")

        const writer = await EvidenceWriter.open({ sessionId })
        const manifest = await writer.manifest()
        const claims = manifest.entries.find((entry) => entry.path.includes("secure-output") && entry.path.endsWith("claims.json"))
        expect(claims).toBeDefined()
        if (!claims) return

        const payload = (await Bun.file(path.join(Instance.worktree, claims.path)).json()) as {
          claims?: Array<{
            pointers?: Array<{ sha256?: string }>
          }>
        }
        expect(payload.claims?.[0]?.pointers?.[0]?.sha256).toBe(sha256(content))
      },
    })
  }, { timeout: 30000 })

  test("strict: failed verification writes structured reference-check artifact and event", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionId = "so-reference-feedback"
        const messageId = "m-reference-feedback"

        const answer = [
          "这是需要核验的事实。",
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
                    path: "missing/proof.txt",
                    sha256: "a".repeat(64),
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

        expect(result.status).toBe("degraded")

        const writer = await EvidenceWriter.open({ sessionId })
        const manifest = await writer.manifest()
        const entry = manifest.entries.find((item) => item.path.includes("secure-output") && item.path.endsWith("reference-check.json"))
        expect(entry).toBeDefined()
        if (!entry) return

        const payload = (await Bun.file(path.join(Instance.worktree, entry.path)).json()) as {
          invalid_refs_count?: number
          reason_codes?: string[]
        }
        expect(typeof payload.invalid_refs_count).toBe("number")
        expect((payload.invalid_refs_count ?? 0) > 0).toBe(true)
        expect(Array.isArray(payload.reason_codes)).toBe(true)
        expect((payload.reason_codes ?? []).length > 0).toBe(true)

        const events = await EvidenceReader.readEvents(sessionId, { cursor: 0, limit: 120 })
        const feedback = events.events.find((event) => event.type === "reference_check.feedback")
        expect(Boolean(feedback)).toBe(true)
        expect(typeof feedback?.data?.["invalid_refs_count"]).toBe("number")
        expect(Array.isArray(feedback?.data?.["reason_codes"])).toBe(true)
      },
    })
  }, { timeout: 30000 })

  test("balanced: missing evidence degrades but keeps the original answer text (no intrusive fallback)", async () => {
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
        expect(result.text).toContain("这是一个事实")
        expect(result.text).not.toContain("为了避免把未核验内容当作事实输出")
      },
    })
  })
})
