import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { EvidenceWriter } from "../../src/evidence/writer"
import { tmpdir } from "../fixture/fixture"

describe("evidence.micro-pack", () => {
  test("writes micro-pack and registers manifest entry", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const writer = await EvidenceWriter.open({ sessionId: "child_session" })
        await writer.event({
          specVersion: "event/1.0",
          ts: "2026-01-28T00:00:00.000Z",
          sessionId: "child_session",
          severity: "info",
          actor: "tool:python",
          type: "tool.started",
          summary: "started",
          redaction: { applied: true, policyVersion: "v1" },
        })
        const micro = await writer.microPack({ parentSessionId: "parent_session" })
        expect(micro.specVersion).toBe("evidence-micro-pack/1.0")
        const manifest = await writer.manifest()
        expect(manifest.entries.some((entry) => entry.kind === "evidence-micro-pack")).toBe(true)
      },
    })
  })
})
