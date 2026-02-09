import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { EvidenceWriter } from "../../src/evidence/writer"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { EventV1 } from "../../src/protocol/event"
import { EvidencePack } from "../../src/protocol/evidence-pack"
import { TurnTraceContext } from "../../src/util/turn-trace"
import { artifactCandidates, evidenceCandidates, resolveTenantScope } from "../../src/util/tenant-context"

const resolveEvidenceFile = async (input: { worktree: string; sessionId: string; name: string }) => {
  const scope = resolveTenantScope()
  const candidates = evidenceCandidates({
    base: input.worktree,
    sessionId: input.sessionId,
    tenantId: scope.tenantId,
    orgId: scope.orgId,
  }).map((dir) => path.join(dir, input.name))
  for (const candidate of candidates) {
    const exists = await Bun.file(candidate).exists()
    if (exists) return candidate
  }
  return candidates[0]!
}

const resolveArtifactFile = async (input: { worktree: string; sessionId: string; name: string }) => {
  const scope = resolveTenantScope()
  const candidates = artifactCandidates({
    base: input.worktree,
    sessionId: input.sessionId,
    tenantId: scope.tenantId,
    orgId: scope.orgId,
  }).map((dir) => path.join(dir, input.name))
  for (const candidate of candidates) {
    const exists = await Bun.file(candidate).exists()
    if (exists) return candidate
  }
  return candidates[0]!
}

describe("evidence.writer", () => {
  test("writes pack + manifest + events", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const writer = await EvidenceWriter.open({ sessionId: "session_test" })
        await writer.event({
          specVersion: "event/1.0",
          ts: "2026-01-28T00:00:00.000Z",
          sessionId: "session_test",
          severity: "info",
          actor: "tool:bash",
          type: "tool.started",
          summary: "started",
          redaction: { applied: true, policyVersion: "v1" },
        })
        await writer.event({
          specVersion: "event/1.0",
          ts: "2026-01-28T00:00:01.000Z",
          sessionId: "session_test",
          severity: "info",
          actor: "tool:bash",
          type: "tool.completed",
          summary: "completed",
          redaction: { applied: true, policyVersion: "v1" },
        })

        const pack = await writer.pack({
          handoff: "ok",
          execution: {
            id: "sandbox:session_test",
            kind: "sandbox",
            backend: "soft",
            enforcement: "soft",
          },
        })
        const manifest = await writer.manifest()
        expect(pack.specVersion).toBe("evidence-pack/1.0")
        expect(manifest.entries.length).toBeGreaterThan(0)

        const packJsonPath = await resolveEvidenceFile({
          worktree: Instance.worktree,
          sessionId: "session_test",
          name: "pack.json",
        })
        const packMdPath = await resolveEvidenceFile({
          worktree: Instance.worktree,
          sessionId: "session_test",
          name: "pack.md",
        })

        expect(await Bun.file(packJsonPath).exists()).toBe(true)
        expect(await Bun.file(packMdPath).exists()).toBe(true)

        const packText = await Bun.file(packJsonPath).text()
        expect(packText.includes("\n")).toBe(false)
        const packFromFile = EvidencePack.parse(JSON.parse(packText))
        expect(packFromFile.environment.execution.enforcement).toBe("soft")
        expect(packFromFile.environment.execution.backend).toBe("soft")

        const eventsPath = await resolveEvidenceFile({
          worktree: Instance.worktree,
          sessionId: "session_test",
          name: "events.jsonl",
        })
        const eventsText = await Bun.file(eventsPath).text()
        const lines = eventsText
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
        expect(lines.length).toBeGreaterThan(1)
        for (const line of lines) {
          const data = JSON.parse(line) as unknown
          EventV1.parse(data)
        }
      },
    })
  })

  test("injects traceId + messageId into events when turn context exists", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const writer = await EvidenceWriter.open({ sessionId: "ses_trace" })
        await TurnTraceContext.provide(
          { traceId: "0123456789abcdef0123456789abcdef", messageId: "message_123" },
          async () => {
            await writer.event({
              specVersion: "event/1.0",
              ts: "2026-02-01T00:00:00.000Z",
              sessionId: "ses_trace",
              severity: "info",
              actor: "tool:bash",
              type: "tool.started",
              summary: "started",
              redaction: { applied: true, policyVersion: "v1" },
            })
          },
        )

        const eventsPath = await resolveEvidenceFile({
          worktree: tmp.path,
          sessionId: "ses_trace",
          name: "events.jsonl",
        })
        const lines = (await Bun.file(eventsPath).text())
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
        const first = JSON.parse(lines[0] ?? "{}") as any
        expect(first.traceId).toBe("0123456789abcdef0123456789abcdef")
        expect(first.data?.messageId).toBe("message_123")
      },
    })
  })

  test("rejects symlink target and keeps manifest clean", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const writer = await EvidenceWriter.open({ sessionId: "session_symlink" })
        const root = await resolveArtifactFile({
          worktree: Instance.worktree,
          sessionId: "session_symlink",
          name: "",
        })
        await fs.mkdir(root, { recursive: true })
        const link = path.join(root, "link.txt")
        await fs.symlink("/tmp", link)

        await expect(
          writer.artifact({
            kind: "test",
            path: "link.txt",
            data: "nope",
          }),
        ).rejects.toThrow()

        const manifest = await writer.manifest()
        const hit = manifest.entries.find((entry) => entry.path.endsWith("link.txt"))
        expect(hit).toBeUndefined()
      },
    })
  })

  test("evidence.writer supports binary artifacts", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const writer = await EvidenceWriter.open({ sessionId: "binary" })
        const bytes = new Uint8Array([1, 2, 3, 4])
        const entry = await writer.artifact({
          kind: "binary",
          path: "inputs/binary.bin",
          data: bytes,
        })
        const file = Bun.file(
          await resolveArtifactFile({
            worktree: tmp.path,
            sessionId: "binary",
            name: "inputs/binary.bin",
          }),
        )
        const got = new Uint8Array(await file.arrayBuffer())
        expect([...got]).toEqual([...bytes])
        expect(entry.path.includes(".opencode/artifacts/")).toBe(true)
        expect(entry.path.includes("/binary/inputs/binary.bin")).toBe(true)
      },
    })
  })

  test("rejects traversal and does not add manifest entry", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const writer = await EvidenceWriter.open({ sessionId: "session_traversal" })
        await expect(
          writer.artifact({
            kind: "test",
            path: "../bad.txt",
            data: "nope",
          }),
        ).rejects.toThrow()

        const manifest = await writer.manifest()
        const hit = manifest.entries.find((entry) => entry.path.includes("bad.txt"))
        expect(hit).toBeUndefined()
      },
    })
  })
})
