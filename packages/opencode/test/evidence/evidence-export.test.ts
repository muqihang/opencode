import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { SandboxRunner } from "../../src/sandbox/runner"
import { exportEvidence } from "../../src/evidence/export"
import { EvidenceWriter } from "../../src/evidence/writer"
import { OrchestratorFeatures } from "../../src/protocol/orchestrator-features"
import { OrchestratorPlan } from "../../src/protocol/orchestrator-plan"
import { writeOrchestratorArtifacts } from "../../src/session/orchestrator/writer"
import { evidenceCandidates, resolveTenantScope } from "../../src/util/tenant-context"

const A2_FLAG = "OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V15_A2"
const STORAGE_LAYERING_FLAG = "OPENCODE_EXPERIMENTAL_STORAGE_LAYERING"
const STORAGE_DUAL_WRITE_FLAG = "OPENCODE_EXPERIMENTAL_STORAGE_DUAL_WRITE"
const STORAGE_RECONCILE_FLAG = "OPENCODE_EXPERIMENTAL_STORAGE_RECONCILE"

type ReconcileAudit = {
  switch?: {
    rollback?: { target?: "v1-only" }
    cutover?: { key?: string }
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

const resolveEvidencePackPath = async (input: { worktree: string; sessionId: string }) => {
  const scope = resolveTenantScope()
  const candidates = evidenceCandidates({
    base: input.worktree,
    sessionId: input.sessionId,
    tenantId: scope.tenantId,
    orgId: scope.orgId,
  }).map((dir) => path.join(dir, "pack.json"))
  for (const candidate of candidates) {
    const exists = await Bun.file(candidate).exists()
    if (exists) return candidate
  }
  return candidates[0]!
}

describe("evidence export", () => {
  test("exports allowlisted evidence + safe artifacts and verifies sha256", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Make the repo dirty so the exported bundle has a patch artifact too.
        await Bun.write(path.join(Instance.worktree, "hello.txt"), "hi")

        await SandboxRunner.run({
          sessionId: "exp",
          toolName: "bash",
          command: "echo ok",
          cwd: Instance.worktree,
          capability: {
            readonlyPaths: [Instance.worktree],
            writePaths: [path.join(Instance.worktree, ".opencode")],
            exportPaths: [],
            network: { mode: "deny_all" },
            workdirMode: "isolated",
          },
          limits: { timeoutMs: 5000 },
        })

        const plan = OrchestratorPlan.parse({
          specVersion: "orchestrator-plan/1.0",
          orchestratorPlanId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
          sessionId: "exp",
          messageId: "message_01ARZ3NDEKTSV4RRFFQ69G5FAV",
          orchestratorMode: "assist",
          uxMode: "auto",
          mainTools: ["read", "grep"],
          workers: [{ id: "worker_retrieval", model: "small", budget: { timeoutMs: 8000 } }],
          budgets: {
            maxWallClockMs: 20_000,
            workerTimeoutMs: 10_000,
            maxOutputTokens: 900,
            maxToolCalls: 6,
          },
          evidencePolicy: { enabled: true, mode: "balanced" },
          toolPolicy: { allowed: ["retrieval", "verification"], bounceMax: 1 },
          reasons: [{ code: "needs_retrieval", message: "Requires citations for claims." }],
          inputsFingerprint: { sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
        })
        const features = OrchestratorFeatures.parse({
          specVersion: "orchestrator-features/1.0",
          features: {
            uxMode: "auto",
            intentBytes: 256,
            intentTokensEstimate: 64,
            hasFileParts: false,
            hasWriteIntent: true,
            hasExecIntent: false,
            hasVerificationIntent: true,
            parentSessionId: "session_01ARZ3NDEKTSV4RRFFQ69G5FAV",
          },
        })

        await writeOrchestratorArtifacts({
          sessionId: "exp",
          plan,
          features,
        })

        const outDir = path.join(tmp.path, "exported", "exp")
        await exportEvidence({
          sessionId: "exp",
          outDir,
        })

        expect(await Bun.file(path.join(outDir, "pack.json")).exists()).toBe(true)
        expect(await Bun.file(path.join(outDir, "pack.md")).exists()).toBe(true)
        expect(await Bun.file(path.join(outDir, "manifest.json")).exists()).toBe(true)
        expect(await Bun.file(path.join(outDir, "events.jsonl")).exists()).toBe(true)
        // "Safe-by-default" export includes explainability artifacts but should not require raw stdout/stderr.
        expect(
          await Bun.file(path.join(outDir, "artifacts", "policy", "execpolicy.eval.json")).exists(),
        ).toBe(true)
        expect(
          await Bun.file(path.join(outDir, "artifacts", "worktree", "changes.patch")).exists(),
        ).toBe(true)
        expect(
          await Bun.file(
            path.join(
              outDir,
              "artifacts",
              "orchestrator",
              plan.orchestratorPlanId,
              "orchestrator.plan.json",
            ),
          ).exists(),
        ).toBe(true)
        expect(
          await Bun.file(
            path.join(
              outDir,
              "artifacts",
              "orchestrator",
              plan.orchestratorPlanId,
              "orchestrator.features.json",
            ),
          ).exists(),
        ).toBe(true)

        // Safety: ensure no symlinks were created in output.
        const stat = await fs.lstat(outDir)
        expect(stat.isSymbolicLink()).toBe(false)
      },
    })
  })

  test("exports reconcile chain after dual-write cutover and rollback", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionId = "exp_reconcile"
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
                actor: "test:evidence",
                type: "evidence.migration",
                summary: "dual-write enabled",
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

              const reportPath = path.join(outDir, "reconcile", "dual-write-reconcile.json")
              expect(await Bun.file(reportPath).exists()).toBe(true)
              const report = JSON.parse(await Bun.file(reportPath).text()) as ReconcileAudit
              expect(report.switch?.rollback?.target).toBe("v1-only")
              expect(report.switch?.cutover?.key).toBe("tenant_acme/org_ops/exp_reconcile")
            },
          )
        })
      },
    })
  })

  test("rejects export when a manifest entry sha256 does not match", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await SandboxRunner.run({
          sessionId: "tamper",
          toolName: "bash",
          command: "echo ok",
          cwd: Instance.worktree,
          capability: {
            readonlyPaths: [Instance.worktree],
            writePaths: [path.join(Instance.worktree, ".opencode")],
            exportPaths: [],
            network: { mode: "deny_all" },
            workdirMode: "isolated",
          },
          limits: { timeoutMs: 5000 },
        })

        // Tamper with pack.json AFTER manifest was written by the runner.
        const packPath = await resolveEvidencePackPath({
          worktree: Instance.worktree,
          sessionId: "tamper",
        })
        await Bun.write(packPath, "tampered")

        const outDir = path.join(tmp.path, "exported", "tamper")
        await expect(exportEvidence({ sessionId: "tamper", outDir })).rejects.toThrow()
      },
    })
  })

  test("rejects export when destination file is a symlink", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Bun.write(path.join(Instance.worktree, "hello.txt"), "hi")

        await SandboxRunner.run({
          sessionId: "symlink",
          toolName: "bash",
          command: "echo ok",
          cwd: Instance.worktree,
          capability: {
            readonlyPaths: [Instance.worktree],
            writePaths: [path.join(Instance.worktree, ".opencode")],
            exportPaths: [],
            network: { mode: "deny_all" },
            workdirMode: "isolated",
          },
          limits: { timeoutMs: 5000 },
        })

        const outDir = path.join(tmp.path, "exported", "symlink")
        const linkPath = path.join(outDir, "artifacts", "worktree", "changes.patch")
        const victim = path.join(outDir, "victim.txt")

        await fs.mkdir(path.dirname(linkPath), { recursive: true })
        await fs.writeFile(victim, "original")
        await fs.symlink(victim, linkPath)

        await expect(exportEvidence({ sessionId: "symlink", outDir })).rejects.toThrow()
        const victimContent = await fs.readFile(victim, "utf8")
        expect(victimContent).toBe("original")
      },
    })
  })
})
