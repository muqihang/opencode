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
const inlineRef = /(?:^|[\s(（\[])([^\s\]）,;，；!?！？。]+:\d+(?:-\d+)?)(?=$|[\s)）\].,;，；!?！？。])/g
const refShape = /^([^:\s]+):(\d+)(?:-(\d+))?$/

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
const normalizePath = (value: string) => value.replace(/\\/g, "/").replace(/^\.\//, "")

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

const normalizeAnchorObject = (value: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (typeof item !== "string") return [key, item]
      return [key, parseAnchorPiece(item)]
    }),
  )

const normalizeAnchor = (value: unknown) => {
  const obj = record(value)
  if (obj) return normalizeAnchorObject(obj)
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
  return undefined
}

const resolvePointerRoots = (sessionId: string) => {
  const scope = resolveTenantScope()
  const roots = artifactCandidates({
    base: baseDir(),
    sessionId,
    tenantId: scope.tenantId,
    orgId: scope.orgId,
  })
  return Array.from(new Set([baseDir(), ...roots]))
}

const normalizePointer = async (value: unknown, roots: string[]) => {
  const item = record(value)
  if (!item) return undefined
  const path = normalizePath(text(item.path) ?? "")
  const safe = roots.some((root) => Boolean(safePointerTarget(root, path)))
  if (!safe) return { path }
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
  const roots = resolvePointerRoots(input.sessionId)

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

type ParsedRef = {
  path: string
  lineStart: number
  lineEnd: number
  raw: string
}

const trimRefToken = (value: string) =>
  value
    .trim()
    .replace(/^[\[\](){}<>"'`]+/, "")
    .replace(/[\[\](){}<>"'`.,;:!?，。；！？]+$/, "")
    .trim()

const isCurrentSessionUserPath = (input: { path: string; sessionId: string }) => {
  const path = input.path.replace(/\\/g, "/").toLowerCase()
  const sessionId = input.sessionId.trim().toLowerCase()
  if (!sessionId) return false
  const hasSession = path.includes(sessionId)
  if (!hasSession) return false
  const hasUserMessage =
    path.includes("/messages/user") ||
    path.includes("/message/user") ||
    path.includes("user-message") ||
    path.endsWith("/user.md") ||
    path.endsWith("/user.txt")
  return hasUserMessage
}

const listInlineRefs = (input: string) =>
  Array.from(input.matchAll(inlineRef))
    .map((item) => trimRefToken(item[1] ?? ""))
    .filter((item) => item.length > 0)

const parseRefToken = (input: { token: string; sessionId: string }): ParsedRef | undefined => {
  const match = input.token.match(refShape)
  if (!match) return
  const path = normalizePath(match[1] ?? "")
  const lineStart = Number(match[2])
  const lineEnd = Number(match[3] ?? match[2])
  if (!path) return
  if (path.toLowerCase() === "unknown") return
  if (path.includes("*")) return
  if (isCurrentSessionUserPath({ path, sessionId: input.sessionId })) return
  if (!Number.isInteger(lineStart) || !Number.isInteger(lineEnd)) return
  if (lineStart <= 0 || lineEnd <= 0 || lineEnd < lineStart) return
  return {
    path,
    lineStart,
    lineEnd,
    raw: input.token,
  }
}

const lineCount = (text: string) => {
  if (!text) return 1
  return text.split(/\r?\n/).length
}

const readLineCount = async (target: string) => {
  const file = Bun.file(target)
  const exists = await file.exists().catch(() => false)
  if (!exists) return undefined
  const text = await file.text().catch(() => undefined)
  if (text === undefined) return undefined
  return lineCount(text)
}

const refGrounded = async (input: {
  roots: string[]
  ref: ParsedRef
}) => {
  const checks = await Promise.all(
    input.roots.map(async (root) => {
      const target = safePointerTarget(root, input.ref.path)
      if (!target) return false
      const total = await readLineCount(target)
      if (total === undefined) return false
      return input.ref.lineEnd <= total
    }),
  )
  return checks.some((item) => item)
}

const draftClaimsPayload = async (input: {
  sessionId: string
  text: string
}) => {
  const refs = listInlineRefs(input.text)
    .map((token) => parseRefToken({ token, sessionId: input.sessionId }))
    .flatMap((item) => (item ? [item] : []))
  if (refs.length === 0) return

  const roots = resolvePointerRoots(input.sessionId)
  const uniqueRefs = refs.filter((item, index, list) => {
    const key = `${item.path}:${item.lineStart}:${item.lineEnd}`
    const first = list.findIndex((entry) => `${entry.path}:${entry.lineStart}:${entry.lineEnd}` === key)
    return first === index
  })

  const claims = (
    await Promise.all(
      uniqueRefs.map(async (item, index) => {
        const grounded = await refGrounded({ roots, ref: item })
        if (!grounded) return undefined
        const safe = roots.some((root) => Boolean(safePointerTarget(root, item.path)))
        if (!safe) return undefined
        const sha256 = await completePointerSha({ roots, rel: item.path })
        if (!sha256) return undefined
        return {
          id: `c${index + 1}`,
          kind: "fact",
          text: `auto-drafted reference ${item.raw}`,
          pointers: [
            {
              path: item.path,
              sha256,
              anchor: `lineStart:${item.lineStart},lineEnd:${item.lineEnd}`,
            },
          ],
        }
      }),
    )
  ).flatMap((item) => (item ? [item] : []))

  if (claims.length === 0) return
  return {
    specVersion: "assistant-claims/1.0",
    policyVersion: "v1",
    claims,
  }
}

const buildReferenceFeedback = (report: Awaited<ReturnType<typeof readReport>>) => {
  if (!report.ok) {
    return {
      invalidRefsCount: 0,
      reasonCodes: ["reference_check_unavailable"],
    }
  }

  const invalid = new Set(["missing", "hash_mismatch", "anchor_invalid", "invalid_path"])
  const statuses = report.value.claims.flatMap((claim) =>
    claim.evidence
      .map((evidence) => evidence.status ?? "")
      .filter((status) => invalid.has(status)),
  )
  const reasonCodes = Array.from(
    new Set([...statuses, ...report.value.reasons.map((reason) => reason.code), ...report.value.claims.flatMap((claim) => claim.reasons ?? [])]),
  )

  return {
    invalidRefsCount: statuses.length,
    reasonCodes,
  }
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
  const drafted = !stripped.ok && mode === "strict" ? await draftClaimsPayload({ sessionId, text: input.text }) : undefined
  const cleaned = stripped.ok ? stripped.cleaned : input.text.trimEnd()

  if (!stripped.ok && !drafted) {
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

    return { status: "degraded", text: cleaned, artifacts: [inputEntry.path, errorEntry.path] }
  }

  if (drafted) {
    await writer.event({
      specVersion: "event/1.0",
      ts: new Date().toISOString(),
      sessionId,
      severity: "info",
      actor: "worker:secure_output",
      type: "secure_output.claims_drafted",
      summary: "strict 模式已从可见文本自动生成最小 claims 草稿",
      data: {
        mode,
        input_artifact: inputEntry.path,
        claim_count: drafted.claims.length,
        reason_codes: ["claims_auto_drafted"],
      },
      redaction: { applied: true, policyVersion: "v1" },
    })
  }

  const parsed = stripped.ok ? safeJson(stripped.raw) : { ok: true as const, value: drafted }
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

    return { status: "degraded", text: cleaned, artifacts: [inputEntry.path, errorEntry.path] }
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

    return { status: "degraded", text: cleaned, artifacts: [inputEntry.path, errorEntry.path] }
  }

  const claimList = claims.data.claims
  const factList = claimList.filter((c) => c.kind === "fact")
  const nonfactList = claimList.filter((c) => c.kind !== "fact")

  const claimsEntry = await writer.artifact({
    kind: "secure-output-claims",
    path: `secure-output/${messageId}.claims.json`,
    data: stableJson(claims.data),
  })

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
    const feedback = buildReferenceFeedback(report)
    const reasonCodes = Array.from(new Set([verify.hint, ...feedback.reasonCodes].map((item) => item.trim()).filter(Boolean)))
    const fallbackCodes = reasonCodes.length > 0 ? reasonCodes : ["citations_required"]

    const feedbackEntry = await writer.artifact({
      kind: "secure-output-reference-check",
      path: `secure-output/${messageId}.reference-check.json`,
      data: stableJson({
        specVersion: "secure-output-reference-check/1.0",
        mode,
        messageId,
        verification_report_artifact: verify.reportPath,
        invalid_refs_count: feedback.invalidRefsCount,
        reason_codes: fallbackCodes,
      }),
    })

    await writer.event({
      specVersion: "event/1.0",
      ts: new Date().toISOString(),
      sessionId,
      severity: "warn",
      actor: "worker:secure_output",
      type: "reference_check.feedback",
      summary: "reference-check 输出已结构化落盘",
      data: {
        mode,
        messageId,
        verification_report_artifact: verify.reportPath,
        reference_check_artifact: feedbackEntry.path,
        invalid_refs_count: feedback.invalidRefsCount,
        reason_codes: fallbackCodes,
      },
      redaction: { applied: true, policyVersion: "v1" },
    })

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
        reference_check_artifact: feedbackEntry.path,
        invalid_refs_count: feedback.invalidRefsCount,
        reason_codes: fallbackCodes,
      },
      redaction: { applied: true, policyVersion: "v1" },
    })

    return { status: "degraded", text: cleaned, artifacts: [inputEntry.path, claimsEntry.path, verify.reportPath, feedbackEntry.path] }
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
