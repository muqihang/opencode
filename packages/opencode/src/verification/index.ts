import path from "path"
import { EvidenceWriter } from "@/evidence/writer"
import { Instance } from "@/project/instance"
import { stableJson } from "@/util/stable-json"
import { CacheStore } from "@/cache/store"
import { CachePolicy } from "@/cache/policy"
import { sha256Text } from "@/routing/cache"
import { VerificationMode, VerificationReport } from "@/protocol/verification-report"
import { ScriptRegistry } from "@/python/registry"
import { gateVerificationResult } from "./claim-graph"
import { runVerification as runWorker, VerificationStats } from "./worker"

type ScriptDigest = { id: string; sha256: string }

const baseDir = () => (Instance.worktree === "/" ? Instance.directory : Instance.worktree)

const storeScope = () => ({
  projectId: Instance.project.id,
  worktreeRoot: baseDir(),
})

const storeLimits = () => CachePolicy.limits()

const storeTtlMs = () => CachePolicy.ttlMs("verification")

const storeArtifact = async (key: string) => {
  const rel = [".opencode", "cache", "store", "verification", "entries", `${key}.json`].join("/")
  const file = path.join(baseDir(), ...rel.split("/"))
  const text = await Bun.file(file).text().catch(() => "")
  if (!text) return
  return { path: rel, sha256: sha256Text(text), kind: "cache-entry" }
}

const loadReport = async (reportPath: string) => {
  const file = path.join(baseDir(), reportPath)
  return Bun.file(file).json().catch(() => undefined)
}

const normalizePointer = (value: unknown) => {
  if (!value || typeof value !== "object") return
  const pointer = value as Record<string, unknown>
  const pathValue = pointer.path
  if (typeof pathValue !== "string" || !pathValue) return
  const sha256 = typeof pointer.sha256 === "string" ? pointer.sha256 : undefined
  const kind = typeof pointer.kind === "string" ? pointer.kind : undefined
  const anchor = pointer.anchor && typeof pointer.anchor === "object" ? (pointer.anchor as Record<string, unknown>) : undefined
  return { path: pathValue, sha256, kind, anchor }
}

const normalizeClaim = (value: unknown) => {
  if (!value || typeof value !== "object") return
  const claim = value as Record<string, unknown>
  const id = claim.id
  if (typeof id !== "string" || !id) return
  const text = typeof claim.text === "string" ? claim.text : undefined
  const pointersRaw = Array.isArray(claim.pointers) ? claim.pointers : []
  const pointers = pointersRaw
    .map((p) => normalizePointer(p))
    .filter((p): p is NonNullable<ReturnType<typeof normalizePointer>> => Boolean(p))
    .map((p) => stableJson(p))
    .toSorted()
    .map((p) => JSON.parse(p) as unknown)
  const quote = claim.quote && typeof claim.quote === "object" ? claim.quote : undefined
  const table = claim.table && typeof claim.table === "object" ? claim.table : undefined
  return { id, text, pointers, quote, table }
}

const scriptsFingerprint = async () => {
  const ids = ["citation-check", "redaction-scan", "doc-quote-anchor", "table-check"]
  const resolved = await Promise.all(
    ids.map(async (id) => {
      const entry = await ScriptRegistry.resolve({ scriptId: id }).catch(() => undefined)
      if (!entry) return
      return { id, sha256: entry.sha256 } satisfies ScriptDigest
    }),
  )
  const scripts = resolved.filter((x): x is ScriptDigest => Boolean(x)).toSorted((a, b) => a.id.localeCompare(b.id))
  const ok = scripts.length === ids.length
  return { ok, scripts }
}

export { VerificationStats }

