import path from "path"
import { artifactSessionDir, artifactSessionPrefix, evidenceSessionDir, evidenceSessionPrefix } from "@/util/tenant-context"

const STORAGE_LAYERING_FLAG = "OPENCODE_EXPERIMENTAL_STORAGE_LAYERING"
const STORAGE_DUAL_WRITE_FLAG = "OPENCODE_EXPERIMENTAL_STORAGE_DUAL_WRITE"
const STORAGE_RECONCILE_FLAG = "OPENCODE_EXPERIMENTAL_STORAGE_RECONCILE"

type StorageLayer = "L0" | "L1" | "L2"

type StorageTarget = {
  layer: StorageLayer
  evidenceDir: string
  artifactDir: string
  evidencePrefix: string
  artifactPrefix: string
}

type StorageReconcilePlan = {
  enabled: boolean
  reportPath: string
}

type StorageMigrationStage = "v1-only" | "dual-read" | "dual-write" | "dual-write-reconcile"

type StorageMigrationPlan = {
  stage: StorageMigrationStage
  writeMode: "v1-only" | "v1-v2"
  readMode: "v1-first" | "v2-first"
  cutover: {
    enabled: boolean
    key: string
  }
  rollback: {
    target: "v1-only"
    flags: {
      layering: "0"
      dualWrite: "0"
      reconcile: "0"
    }
  }
}

export type StorageLayeringPlan = {
  mode: "legacy" | "layered"
  primary: StorageTarget
  mirror?: StorageTarget
  read: {
    evidence: string[]
    artifacts: string[]
  }
  l2: StorageTarget
  reconcile: StorageReconcilePlan
  migration: StorageMigrationPlan
}

const truthy = (value: string | undefined) => {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return normalized === "1" || normalized === "true"
}

const rel = (prefix: string, full: string) => {
  const normalizedPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`
  const normalizedFull = full.replace(/\\/g, "/")
  if (!normalizedFull.startsWith(normalizedPrefix)) return undefined
  return normalizedFull.slice(normalizedPrefix.length)
}

const target = (input: {
  layer: StorageLayer
  base: string
  sessionId: string
  tenantId: string
  orgId: string
  namespaced: boolean
}) => {
  if (input.layer === "L2") {
    const evidenceDir = path.join(
      input.base,
      ".opencode",
      "evidence-layering",
      input.tenantId,
      input.orgId,
      input.sessionId,
    )
    const artifactDir = path.join(
      input.base,
      ".opencode",
      "artifacts-layering",
      input.tenantId,
      input.orgId,
      input.sessionId,
    )
    return {
      layer: input.layer,
      evidenceDir,
      artifactDir,
      evidencePrefix: `.opencode/evidence-layering/${input.tenantId}/${input.orgId}/${input.sessionId}/`,
      artifactPrefix: `.opencode/artifacts-layering/${input.tenantId}/${input.orgId}/${input.sessionId}/`,
    }
  }

  const namespaced = input.layer === "L1" ? input.namespaced : false
  return {
    layer: input.layer,
    evidenceDir: evidenceSessionDir({
      base: input.base,
      sessionId: input.sessionId,
      tenantId: input.tenantId,
      orgId: input.orgId,
      namespaced,
    }),
    artifactDir: artifactSessionDir({
      base: input.base,
      sessionId: input.sessionId,
      tenantId: input.tenantId,
      orgId: input.orgId,
      namespaced,
    }),
    evidencePrefix: evidenceSessionPrefix({
      sessionId: input.sessionId,
      tenantId: input.tenantId,
      orgId: input.orgId,
      namespaced,
    }),
    artifactPrefix: artifactSessionPrefix({
      sessionId: input.sessionId,
      tenantId: input.tenantId,
      orgId: input.orgId,
      namespaced,
    }),
  }
}

export const resolveStorageLayering = (input: {
  base: string
  sessionId: string
  tenantId: string
  orgId: string
  namespaced: boolean
}) => {
  const l0 = target({
    layer: "L0",
    base: input.base,
    sessionId: input.sessionId,
    tenantId: input.tenantId,
    orgId: input.orgId,
    namespaced: false,
  })
  const l1 = target({
    layer: "L1",
    base: input.base,
    sessionId: input.sessionId,
    tenantId: input.tenantId,
    orgId: input.orgId,
    namespaced: input.namespaced,
  })
  const l2 = target({
    layer: "L2",
    base: input.base,
    sessionId: input.sessionId,
    tenantId: input.tenantId,
    orgId: input.orgId,
    namespaced: true,
  })

  const layering = truthy(process.env[STORAGE_LAYERING_FLAG])
  const dualWrite = layering && truthy(process.env[STORAGE_DUAL_WRITE_FLAG])
  const reconcileEnabled = layering && truthy(process.env[STORAGE_RECONCILE_FLAG])
  const stage = !layering
    ? "v1-only"
    : dualWrite
      ? reconcileEnabled
        ? "dual-write-reconcile"
        : "dual-write"
      : "dual-read"

  const writeMode = dualWrite ? "v1-v2" : "v1-only"
  const readMode = layering && input.namespaced ? "v2-first" : "v1-first"

  const readEvidence = input.namespaced ? [l1.evidenceDir, l0.evidenceDir] : [l0.evidenceDir]
  const readArtifacts = input.namespaced ? [l1.artifactDir, l0.artifactDir] : [l0.artifactDir]

  return {
    mode: layering ? "layered" : "legacy",
    primary: l1,
    mirror: dualWrite ? l0 : undefined,
    read: {
      evidence: readEvidence,
      artifacts: readArtifacts,
    },
    l2,
    reconcile: {
      enabled: reconcileEnabled,
      reportPath: path.join(l2.evidenceDir, "dual-write-reconcile.json"),
    },
    migration: {
      stage,
      writeMode,
      readMode,
      cutover: {
        enabled: stage !== "v1-only",
        key: `${input.tenantId}/${input.orgId}/${input.sessionId}`,
      },
      rollback: {
        target: "v1-only",
        flags: {
          layering: "0",
          dualWrite: "0",
          reconcile: "0",
        },
      },
    },
  } satisfies StorageLayeringPlan
}

export const resolveMirrorPath = (input: {
  sourcePath: string
  primary: StorageTarget
  mirror: StorageTarget
}) => {
  const relEvidence = rel(input.primary.evidencePrefix, input.sourcePath)
  if (relEvidence) {
    return path.join(input.mirror.evidenceDir, ...relEvidence.split("/"))
  }

  const relArtifact = rel(input.primary.artifactPrefix, input.sourcePath)
  if (relArtifact) {
    return path.join(input.mirror.artifactDir, ...relArtifact.split("/"))
  }

  return undefined
}
