import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { verifyEvidenceChain } from "../../src/evidence/chain"
import { EvidenceReader } from "../../src/evidence/reader"
import { EvidenceWriter } from "../../src/evidence/writer"
import { resolveStorageLayering } from "../../src/evidence/storage-layering"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

const A2_FLAG = "OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V15_A2"
const STORAGE_LAYERING_FLAG = "OPENCODE_EXPERIMENTAL_STORAGE_LAYERING"
const STORAGE_DUAL_WRITE_FLAG = "OPENCODE_EXPERIMENTAL_STORAGE_DUAL_WRITE"
const STORAGE_RECONCILE_FLAG = "OPENCODE_EXPERIMENTAL_STORAGE_RECONCILE"

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

const withStorageFlags = async (
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

describe("evidence tenant namespace", () => {
  test("exposes L0/L1/L2 storage layering strategy with legacy fallback", async () => {
    await withA2("1", async () => {
      await withStorageFlags(
        {
          layering: undefined,
          dualWrite: undefined,
          reconcile: undefined,
        },
        async () => {
          const plan = resolveStorageLayering({
            base: "/tmp/worktree",
            sessionId: "storage_fallback",
            tenantId: "tenant_acme",
            orgId: "org_ops",
            namespaced: true,
          })

          expect(plan.mode).toBe("legacy")
          expect(plan.primary.layer).toBe("L1")
          expect(plan.mirror).toBeUndefined()
          expect(plan.read.evidence).toEqual([
            path.join("/tmp/worktree", ".opencode", "evidence", "tenant_acme", "org_ops", "storage_fallback"),
            path.join("/tmp/worktree", ".opencode", "evidence", "storage_fallback"),
          ])
          expect(plan.l2.evidenceDir).toBe(
            path.join(
              "/tmp/worktree",
              ".opencode",
              "evidence-layering",
              "tenant_acme",
              "org_ops",
              "storage_fallback",
            ),
          )
        },
      )
    })
  })

  test("enables dual-write mirror and reconcile report path in layered mode", async () => {
    await withA2("1", async () => {
      await withStorageFlags(
        {
          layering: "1",
          dualWrite: "1",
          reconcile: "1",
        },
        async () => {
          const plan = resolveStorageLayering({
            base: "/tmp/worktree",
            sessionId: "storage_dual",
            tenantId: "tenant_acme",
            orgId: "org_ops",
            namespaced: true,
          })

          expect(plan.mode).toBe("layered")
          expect(plan.primary.layer).toBe("L1")
          expect(plan.mirror?.layer).toBe("L0")
          expect(plan.reconcile.enabled).toBe(true)
          expect(plan.reconcile.reportPath).toBe(
            path.join(
              "/tmp/worktree",
              ".opencode",
              "evidence-layering",
              "tenant_acme",
              "org_ops",
              "storage_dual",
              "dual-write-reconcile.json",
            ),
          )
        },
      )
    })
  })

  test("writes evidence and artifacts under tenant namespace when A2 is enabled", async () => {
    await withA2("1", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const writer = await EvidenceWriter.open({
            sessionId: "tenant_ns",
            tenantId: "tenant_acme",
            orgId: "org_ops",
          })

          await writer.event({
            specVersion: "event/1.0",
            ts: "2026-02-08T00:00:00.000Z",
            sessionId: "tenant_ns",
            severity: "info",
            actor: "test:tenant",
            type: "tenant.started",
            summary: "tenant namespaced",
            redaction: { applied: true, policyVersion: "v1" },
          })

          await writer.artifact({
            kind: "worktree-patch",
            path: "worktree/changes.patch",
            data: "diff --git a/a b/a",
          })
          await writer.manifest()

          const events = path.join(
            tmp.path,
            ".opencode",
            "evidence",
            "tenant_acme",
            "org_ops",
            "tenant_ns",
            "events.jsonl",
          )
          const artifact = path.join(
            tmp.path,
            ".opencode",
            "artifacts",
            "tenant_acme",
            "org_ops",
            "tenant_ns",
            "worktree",
            "changes.patch",
          )

          expect(await Bun.file(events).exists()).toBe(true)
          expect(await Bun.file(artifact).exists()).toBe(true)

          const manifest = await EvidenceReader.readManifest("tenant_ns", {
            tenantId: "tenant_acme",
            orgId: "org_ops",
          })
          const hit = manifest.entries.find((entry) => entry.path.includes("tenant_acme/org_ops/tenant_ns"))
          expect(Boolean(hit)).toBe(true)
        },
      })
    })
  })

  test("prefers tenant namespace path over legacy path when both exist", async () => {
    await withA2("1", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const legacy = path.join(tmp.path, ".opencode", "evidence", "tenant_pref", "events.jsonl")
          const tenant = path.join(
            tmp.path,
            ".opencode",
            "evidence",
            "tenant_acme",
            "org_ops",
            "tenant_pref",
            "events.jsonl",
          )

          await fs.mkdir(path.dirname(legacy), { recursive: true })
          await fs.mkdir(path.dirname(tenant), { recursive: true })

          await Bun.write(
            legacy,
            `${JSON.stringify({
              specVersion: "event/1.0",
              ts: "2026-02-08T00:00:00.000Z",
              sessionId: "tenant_pref",
              severity: "info",
              actor: "test:tenant",
              type: "tenant.legacy",
              summary: "legacy",
              redaction: { applied: true, policyVersion: "v1" },
            })}\n`,
          )
          await Bun.write(
            tenant,
            `${JSON.stringify({
              specVersion: "event/1.0",
              ts: "2026-02-08T00:00:01.000Z",
              sessionId: "tenant_pref",
              severity: "info",
              actor: "test:tenant",
              type: "tenant.namespaced",
              summary: "tenant",
              redaction: { applied: true, policyVersion: "v1" },
            })}\n`,
          )

          const batch = await EvidenceReader.readEvents("tenant_pref", {
            cursor: 0,
            limit: 1,
            tenantId: "tenant_acme",
            orgId: "org_ops",
          })

          expect(batch.events[0]?.summary).toBe("tenant")
        },
      })
    })
  })

  test("treats tenant and legacy artifact paths as equivalent during chain replay", () => {
    const hash = "a".repeat(64)
    const result = verifyEvidenceChain({
      entries: [
        {
          path: ".opencode/artifacts/tenant_acme/org_ops/session_chain/worktree/changes.patch",
          sha256: hash,
          kind: "worktree-patch",
        },
      ],
      existing: [".opencode/artifacts/session_chain/worktree/changes.patch"],
      pointers: [
        {
          ref: ".opencode/artifacts/tenant_acme/org_ops/session_chain/worktree/changes.patch",
          sha256: hash,
        },
      ],
      hashes: {
        ".opencode/artifacts/session_chain/worktree/changes.patch": hash,
      },
    })

    expect(result.ok).toBe(true)
  })

})