export const runVerification = async (input: Parameters<typeof runWorker>[0]) => {
  const mode = VerificationMode.parse(input.mode)
  const policyVersion = "v1"

  const claims = Array.isArray(input.claims) ? input.claims : []
  const normalizedClaims = claims
    .map((c) => normalizeClaim(c))
    .filter((c): c is NonNullable<ReturnType<typeof normalizeClaim>> => Boolean(c))
    .toSorted((a, b) => a.id.localeCompare(b.id))

  const pointersRaw = input.pointers ?? []
  const pointersFromClaims = normalizedClaims.flatMap((c) => (Array.isArray(c.pointers) ? c.pointers : []))
  const pointersNormalized = (Array.isArray(pointersRaw) && pointersRaw.length > 0 ? pointersRaw : pointersFromClaims)
    .map((p) => normalizePointer(p))
    .filter((p): p is NonNullable<ReturnType<typeof normalizePointer>> => Boolean(p))
    .map((p) => stableJson(p))
    .toSorted()

  const scripts = await scriptsFingerprint()
  const scope = storeScope()

  const enabled = scripts.ok && CachePolicy.policy("verification").enabled
  const key = CacheStore.key({
    namespace: "verification",
    scope,
    input: {
      specVersion: "verification-cache-key/1.0",
      policyVersion,
      mode,
      budget: input.budget,
      claims: normalizedClaims,
      pointers: pointersNormalized,
      scripts: scripts.scripts,
      versions: { worker: "v1", stableJson: "v1" },
    },
  })

  const store = CacheStore.open({
    namespace: "verification",
    scope,
    limits: storeLimits(),
  })

  const cached = await store.getOrCompute({
    key,
    ttlMs: storeTtlMs(),
    policy: { enabled, force: false },
    compute: async () => {
      const result = await runWorker(input)
      const reportText = await Bun.file(path.join(baseDir(), result.reportPath)).text().catch(() => "")
      const viewText = await Bun.file(path.join(baseDir(), result.viewPath)).text().catch(() => "")
      const report = VerificationReport.parse(JSON.parse(reportText) as unknown)
      return {
        specVersion: "verification-cache/1.0",
        policyVersion,
        report,
        view: viewText,
        result,
      }
    },
  })

  const writer = await EvidenceWriter.open({ sessionId: input.taskFrame.sessionId })
  const cfg = CachePolicy.effective()
  await writer.event({
    specVersion: "event/1.0",
    ts: new Date().toISOString(),
    sessionId: input.taskFrame.sessionId,
    severity: "info",
    actor: "cache:policy",
    type: "cache.config_effective",
    summary: "cache config effective",
    data: {
      storeEnabled: cfg.storeEnabled,
      forceContextPack: cfg.forceContextPack,
      strict: cfg.strict,
      sources: cfg.sources,
    },
    redaction: { applied: true, policyVersion: "v1" },
  })
  const artifact = await storeArtifact(key)
  await writer.event({
    specVersion: "event/1.0",
    ts: new Date().toISOString(),
    sessionId: input.taskFrame.sessionId,
    severity: "info",
    actor: "cache:store",
    type: "cache.read",
    summary: "cache read",
    data: {
      namespace: "verification",
      key,
      scope,
      decision: cached.status,
      tier: cached.tier,
      artifact,
    },
    redaction: { applied: true, policyVersion: "v1" },
  })

  await writer.event({
    specVersion: "event/1.0",
    ts: new Date().toISOString(),
    sessionId: input.taskFrame.sessionId,
    severity: "info",
    actor: "cache:store",
    type: cached.status === "hit" ? "cache.hit" : "cache.miss",
    summary: cached.status === "hit" ? "cache hit" : "cache miss",
    data: {
      namespace: "verification",
      key,
      scope,
      decision: cached.status,
      tier: cached.tier,
      artifact,
    },
    redaction: { applied: true, policyVersion: "v1" },
  })

  if (cached.status !== "hit" && enabled) {
    const stored = await storeArtifact(key)
    await writer.event({
      specVersion: "event/1.0",
      ts: new Date().toISOString(),
      sessionId: input.taskFrame.sessionId,
      severity: "info",
      actor: "cache:store",
      type: "cache.write",
      summary: "cache write",
      data: {
        namespace: "verification",
        key,
        scope,
        decision: cached.status,
        tier: "disk",
        artifact: stored,
      },
      redaction: { applied: true, policyVersion: "v1" },
    })
  }

  if (cached.status !== "hit") {
    const result = (cached.value as { result?: unknown }).result
    const view = result && typeof result === "object" ? (result as Record<string, unknown>) : undefined
    const ok = typeof view?.ok === "boolean" ? view.ok : undefined
    const verificationId = typeof view?.verificationId === "string" ? view.verificationId : undefined
    const reportPath = typeof view?.reportPath === "string" ? view.reportPath : undefined
    const viewPath = typeof view?.viewPath === "string" ? view.viewPath : undefined
    const degraded = typeof view?.degraded === "boolean" ? view.degraded : undefined
    const hint = typeof view?.hint === "string" ? view.hint : undefined

    if (ok !== undefined && verificationId && reportPath && viewPath && degraded !== undefined && hint !== undefined) {
      const report = await loadReport(reportPath)
      const gated = gateVerificationResult({ result: { ok, degraded, hint }, report })
      return {
        ok: gated.ok,
        degraded: gated.degraded,
        verificationId,
        hint: gated.hint,
        reportPath,
        viewPath,
        claimGate: gated.claimGate,
      }
    }

    const fallback = await runWorker(input)
    const report = await loadReport(fallback.reportPath)
    const gated = gateVerificationResult({
      result: {
        ok: fallback.ok,
        degraded: fallback.degraded,
        hint: fallback.hint,
      },
      report,
    })

    return {
      ok: gated.ok,
      degraded: gated.degraded,
      verificationId: fallback.verificationId,
      hint: gated.hint,
      reportPath: fallback.reportPath,
      viewPath: fallback.viewPath,
      claimGate: gated.claimGate,
    }
  }

  const view = (cached.value as { view?: unknown }).view
  const report = (cached.value as { report?: unknown }).report
  const parsedReport = VerificationReport.parse(report)
  const viewText = typeof view === "string" ? view : stableJson({ error: "missing_view" })

  const reportEntry = await writer.artifact({
    kind: "verification-report",
    path: "verification/verification.report.json",
    data: stableJson(parsedReport),
  })
  const viewEntry = await writer.artifact({
    kind: "verification-view",
    path: "verification/verification.report.view.md",
    data: viewText,
  })

  await writer.event({
    specVersion: "event/1.0",
    ts: new Date().toISOString(),
    sessionId: input.taskFrame.sessionId,
    severity: parsedReport.ok ? "info" : "warn",
    actor: "worker:verification",
    type: "verification.completed",
    summary: "核验完成（缓存命中）",
    data: {
      verificationId: parsedReport.verificationId,
      mode: parsedReport.mode,
      contextPackId: input.taskFrame.contextPackId,
      report_artifact: reportEntry.path,
      view_artifact: viewEntry.path,
      summary: parsedReport.summary,
      cached: { key, tier: cached.tier },
    },
    redaction: { applied: true, policyVersion: "v1" },
  })

  const gated = gateVerificationResult({
    result: {
      ok: parsedReport.ok,
      degraded: parsedReport.degraded,
      hint: "缓存命中",
    },
    report: parsedReport,
  })

  return {
    ok: gated.ok,
    degraded: gated.degraded,
    verificationId: parsedReport.verificationId,
    hint: gated.hint,
    reportPath: reportEntry.path,
    viewPath: viewEntry.path,
    claimGate: gated.claimGate,
  }
}
