import { describe, expect, test } from "bun:test"
import path from "path"
import { exportEvidence } from "../../src/evidence/export"
import { EvidenceWriter } from "../../src/evidence/writer"
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

describe("evidence export tenant compat", () => {
  test("prefers tenant namespaced evidence when both namespaced and legacy manifests exist", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionId = "export_pref"
        const tenantId = "tenant_acme"
        const orgId = "org_ops"

        await withA2(undefined, async () => {
          const writer = await EvidenceWriter.open({ sessionId })
          await writer.event({
            specVersion: "event/1.0",
            ts: "2026-02-08T00:00:00.000Z",
            sessionId,
            severity: "info",
            actor: "test:tenant",
            type: "tenant.legacy",
            summary: "legacy",
            redaction: { applied: true, policyVersion: "v1" },
          })
          await writer.pack({ handoff: "legacy" })
          await writer.manifest()
        })

        await withA2("1", async () => {
          const writer = await EvidenceWriter.open({ sessionId, tenantId, orgId })
          await writer.event({
            specVersion: "event/1.0",
            ts: "2026-02-08T00:00:01.000Z",
            sessionId,
            severity: "info",
            actor: "test:tenant",
            type: "tenant.namespaced",
            summary: "tenant",
            redaction: { applied: true, policyVersion: "v1" },
          })
          await writer.pack({ handoff: "tenant" })
          await writer.manifest()

          const outDir = path.join(tmp.path, "exported", sessionId)
          await exportEvidence({
            sessionId,
            tenantId,
            orgId,
            outDir,
          })

          const pack = JSON.parse(await Bun.file(path.join(outDir, "pack.json")).text()) as {
            capsule?: { handoff?: string }
          }
          expect(pack.capsule?.handoff).toBe("tenant")
        })
      },
    })
  })

  test("falls back to legacy evidence path when namespaced path is absent", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionId = "export_fallback"

        await withA2(undefined, async () => {
          const writer = await EvidenceWriter.open({ sessionId })
          await writer.event({
            specVersion: "event/1.0",
            ts: "2026-02-08T00:00:02.000Z",
            sessionId,
            severity: "info",
            actor: "test:tenant",
            type: "tenant.legacy",
            summary: "legacy only",
            redaction: { applied: true, policyVersion: "v1" },
          })
          await writer.pack({ handoff: "legacy" })
          await writer.manifest()
        })

        await withA2("1", async () => {
          const outDir = path.join(tmp.path, "exported", sessionId)
          await exportEvidence({
            sessionId,
            tenantId: "tenant_absent",
            orgId: "org_absent",
            outDir,
          })

          const pack = JSON.parse(await Bun.file(path.join(outDir, "pack.json")).text()) as {
            capsule?: { handoff?: string }
          }
          expect(pack.capsule?.handoff).toBe("legacy")
        })
      },
    })
  })
})
