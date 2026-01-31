import { describe, expect, test } from "bun:test"
import { EvidenceWriter } from "../../src/evidence/writer"
import { EvidenceReader } from "../../src/evidence/reader"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("evidence.reader", () => {
  test("reads events incrementally via cursor", async () => {
    const sessionId = "test-session-1"
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const writer = await EvidenceWriter.open({ sessionId })
        await writer.event({
          specVersion: "event/1.0",
          ts: new Date().toISOString(),
          sessionId,
          severity: "info",
          actor: "test:writer",
          type: "test.event",
          summary: "first",
          redaction: { applied: true, policyVersion: "v1" },
        })
        await writer.event({
          specVersion: "event/1.0",
          ts: new Date().toISOString(),
          sessionId,
          severity: "info",
          actor: "test:writer",
          type: "test.event",
          summary: "second",
          redaction: { applied: true, policyVersion: "v1" },
        })
        await writer.event({
          specVersion: "event/1.0",
          ts: new Date().toISOString(),
          sessionId,
          severity: "info",
          actor: "test:writer",
          type: "test.event",
          summary: "third",
          redaction: { applied: true, policyVersion: "v1" },
        })

        const batch1 = await EvidenceReader.readEvents(sessionId, { cursor: 0, limit: 2 })
        expect(batch1.events).toHaveLength(2)
        expect(batch1.events[0]?.summary).toBe("first")
        expect(batch1.events[1]?.summary).toBe("second")
        expect(batch1.nextCursor).toBeGreaterThan(0)

        const batch2 = await EvidenceReader.readEvents(sessionId, { cursor: batch1.nextCursor })
        expect(batch2.events).toHaveLength(1)
        expect(batch2.events[0]?.summary).toBe("third")
      },
    })
  })

  test("reads manifest for a session", async () => {
    const sessionId = "test-session-manifest"
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const writer = await EvidenceWriter.open({ sessionId })
        await writer.event({
          specVersion: "event/1.0",
          ts: new Date().toISOString(),
          sessionId,
          severity: "info",
          actor: "test:writer",
          type: "test.event",
          summary: "hello",
          redaction: { applied: true, policyVersion: "v1" },
        })
        await writer.manifest()

        const manifest = await EvidenceReader.readManifest(sessionId)
        expect(manifest.specVersion).toBe("evidence-manifest/1.0")
        expect(manifest.packId).toBe(`EP-${sessionId}`)
        expect(manifest.entries.length).toBeGreaterThan(0)
      },
    })
  })
})

