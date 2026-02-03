import path from "path"
import z from "zod"
import { Instance } from "@/project/instance"
import { stableJson } from "@/util/stable-json"
import { EvidenceWriter } from "@/evidence/writer"
import { AssistantClaims } from "@/protocol/assistant-claims"
import { runVerification } from "@/verification"
import { VerificationReport } from "@/protocol/verification-report"
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

const safeJson = (raw: string) => {
  try {
    return { ok: true as const, value: JSON.parse(raw) as unknown }
  } catch (error) {
    return { ok: false as const, error }
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

const join = (items: string[]) => items.filter(Boolean).join("；")

const degradeText = (input: { reasons: string[] }) => {
  const reasonText = join(input.reasons)
  const lines = [
    "为了避免把未核验内容当作事实输出，我已将相关结论降级为「未知/不支持」。",
    reasonText ? `原因：${reasonText}` : "原因：证据不足或输出不符合可核验协议。",
    "下一步：",
    "1) 补检索/补取证：生成可核验 pointers（path+sha256+anchor）；",
    "2) 或切换策略：strict/balanced 会强制核验；loose 允许推测但必须显式标注；",
    `3) 请让模型在回答末尾附带 ${openTag} ... ${closeTag} 的结构化断言块，以便核验。`,
  ]
  return lines.join("\n") + "\n"
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

    return { status: "degraded", text: degradeText({ reasons }), artifacts: [inputEntry.path, errorEntry.path] }
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

    return { status: "degraded", text: degradeText({ reasons: [reason] }), artifacts: [inputEntry.path, errorEntry.path] }
  }

  const claims = AssistantClaims.safeParse(parsed.value)
  if (!claims.success) {
    const reason = "断言块不符合 assistant-claims/1.0 协议（schema 校验失败）"
    const errorEntry = await writer.artifact({
      kind: "secure-output-error",
      path: `secure-output/${messageId}.error.json`,
      data: stableJson({
        specVersion: "secure-output-error/1.0",
        code: "schema_invalid",
        reason,
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

    return { status: "degraded", text: degradeText({ reasons: [reason] }), artifacts: [inputEntry.path, errorEntry.path] }
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
      return { status: "degraded", text: degradeText({ reasons }), artifacts: [inputEntry.path, claimsEntry.path] }
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
      return { status: "degraded", text: degradeText({ reasons }), artifacts: [inputEntry.path, claimsEntry.path] }
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

    return { status: "degraded", text: degradeText({ reasons }), artifacts: [inputEntry.path, claimsEntry.path, verify.reportPath] }
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
    },
    redaction: { applied: true, policyVersion: "v1" },
  })

  return { status: "ok", text: cleaned, artifacts: [inputEntry.path, claimsEntry.path, verify.reportPath] }
}
