import path from "path"
import z from "zod"
import { Instance } from "@/project/instance"
import { stableJson } from "@/util/stable-json"
import { EvidenceWriter } from "@/evidence/writer"
import { AssistantClaims } from "@/protocol/assistant-claims"
import { runVerification } from "@/verification"
import { VerificationReport } from "@/protocol/verification-report"
import { artifactCandidates, resolveTenantScope } from "@/util/tenant-context"
import type { Tool } from "@/tool/tool"

const Mode = z.enum(["strict", "balanced", "loose"])

const Budget = z
  .object({
    timeMs: z.number().int().positive(),
    maxScripts: z.number().int().positive().optional(),
    maxInputBytes: z.number().int().positive().optional(),
  })
  .strict()

type Result =
  | {
      status: "ok"
      text: string
      artifacts: string[]
    }
  | {
      status: "degraded"
      text: string
      artifacts: string[]
    }

const openTag = "<assistant_claims_json>"
const closeTag = "</assistant_claims_json>"
const emptyFileSha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

const baseDir = () => (Instance.worktree === "/" ? Instance.directory : Instance.worktree)

const safeJson = (raw: string) => {
  try {
    return { ok: true as const, value: JSON.parse(raw) as unknown }
  } catch (error) {
    return { ok: false as const, error }
  }
}

const record = (value: unknown) => {
  if (!value) return undefined
  if (typeof value !== "object") return undefined
  if (Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

const text = (value: unknown) => (typeof value === "string" ? value : undefined)

const parseAnchorPiece = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed) return trimmed
  const numeric = Number(trimmed)
  if (!Number.isFinite(numeric)) return trimmed
  const decimal = /^-?\d+(\.\d+)?$/
  if (!decimal.test(trimmed)) return trimmed
  return numeric
}

const parseAnchorText = (value: string) => {
  const parts = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item) => {
      const [head, ...rest] = item.split(":")
      const key = head?.trim() ?? ""
      const raw = rest.join(":").trim()
      if (!key) return undefined
      if (!raw) return undefined
      return [key, parseAnchorPiece(raw)] as const
    })
    .filter((item) => item !== undefined)
  if (parts.length === 0) return undefined
  return Object.fromEntries(parts)
}

const normalizeAnchor = (value: unknown) => {
  const obj = record(value)
  if (obj) return obj
  const raw = text(value)
  if (!raw) return undefined
  return parseAnchorText(raw)
}

const hasTraversal = (value: string) => {
  const normalized = value.replace(/\\/g, "/")
  return normalized.split("/").includes("..")
}

