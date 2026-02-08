import path from "path"
import { Context } from "@/util/context"

const DEFAULT_TENANT_ID = "local"
const DEFAULT_ORG_ID = "default"
const TENANT_ENV = "OPENCODE_TENANT_ID"
const ORG_ENV = "OPENCODE_ORG_ID"
const A2_ENV = "OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V15_A2"

export type TenantScope = {
  tenantId: string
  orgId: string
}

const tenant = Context.create<TenantScope>("tenant-context")

const text = (value: unknown, fallback: string) => {
  if (typeof value !== "string") return fallback
  const normalized = value.trim()
  if (!normalized) return fallback
  return normalized
}

const truthy = (value: string | undefined) => {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  if (normalized === "1") return true
  return normalized === "true"
}

export const TenantContext = {
  provide: tenant.provide,
  use: tenant.use,
  get(): TenantScope | undefined {
    try {
      return tenant.use()
    } catch (error) {
      if (error instanceof Context.NotFound) return undefined
      throw error
    }
  },
}

export const isA2TenantNamespaceEnabled = () => {
  return truthy(process.env[A2_ENV])
}

export const resolveTenantScope = (input?: Partial<TenantScope>): TenantScope => {
  const context = TenantContext.get()
  const tenantId = text(
    input?.tenantId,
    text(context?.tenantId, text(process.env[TENANT_ENV], DEFAULT_TENANT_ID)),
  )
  const orgId = text(input?.orgId, text(context?.orgId, text(process.env[ORG_ENV], DEFAULT_ORG_ID)))
  return { tenantId, orgId }
}

export const evidenceSessionDir = (input: {
  base: string
  sessionId: string
  tenantId: string
  orgId: string
  namespaced: boolean
}) => {
  if (input.namespaced) {
    return path.join(input.base, ".opencode", "evidence", input.tenantId, input.orgId, input.sessionId)
  }
  return path.join(input.base, ".opencode", "evidence", input.sessionId)
}

export const artifactSessionDir = (input: {
  base: string
  sessionId: string
  tenantId: string
  orgId: string
  namespaced: boolean
}) => {
  if (input.namespaced) {
    return path.join(input.base, ".opencode", "artifacts", input.tenantId, input.orgId, input.sessionId)
  }
  return path.join(input.base, ".opencode", "artifacts", input.sessionId)
}

export const evidenceSessionPrefix = (input: {
  sessionId: string
  tenantId: string
  orgId: string
  namespaced: boolean
}) => {
  if (input.namespaced) {
    return `.opencode/evidence/${input.tenantId}/${input.orgId}/${input.sessionId}/`
  }
  return `.opencode/evidence/${input.sessionId}/`
}

export const artifactSessionPrefix = (input: {
  sessionId: string
  tenantId: string
  orgId: string
  namespaced: boolean
}) => {
  if (input.namespaced) {
    return `.opencode/artifacts/${input.tenantId}/${input.orgId}/${input.sessionId}/`
  }
  return `.opencode/artifacts/${input.sessionId}/`
}

export const evidenceCandidates = (input: {
  base: string
  sessionId: string
  tenantId: string
  orgId: string
}) => {
  const tenantDir = evidenceSessionDir({
    base: input.base,
    sessionId: input.sessionId,
    tenantId: input.tenantId,
    orgId: input.orgId,
    namespaced: true,
  })
  const legacyDir = evidenceSessionDir({
    base: input.base,
    sessionId: input.sessionId,
    tenantId: input.tenantId,
    orgId: input.orgId,
    namespaced: false,
  })
  if (isA2TenantNamespaceEnabled()) return [tenantDir, legacyDir]
  return [legacyDir]
}

export const artifactCandidates = (input: {
  base: string
  sessionId: string
  tenantId: string
  orgId: string
}) => {
  const tenantDir = artifactSessionDir({
    base: input.base,
    sessionId: input.sessionId,
    tenantId: input.tenantId,
    orgId: input.orgId,
    namespaced: true,
  })
  const legacyDir = artifactSessionDir({
    base: input.base,
    sessionId: input.sessionId,
    tenantId: input.tenantId,
    orgId: input.orgId,
    namespaced: false,
  })
  if (isA2TenantNamespaceEnabled()) return [tenantDir, legacyDir]
  return [legacyDir]
}
