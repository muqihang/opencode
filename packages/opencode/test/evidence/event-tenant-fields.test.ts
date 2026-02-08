import { describe, expect, test } from "bun:test"
import path from "path"
import { EvidenceWriter } from "../../src/evidence/writer"
import { EventV1 } from "../../src/protocol/event"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

const A2_FLAG = "OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V15_A2"

const withA2 = async (value: string | undefined, fn: () => Promise<void>) => {
  const prev = process.env[A2_FLAG]
  if (value === undefined) {
    delete process.env[A2_FLAG]
  }
  if (value !== undefined) {
    process.env[A2_FLAG] = value
  }

  return Promise.resolve(fn()).finally(() => {
    if (prev === undefined) {
      delete process.env[A2_FLAG]
      return
    }
    process.env[A2_FLAG] = prev
  })
}

describe("event tenant fields", () => {
  test("event/1.0 accepts optional tenantId and orgId", () => {
    const parsed = EventV1.parse({
      specVersion: "event/1.0",
      ts: "2026-02-08T00:00:00.000Z",
      sessionId: "session_event_fields",
      tenantId: "tenant_acme",
      orgId: "org_ops",
      severity: "info",
      actor: "test:tenant",
      type: "tenant.annotated",
      summary: "with tenant",
      redaction: { applied: true, policyVersion: "v1" },
    })

    expect(parsed.tenantId).toBe("tenant_acme")
    expect(parsed.orgId).toBe("org_ops")
  })

  test("writer injects default tenant/org fields when context is absent", async () => {
    await withA2("1", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const writer = await EvidenceWriter.open({ sessionId: "session_defaults" })
          await writer.event({
            specVersion: "event/1.0",
            ts: "2026-02-08T00:00:00.000Z",
            sessionId: "session_defaults",
            severity: "info",
            actor: "test:tenant",
            type: "tenant.default",
            summary: "default tenant",
            redaction: { applied: true, policyVersion: "v1" },
          })

          const eventsPath = path.join(
            tmp.path,
            ".opencode",
            "evidence",
            "local",
            "default",
            "session_defaults",
            "events.jsonl",
          )
          const line = (await Bun.file(eventsPath).text())
            .split("\n")
            .map((item) => item.trim())
            .find(Boolean)
          const event = EventV1.parse(JSON.parse(line ?? "{}"))

          expect(event.tenantId).toBe("local")
          expect(event.orgId).toBe("default")
        },
      })
    })
  })
})
