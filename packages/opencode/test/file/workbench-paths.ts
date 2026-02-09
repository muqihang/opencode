import path from "path"
import { artifactCandidates, evidenceCandidates, resolveTenantScope } from "../../src/util/tenant-context"

export function artifactPaths(input: { base: string; sessionId: string; rel: string }) {
  const scope = resolveTenantScope()
  return artifactCandidates({
    base: input.base,
    sessionId: input.sessionId,
    tenantId: scope.tenantId,
    orgId: scope.orgId,
  }).map((root) => path.join(root, input.rel))
}


export function evidencePaths(input: { base: string; sessionId: string; rel: string }) {
  const scope = resolveTenantScope()
  return evidenceCandidates({
    base: input.base,
    sessionId: input.sessionId,
    tenantId: scope.tenantId,
    orgId: scope.orgId,
  }).map((root) => path.join(root, input.rel))
}

export async function firstPath(candidates: string[]) {
  for (const candidate of candidates) {
    const exists = await Bun.file(candidate).exists()
    if (exists) return candidate
  }
  return candidates[0]!
}