const safePointerTarget = (root: string, rel: string) => {
  if (!rel) return undefined
  if (path.isAbsolute(rel)) return undefined
  if (hasTraversal(rel)) return undefined
  const target = path.resolve(root, rel)
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`
  if (target !== root && !target.startsWith(prefix)) return undefined
  return target
}

const sha256File = async (target: string) => {
  const file = Bun.file(target)
  const exists = await file.exists().catch(() => false)
  if (!exists) return undefined
  const bytes = await file.bytes().catch(() => undefined)
  if (!bytes) return undefined
  const hash = new Bun.CryptoHasher("sha256")
  hash.update(bytes)
  return hash.digest("hex")
}

const placeholderSha = (value: string | undefined) => {
  if (!value) return true
  const normalized = value.trim().toLowerCase()
  if (!normalized) return true
  if (normalized === emptyFileSha256) return true
  if (/^0{64}$/.test(normalized)) return true
  return false
}

const completePointerSha = async (input: {
  roots: string[]
  rel: string
  sha?: string
}) => {
  if (!placeholderSha(input.sha)) return input.sha
  const match = await Promise.all(
    input.roots.map(async (root) => {
      const target = safePointerTarget(root, input.rel)
      if (!target) return undefined
      return sha256File(target)
    }),
  )
  const value = match.find((item) => typeof item === "string" && item.length > 0)
  if (value) return value
  return input.sha
}

const normalizePointer = async (value: unknown, roots: string[]) => {
  const item = record(value)
  if (!item) return undefined
  const path = text(item.path) ?? ""
  const sha = text(item.sha256)
  const completeSha = await completePointerSha({
    roots,
    rel: path,
    sha,
  })
  const anchor = normalizeAnchor(item.anchor)
  return {
    path,
    ...(completeSha ? { sha256: completeSha } : {}),
    ...(anchor ? { anchor } : {}),
  }
}

const normalizeClaimsPayload = async (input: {
  sessionId: string
  value: unknown
}) => {
  const root = record(input.value)
  if (!root) return { payload: input.value, adjusted: false }
  const scope = resolveTenantScope()
  const roots = artifactCandidates({
    base: baseDir(),
    sessionId: input.sessionId,
    tenantId: scope.tenantId,
    orgId: scope.orgId,
  })

  const claims = Array.isArray(root.claims) ? root.claims : []
  const normalizedClaims = await Promise.all(
    claims.map(async (item, index) => {
      const claim = record(item)
      if (!claim) return undefined
      const pointers = Array.isArray(claim.pointers) ? claim.pointers : []
      const normalizedPointers = (
        await Promise.all(pointers.map((pointer) => normalizePointer(pointer, roots)))
      ).flatMap((pointer) => (pointer ? [pointer] : []))
      const kind = text(claim.kind) ?? "fact"
      const label = text(claim.text) ?? text(claim.statement) ?? ""
      return {
        id: text(claim.id) ?? `c${index + 1}`,
        kind,
        text: label,
        pointers: normalizedPointers,
      }
    }),
  )
  const normalized = {
    specVersion: "assistant-claims/1.0",
    policyVersion: text(root.policyVersion) ?? "v1",
    claims: normalizedClaims.flatMap((item) => (item ? [item] : [])),
  }

  return {
    payload: normalized,
    adjusted: stableJson(normalized) !== stableJson(input.value),
  }
}

const stripClaims = (text: string) => {
  const start = text.lastIndexOf(openTag)
  if (start < 0) return { ok: false as const, error: "missing_block" as const }
  const end = text.indexOf(closeTag, start)
  if (end < 0) return { ok: false as const, error: "missing_close" as const }

  const raw = text.slice(start + openTag.length, end).trim()
  const before = text.slice(0, start)
  const after = text.slice(end + closeTag.length)
  const cleaned = [before, after].join("\n").trim()

  return { ok: true as const, raw, cleaned }
}

const looksCertain = (text: string) => {
  const patterns = ["确定", "确定事实", "已经", "必然", "无疑", "事实", "确认", "已确认", "结论"]
  return patterns.some((p) => text.includes(p))
}

const hasDisclaimer = (text: string) => {
  const patterns = ["建议", "计划", "打算", "推测", "可能", "我认为", "我猜", "不确定"]
  return patterns.some((p) => text.includes(p))
}

const readReport = async (root: string) => {
  const text = await Bun.file(root).text().catch(() => "")
  if (!text) return { ok: false as const, error: "report_empty" as const }
  const parsed = safeJson(text)
  if (!parsed.ok) return { ok: false as const, error: "report_invalid" as const }
  const report = VerificationReport.safeParse(parsed.value)
  if (!report.success) return { ok: false as const, error: "report_schema" as const }
  return { ok: true as const, value: report.data }
}

export const runSecureOutput = async (input: {
  sessionId: string
  messageId: string
  mode: z.infer<typeof Mode>
  budget: z.infer<typeof Budget>
  text: string
  ctx: Tool.Context
}): Promise<Result> => {
  const sessionId = z.string().min(1).parse(input.sessionId)
  const messageId = z.string().min(1).parse(input.messageId)
  const mode = Mode.parse(input.mode)
  const budget = Budget.parse(input.budget)
  const writer = await EvidenceWriter.open({ sessionId })

  const inputEntry = await writer.artifact({
    kind: "secure-output-input",
    path: `secure-output/${messageId}.input.json`,
    data: stableJson({ specVersion: "secure-output-input/1.0", sessionId, messageId, mode, budget }),
  })

  await writer.event({
    specVersion: "event/1.0",
    ts: new Date().toISOString(),
    sessionId,
    severity: "info",
    actor: "worker:secure_output",
    type: "secure_output.requested",
    summary: "输出门禁已启动",
    data: { mode, input_artifact: inputEntry.path },
    redaction: { applied: true, policyVersion: "v1" },
  })

  const stripped = stripClaims(input.text)
  if (!stripped.ok) {
    const reasons = [
      "未提供结构化断言块（assistant_claims_json），无法对事实断言做核验",
      looksCertain(input.text) ? "检测到确定性表述，但缺少 fact 断言与证据指针" : "",
    ].filter((x) => x)

    const errorEntry = await writer.artifact({
      kind: "secure-output-error",
      path: `secure-output/${messageId}.error.json`,
      data: stableJson({
        specVersion: "secure-output-error/1.0",
        code: stripped.error,
        reasons,
        input_artifact: inputEntry.path,
      }),
    })

    await writer.event({
      specVersion: "event/1.0",
      ts: new Date().toISOString(),
      sessionId,
      severity: "error",
      actor: "worker:secure_output",
      type: "protocol.violation",
      summary: "输出缺少可核验断言块",
      data: { code: stripped.error, artifact: errorEntry.path },
      redaction: { applied: true, policyVersion: "v1" },
    })

    await writer.event({
      specVersion: "event/1.0",
      ts: new Date().toISOString(),
      sessionId,
      severity: "warn",
      actor: "worker:secure_output",
      type: "secure_output.degraded",
      summary: "输出已降级",
      data: {
        mode,
        input_artifact: inputEntry.path,
        error_artifact: errorEntry.path,
        reason_codes: ["missing_claims_block"],
      },
      redaction: { applied: true, policyVersion: "v1" },
    })

    return { status: "degraded", text: input.text.trimEnd(), artifacts: [inputEntry.path, errorEntry.path] }
  }

  const parsed = safeJson(stripped.raw)
  if (!parsed.ok) {
    const reason = "断言块不是合法 JSON（无法解析）"
    const errorEntry = await writer.artifact({
      kind: "secure-output-error",
      path: `secure-output/${messageId}.error.json`,
      data: stableJson({ specVersion: "secure-output-error/1.0", code: "invalid_json", reason }),
    })

    await writer.event({
      specVersion: "event/1.0",
      ts: new Date().toISOString(),
      sessionId,
      severity: "error",
      actor: "worker:secure_output",
      type: "protocol.violation",
      summary: "输出断言块 JSON 解析失败",
      data: { code: "invalid_json", artifact: errorEntry.path },
      redaction: { applied: true, policyVersion: "v1" },
    })

    await writer.event({
      specVersion: "event/1.0",
      ts: new Date().toISOString(),
      sessionId,
      severity: "warn",
      actor: "worker:secure_output",
      type: "secure_output.degraded",
      summary: "输出已降级",
      data: { mode, input_artifact: inputEntry.path, error_artifact: errorEntry.path, reason_codes: ["invalid_json"] },
      redaction: { applied: true, policyVersion: "v1" },
    })

    return { status: "degraded", text: stripped.cleaned, artifacts: [inputEntry.path, errorEntry.path] }
  }

  const normalized = await normalizeClaimsPayload({
    sessionId,
    value: parsed.value,
  })
  const claims = AssistantClaims.safeParse(normalized.payload)
  if (!claims.success) {
    const reason = "断言块不符合 assistant-claims/1.0 协议（schema 校验失败）"
    const errorEntry = await writer.artifact({
      kind: "secure-output-error",
      path: `secure-output/${messageId}.error.json`,
      data: stableJson({
        specVersion: "secure-output-error/1.0",
        code: "schema_invalid",
        reason,
        normalized: normalized.adjusted,
        issues: claims.error.issues.map((i) => ({ path: i.path, message: i.message })),
      }),
    })

    await writer.event({
      specVersion: "event/1.0",
      ts: new Date().toISOString(),
      sessionId,
      severity: "error",
      actor: "worker:secure_output",
      type: "protocol.violation",
      summary: "输出断言块协议不合法",
      data: { code: "schema_invalid", artifact: errorEntry.path },
      redaction: { applied: true, policyVersion: "v1" },
    })

    await writer.event({
      specVersion: "event/1.0",
      ts: new Date().toISOString(),
      sessionId,
      severity: "warn",
      actor: "worker:secure_output",
      type: "secure_output.degraded",
      summary: "输出已降级",
      data: { mode, input_artifact: inputEntry.path, error_artifact: errorEntry.path, reason_codes: ["schema_invalid"] },
      redaction: { applied: true, policyVersion: "v1" },
    })

    return { status: "degraded", text: stripped.cleaned, artifacts: [inputEntry.path, errorEntry.path] }
  }

  const claimList = claims.data.claims
  const factList = claimList.filter((c) => c.kind === "fact")
  const nonfactList = claimList.filter((c) => c.kind !== "fact")

  const claimsEntry = await writer.artifact({
    kind: "secure-output-claims",
    path: `secure-output/${messageId}.claims.json`,
    data: stableJson(claims.data),
  })

  const cleaned = stripped.cleaned

  if (factList.length === 0) {
    if (nonfactList.length > 0 && !hasDisclaimer(cleaned)) {
      const reasons = ["存在计划/推测类断言，但用户可见文本未明确标注为建议/计划/推测"]
      await writer.event({
        specVersion: "event/1.0",
        ts: new Date().toISOString(),
        sessionId,
        severity: "warn",
        actor: "worker:secure_output",
        type: "secure_output.degraded",
        summary: "输出已降级",
        data: { mode, claims_artifact: claimsEntry.path, reason_codes: ["missing_disclaimer"] },
        redaction: { applied: true, policyVersion: "v1" },
      })
      return { status: "degraded", text: cleaned, artifacts: [inputEntry.path, claimsEntry.path] }
    }

    if (looksCertain(cleaned)) {
      const reasons = ["检测到可能的事实型表述，但断言块未标注任何 fact（疑似绕过核验）"]
      await writer.event({
        specVersion: "event/1.0",
        ts: new Date().toISOString(),
        sessionId,
        severity: "warn",
        actor: "worker:secure_output",
        type: "secure_output.degraded",
        summary: "输出已降级",
        data: { mode, claims_artifact: claimsEntry.path, reason_codes: ["classification_evasion"] },
        redaction: { applied: true, policyVersion: "v1" },
      })
      return { status: "degraded", text: cleaned, artifacts: [inputEntry.path, claimsEntry.path] }
    }

    await writer.event({
      specVersion: "event/1.0",
      ts: new Date().toISOString(),
      sessionId,
      severity: "info",
      actor: "worker:secure_output",
      type: "secure_output.completed",
      summary: "输出已通过门禁",
      data: { mode, claims_artifact: claimsEntry.path, input_artifact: inputEntry.path },
      redaction: { applied: true, policyVersion: "v1" },
    })

    return { status: "ok", text: cleaned, artifacts: [inputEntry.path, claimsEntry.path] }
  }

  const verify = await runVerification({
    taskFrame: { specVersion: "task-frame/1.0", sessionId, contextPackId: "unknown" },
    mode,
    budget,
    claims: factList.map((c) => ({ id: c.id, text: c.text, pointers: c.pointers })),
    ctx: input.ctx,
  })

  if (!verify.ok) {
    const report = await readReport(path.join(Instance.worktree, verify.reportPath))
    const reasons = (() => {
      if (!report.ok) return [verify.hint]
      const codes = report.value.claims.flatMap((c) => c.reasons ?? [])
      const base = [verify.hint, ...codes]
      const unique = Array.from(new Set(base.map((x) => x.trim()).filter(Boolean)))
      return unique.length > 0 ? unique : ["证据不足或核验未通过"]
    })()

    await writer.event({
      specVersion: "event/1.0",
      ts: new Date().toISOString(),
      sessionId,
      severity: "warn",
      actor: "worker:secure_output",
      type: "secure_output.degraded",
      summary: "事实断言未通过核验，输出已降级",
      data: {
        mode,
        input_artifact: inputEntry.path,
        claims_artifact: claimsEntry.path,
        verification_report_artifact: verify.reportPath,
        reason_codes: ["citations_required"],
      },
      redaction: { applied: true, policyVersion: "v1" },
    })

    return { status: "degraded", text: cleaned, artifacts: [inputEntry.path, claimsEntry.path, verify.reportPath] }
  }

  await writer.event({
    specVersion: "event/1.0",
    ts: new Date().toISOString(),
    sessionId,
    severity: "info",
    actor: "worker:secure_output",
    type: "secure_output.completed",
    summary: "事实断言已通过核验",
    data: {
      mode,
      input_artifact: inputEntry.path,
      claims_artifact: claimsEntry.path,
      verification_report_artifact: verify.reportPath,
      claims_normalized: normalized.adjusted,
    },
    redaction: { applied: true, policyVersion: "v1" },
  })

  return { status: "ok", text: cleaned, artifacts: [inputEntry.path, claimsEntry.path, verify.reportPath] }
}
