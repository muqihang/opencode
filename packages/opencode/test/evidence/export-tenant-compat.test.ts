import { describe, expect, test } from "bun:test"
import path from "path"
import { exportEvidence } from "../../src/evidence/export"
import { EvidenceWriter } from "../../src/evidence/writer"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

const A2_FLAG = "OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V15_A2"
const STORAGE_LAYERING_FLAG = "OPENCODE_EXPERIMENTAL_STORAGE_LAYERING"
const STORAGE_DUAL_WRITE_FLAG = "OPENCODE_EXPERIMENTAL_STORAGE_DUAL_WRITE"
const STORAGE_RECONCILE_FLAG = "OPENCODE_EXPERIMENTAL_STORAGE_RECONCILE"

type ReconcileAudit = {
  switch?: {
    stage?: "v1-only" | "dual-read" | "dual-write" | "dual-write-reconcile"
    cutover?: {
      enabled?: boolean
      key?: string
    }
    rollback?: {
      target?: "v1-only"
      flags?: {
        layering?: string
        dualWrite?: string
        reconcile?: string
      }
    }
  }
}

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

const withStorage = async (
  value: {
    layering?: string
    dualWrite?: string
    reconcile?: string
  },
  fn: () => Promise<void>,
) => {
  const prevLayering = process.env[STORAGE_LAYERING_FLAG]
  const prevDualWrite = process.env[STORAGE_DUAL_WRITE_FLAG]
  const prevReconcile = process.env[STORAGE_RECONCILE_FLAG]

  const set = (key: string, next: string | undefined) => {
    if (next === undefined) {
      delete process.env[key]
      return
    }
    process.env[key] = next
  }

  set(STORAGE_LAYERING_FLAG, value.layering)
  set(STORAGE_DUAL_WRITE_FLAG, value.dualWrite)
  set(STORAGE_RECONCILE_FLAG, value.reconcile)

  return Promise.resolve(fn()).finally(() => {
    set(STORAGE_LAYERING_FLAG, prevLayering)
    set(STORAGE_DUAL_WRITE_FLAG, prevDualWrite)
    set(STORAGE_RECONCILE_FLAG, prevReconcile)
  })
}

describe("evidence export tenant compat", () => {
  test("writes auditable dual-write reconcile report when storage layering is enabled", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionId = "export_reconcile"
        const tenantId = "tenant_acme"
        const orgId = "org_ops"

        await withA2("1", async () => {
          await withStorage(
            {
              layering: "1",
              dualWrite: "1",
              reconcile: "1",
            },
            async () => {
              const writer = await EvidenceWriter.open({ sessionId, tenantId, orgId })
              await writer.event({
                specVersion: "event/1.0",
                ts: "2026-02-12T00:00:00.000Z",
                sessionId,
                severity: "info",
                actor: "test:tenant",
                type: "tenant.namespaced",
                summary: "dual-write",
                redaction: { applied: true, policyVersion: "v1" },
              })
              await writer.artifact({
                kind: "worktree-patch",
                path: "worktree/changes.patch",
                data: "diff --git a/a b/a",
              })
              await writer.pack({ handoff: "tenant" })
              const runtime = await writer.reconcile()
              const runtimeSwitch = (runtime as ReconcileAudit).switch
              expect(runtimeSwitch?.stage).toBe("dual-write-reconcile")
              expect(runtimeSwitch?.cutover?.enabled).toBe(true)
              expect(runtimeSwitch?.rollback?.target).toBe("v1-only")

              const report = path.join(
                tmp.path,
                ".opencode",
                "evidence-layering",
                tenantId,
                orgId,
                sessionId,
                "dual-write-reconcile.json",
              )

              expect(await Bun.file(report).exists()).toBe(true)
              const payload = JSON.parse(await Bun.file(report).text()) as {
                summary?: { mismatched?: number }
                results?: Array<{ match?: boolean }>
              } & ReconcileAudit
              expect(payload.summary?.mismatched).toBe(0)
              expect((payload.results ?? []).some((item) => item.match === true)).toBe(true)
              expect(payload.switch?.stage).toBe("dual-write-reconcile")
              expect(payload.switch?.cutover?.key).toBe("tenant_acme/org_ops/export_reconcile")
              expect(payload.switch?.rollback?.flags).toEqual({
                layering: "0",
                dualWrite: "0",
                reconcile: "0",
              })

              const outDir = path.join(tmp.path, "exported", sessionId)
              await exportEvidence({ sessionId, tenantId, orgId, outDir })
              expect(await Bun.file(path.join(outDir, "reconcile", "dual-write-reconcile.json")).exists()).toBe(
                true,
              )
            },
          )
        })
      },
    })
  })

  test("keeps reconcile export available after one-click rollback to v1-only", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionId = "export_rollback"
        const tenantId = "tenant_acme"
        const orgId = "org_ops"

        await withA2("1", async () => {
          await withStorage(
            {
              layering: "1",
              dualWrite: "1",
              reconcile: "1",
            },
            async () => {
              const writer = await EvidenceWriter.open({ sessionId, tenantId, orgId })
              await writer.event({
                specVersion: "event/1.0",
                ts: "2026-02-12T00:00:00.000Z",
                sessionId,
                severity: "info",
                actor: "test:tenant",
                type: "tenant.namespaced",
                summary: "rollback target",
                redaction: { applied: true, policyVersion: "v1" },
              })
              await writer.pack({ handoff: "tenant" })
              await writer.manifest()
              await writer.reconcile()
            },
          )

          await withStorage(
            {
              layering: "0",
              dualWrite: "0",
              reconcile: "0",
            },
            async () => {
              const outDir = path.join(tmp.path, "exported", sessionId)
              await exportEvidence({ sessionId, tenantId, orgId, outDir })
              expect(await Bun.file(path.join(outDir, "reconcile", "dual-write-reconcile.json")).exists()).toBe(
                true,
              )
            },
          )
        })
      },
    })
  })

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
