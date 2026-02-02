import path from "path"
import fs from "fs/promises"
import z from "zod"
import { EvidenceWriter } from "@/evidence/writer"
import { Instance } from "@/project/instance"
import { stableJson } from "@/util/stable-json"
import { TaskFrame } from "@/protocol/task-frame"
import {
  VerificationReport,
  VerificationMode,
  type VerificationClaim,
  type VerificationEvidence,
  type VerificationPointer,
  type VerificationReason,
} from "@/protocol/verification-report"
import { PythonTool } from "@/tool/python"
import type { Tool } from "@/tool/tool"

const Pointer = z
  .object({
    path: z.string().min(1),
    sha256: z.string().min(1).optional(),
    anchor: z.record(z.string(), z.unknown()).optional(),
    kind: z.string().min(1).optional(),
  })
  .strict()

const Quote = z
  .object({
    text: z.string().min(1),
    sourcePointer: Pointer,
  })
  .strict()

const Claim = z
  .object({
    id: z.string().min(1),
    text: z.string().min(1).optional(),
    pointers: z.array(Pointer),
    quote: Quote.optional(),
    table: z
      .object({
        cases: z.array(z.record(z.string(), z.unknown())),
      })
      .strict()
      .optional(),
  })
  .strict()

const Budget = z
  .object({
    timeMs: z.number().int().positive(),
    maxScripts: z.number().int().positive().optional(),
    maxInputBytes: z.number().int().positive().optional(),
  })
  .strict()

type Retrieval = {
  isAvailable: () => boolean
  run: (input: {
    taskFrame: z.infer<typeof TaskFrame>
    claims: z.infer<typeof Claim>[]
    pointers: z.infer<typeof Pointer>[]
    signal: AbortSignal
    budget: z.infer<typeof Budget>
  }) => Promise<{
    claims?: z.infer<typeof Claim>[]
    pointers?: z.infer<typeof Pointer>[]
    artifacts?: string[]
  }>
}

type VerificationInput = {
  taskFrame: z.infer<typeof TaskFrame>
  mode: z.infer<typeof VerificationMode>
  budget: z.infer<typeof Budget>
  claims: z.infer<typeof Claim>[]
  pointers?: z.infer<typeof Pointer>[]
  retrieval?: Retrieval
  signal?: AbortSignal
  ctx: Tool.Context
}

const baseDir = () => {
  if (Instance.worktree === "/") return Instance.directory
  return Instance.worktree
}

const nowIso = () => new Date().toISOString()

const makeKey = (pointer: VerificationPointer) => {
  return stableJson(pointer)
}

const sortReasons = (items: VerificationReason[]) => {
  return [...items].sort((left, right) => left.code.localeCompare(right.code))
}

const reason = (code: string, message: string): VerificationReason => ({ code, message })

const joinHints = (items: VerificationReason[]) => {
  const messages = items.map((item) => item.message).filter((message) => message)
  return messages.join("；")
}

const buildView = (report: z.infer<typeof VerificationReport>) => {
  const lines = [
    "# Verification Report",
    "",
    `Mode: ${report.mode}`,
    `OK: ${report.ok}`,
    `Degraded: ${report.degraded}`,
    `Incomplete: ${report.incomplete}`,
    "",
    `Claims: ${report.summary.totalClaims} (supported ${report.summary.supported}, unsupported ${report.summary.unsupported}, unknown ${report.summary.unknown})`,
    "",
  ]
  const claims = report.claims
  for (const claim of claims) {
    const text = claim.text ?? ""
    const line = `- ${claim.id}: ${claim.status} ${text}`.trim()
    lines.push(line)
  }
  lines.push("")
  return lines.join("\n") + "\n"
}

const safeJson = (text: string) => {
  try {
    return { ok: true as const, value: JSON.parse(text) }
  } catch (error) {
    return { ok: false as const, error }
  }
}

const scriptOutput = async (outputRel: string) => {
  const root = baseDir()
  const target = path.join(root, outputRel)
  const text = await Bun.file(target).text().catch(() => "")
  if (!text) return { ok: false as const, error: "output_empty" }
  const parsed = safeJson(text)
  if (!parsed.ok) return { ok: false as const, error: "output_invalid" }
  return { ok: true as const, value: parsed.value }
}

const countPointers = (claims: z.infer<typeof Claim>[], pointers?: z.infer<typeof Pointer>[]) => {
  if (pointers) return pointers.length
  const total = claims.reduce((sum, claim) => sum + claim.pointers.length, 0)
  return total
}

const combinePointers = (claims: z.infer<typeof Claim>[], pointers?: z.infer<typeof Pointer>[]) => {
  if (pointers) return pointers
  const list: z.infer<typeof Pointer>[] = []
  for (const claim of claims) {
    for (const pointer of claim.pointers) {
      list.push(pointer)
    }
  }
  return list
}

const sumBytes = async (root: string, pointers: z.infer<typeof Pointer>[]) => {
  const total = { value: 0 }
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`
  for (const pointer of pointers) {
    if (path.isAbsolute(pointer.path)) continue
    if (pointer.path.includes("..")) continue
    const target = path.resolve(root, pointer.path)
    if (!target.startsWith(prefix)) continue
    const stat = await fs.stat(target).catch(() => null)
    if (!stat) continue
    if (!stat.isFile()) continue
    total.value += stat.size
  }
  return total.value
}

export const runVerification = async (input: VerificationInput) => {
  const frame = TaskFrame.parse(input.taskFrame)
  const mode = VerificationMode.parse(input.mode)
  const budget = Budget.parse(input.budget)
  const claims = Claim.array().parse(input.claims)

  const verificationId = crypto.randomUUID()
  const budgetAbort = new AbortController()
  const timer = setTimeout(() => budgetAbort.abort(), budget.timeMs)
  const signal = AbortSignal.any([
    budgetAbort.signal,
    input.signal ?? AbortSignal.any([]),
    input.ctx.abort,
  ])
  const ctx = {
    sessionID: input.ctx.sessionID,
    messageID: input.ctx.messageID,
    callID: input.ctx.callID,
    agent: input.ctx.agent,
    abort: signal,
    metadata: input.ctx.metadata,
    ask: input.ctx.ask,
  }

  const writer = await EvidenceWriter.open({ sessionId: frame.sessionId })
  const pointerCount = countPointers(claims, input.pointers)
  const inputSnapshot = {
    verificationId,
    taskFrame: frame,
    mode,
    budget,
    claims,
    pointers: input.pointers ?? [],
    retrievalAvailable: input.retrieval ? input.retrieval.isAvailable() : false,
  }

  const inputEntry = await writer.artifact({
    kind: "verification-input",
    path: "verification/verification.input.json",
    data: stableJson(inputSnapshot),
  })

  await writer.event({
    specVersion: "event/1.0",
    ts: nowIso(),
    sessionId: frame.sessionId,
    severity: "info",
    actor: "worker:verification",
    type: "verification.requested",
    summary: "核验请求已接收",
    data: {
      verificationId,
      mode,
      budget,
      contextPackId: frame.contextPackId,
      input_artifact: inputEntry.path,
      summary: { totalClaims: claims.length, pointers: pointerCount },
    },
    redaction: { applied: true, policyVersion: "v1" },
  })

  const reasons: VerificationReason[] = []
  const reasonCodes = new Set<string>()
  const addReason = (item: VerificationReason) => {
    if (reasonCodes.has(item.code)) return
    reasonCodes.add(item.code)
    reasons.push(item)
  }
  const retrievalRecord = { attempted: false, pointers: [] as VerificationPointer[], artifacts: [] as string[] }
  const count = { scripts: 0 }
  const tool = await PythonTool.init()
  const start = Date.now()

  const remaining = () => {
    const elapsed = Date.now() - start
    const left = budget.timeMs - elapsed
    return left
  }

  const runTool = async (scriptId: string, payload: Record<string, unknown>, outputName: string) => {
    if (signal.aborted) {
      return { ok: false as const, error: "aborted" }
    }
    if (budget.maxScripts && count.scripts >= budget.maxScripts) {
      return { ok: false as const, error: "script_budget_exceeded" }
    }
    const timeLeft = remaining()
    if (timeLeft <= 0) {
      budgetAbort.abort()
      return { ok: false as const, error: "timeout" }
    }
    count.scripts += 1
    const executed = await tool
      .execute(
        {
          script_id: scriptId,
          input_json: payload,
          output_name: outputName,
          timeout: timeLeft,
          description: `verification ${scriptId}`,
        },
        ctx,
      )
      .then((value) => ({ ok: true as const, value }))
      .catch((error) => ({ ok: false as const, error }))
    if (!executed.ok) {
      return { ok: false as const, error: "script_throw" }
    }
    const result = executed.value
    if (result.metadata.exit !== 0) {
      return { ok: false as const, error: "script_failed", artifact: result.metadata.output_artifact }
    }
    const outputRel = result.metadata.output_artifact
    const parsed = await scriptOutput(outputRel)
    if (!parsed.ok) {
      return { ok: false as const, error: parsed.error, artifact: outputRel }
    }
    return { ok: true as const, value: parsed.value, artifact: outputRel }
  }

  const uniqueMessages = (items: string[]) => {
    const seen = new Set<string>()
    const list: string[] = []
    for (const item of items) {
      if (seen.has(item)) continue
      seen.add(item)
      list.push(item)
    }
    return list
  }

  type ClaimStatus = "supported" | "unsupported" | "unknown"

  const makeClaim = (
    claim: z.infer<typeof Claim>,
    status: ClaimStatus,
    evidence: VerificationEvidence[],
    messages: string[],
  ): VerificationClaim => {
    const item: VerificationClaim = { id: claim.id, status, evidence }
    if (claim.text) item.text = claim.text
    const list = uniqueMessages(messages)
    if (list.length > 0) item.reasons = list
    return item
  }

  const reasonForStatus = (status: string) => {
    if (status === "missing") return reason("missing_evidence", "证据文件缺失")
    if (status === "hash_mismatch") return reason("hash_mismatch", "证据哈希不一致")
    if (status === "anchor_invalid") return reason("anchor_invalid", "证据锚点无效")
    if (status === "invalid_path") return reason("invalid_path", "证据路径不合法")
    if (status === "unknown") return reason("unknown_evidence", "证据无法验证")
    return reason("unknown_evidence", "证据无法验证")
  }

  const staticCheck = async (claimList: z.infer<typeof Claim>[], pointers: z.infer<typeof Pointer>[]) => {
    const localReasons: VerificationReason[] = []
    const addLocalReason = (item: VerificationReason) => {
      if (localReasons.some((entry) => entry.code === item.code)) return
      localReasons.push(item)
    }

    const citation = await runTool(
      "citation-check",
      { specVersion: "citation-check/1.0", policyVersion: "v1", pointers },
      "verification.citation-check.json",
    )
    if (!citation.ok) {
      addLocalReason(reason("citation_unavailable", "引用校验不可用，无法完成核验"))
    }

    const quotes = claimList
      .map((claim) => claim.quote)
      .filter((value) => value)
      .map((value) => ({ text: value!.text, sourcePointer: value!.sourcePointer }))
    if (quotes.length > 0) {
      const quoteResult = await runTool(
        "doc-quote-anchor",
        { specVersion: "doc-quote-anchor/1.0", policyVersion: "v1", quotes, topK: 3 },
        "verification.doc-quote-anchor.json",
      )
      if (!quoteResult.ok) {
        addLocalReason(reason("quote_anchor_unavailable", "引用锚定不可用，无法完成核验"))
      }
    }

    const cases: Record<string, unknown>[] = []
    for (const claim of claimList) {
      const table = claim.table
      if (!table) continue
      for (const entry of table.cases) {
        const item: Record<string, unknown> = {}
        if (typeof entry.title === "string") item.title = entry.title
        if (!item.title) item.title = claim.id
        if (entry.inputs) item.inputs = entry.inputs
        if (entry.checks) item.checks = entry.checks
        cases.push(item)
      }
    }
    if (cases.length > 0) {
      const tableResult = await runTool(
        "table-check",
        { specVersion: "table-check/1.0", policyVersion: "v1", cases },
        "verification.table-check.json",
      )
      if (!tableResult.ok) {
        addLocalReason(reason("table_check_unavailable", "数值复算不可用，无法完成核验"))
      }
      if (tableResult.ok) {
        const summary = tableResult.value.summary
        if (summary && typeof summary.mismatches === "number" && summary.mismatches > 0) {
          addLocalReason(reason("table_mismatch", "数值复算存在不一致"))
        }
      }
    }

    const redaction = await runTool(
      "redaction-scan",
      { specVersion: "redaction-scan/1.0", policyVersion: "v1", pointers, rules: { pii: true, secrets: true } },
      "verification.redaction-scan.json",
    )
    if (!redaction.ok) {
      addLocalReason(reason("redaction_unavailable", "脱敏扫描不可用，无法完成核验"))
    }

    const statusMap = new Map<string, { status: string }>()
    if (citation.ok) {
      const items = citation.value.items
      if (Array.isArray(items)) {
        for (const item of items) {
          if (!item || typeof item !== "object") continue
          const pointer = (item as { pointer?: unknown }).pointer
          const status = (item as { status?: unknown }).status
          if (!pointer || typeof status !== "string") continue
          const parsed = Pointer.safeParse(pointer)
          if (!parsed.success) continue
          const key = makeKey(parsed.data)
          statusMap.set(key, { status })
        }
      }
    }

    const redactionHigh = (() => {
      if (!redaction.ok) return 0
      const summary = redaction.value.summary
      if (!summary || typeof summary.high !== "number") return 0
      return summary.high
    })()

    const list: VerificationClaim[] = []
    const summary = { totalClaims: 0, supported: 0, unsupported: 0, unknown: 0 }

    for (const claim of claimList) {
      summary.totalClaims += 1
      const evidence: VerificationEvidence[] = []
      const messages: string[] = []
      const statuses: string[] = []
      for (const pointer of claim.pointers) {
        const key = makeKey(pointer)
        const item = statusMap.get(key)
        const status = item ? item.status : "unknown"
        statuses.push(status)
        const reasonItem = reasonForStatus(status)
        if (status !== "ok") messages.push(reasonItem.message)
        const evidenceItem: VerificationEvidence = { pointer, status, tool: "citation-check" }
        if (status !== "ok") evidenceItem.reasons = [reasonItem.message]
        evidence.push(evidenceItem)
      }

      if (claim.pointers.length === 0) {
        messages.push("未提供证据指针")
        statuses.push("unknown")
      }

      const hasUnsupported = statuses.some((value) =>
        value === "missing" || value === "hash_mismatch" || value === "anchor_invalid" || value === "invalid_path",
      )
      const hasUnknown = statuses.some((value) => value === "unknown")

      if (hasUnsupported) {
        summary.unsupported += 1
        list.push(makeClaim(claim, "unsupported", evidence, messages))
        continue
      }
      if (hasUnknown) {
        summary.unknown += 1
        list.push(makeClaim(claim, "unknown", evidence, messages))
        continue
      }
      summary.supported += 1
      list.push(makeClaim(claim, "supported", evidence, messages))
    }

    if (redactionHigh > 0) {
      addLocalReason(reason("redaction_high", "检测到高风险敏感信息"))
    }

    return { claims: list, summary, redactionHigh, reasons: localReasons }
  }

  const claimBox = { value: claims }
  const pointerBox = { value: combinePointers(claims, input.pointers) }
  const gate = {
    skip: false,
    summary: { totalClaims: 0, supported: 0, unsupported: 0, unknown: 0 },
    claims: [] as VerificationClaim[],
  }

  if (budget.maxInputBytes) {
    const root = path.join(baseDir(), ".opencode", "artifacts", frame.sessionId)
    const size = await sumBytes(root, pointerBox.value)
    if (size > budget.maxInputBytes) {
      gate.skip = true
      addReason(reason("input_too_large", "输入规模超过预算，无法完成核验"))
      gate.summary.totalClaims = claimBox.value.length
      gate.summary.unknown = claimBox.value.length
      const note = "输入规模超过预算"
      for (const claim of claimBox.value) {
        const evidence = claim.pointers.map((pointer) => ({
          pointer,
          status: "unknown",
          tool: "citation-check",
          reasons: [note],
        }))
        gate.claims.push(makeClaim(claim, "unknown", evidence, [note]))
      }
    }
  }

  const retrieval = input.retrieval
  const canRetrieve = mode === "balanced" && retrieval ? retrieval.isAvailable() : false
  if (mode === "balanced" && !canRetrieve) {
    addReason(reason("retrieval_unavailable", "未启用补检索，仅对现有证据做静态校验"))
  }

  const finalCheck = await (async () => {
    if (gate.skip) {
      return { claims: gate.claims, summary: gate.summary, redactionHigh: 0, reasons: [] as VerificationReason[] }
    }
    const baseCheck = await staticCheck(claimBox.value, pointerBox.value)
    for (const item of baseCheck.reasons) addReason(item)
    if (!canRetrieve || !retrieval) return baseCheck
    if (signal.aborted) return baseCheck
    retrievalRecord.attempted = true
    const retrievalRun = await retrieval
      .run({
        taskFrame: frame,
        claims: claimBox.value,
        pointers: pointerBox.value,
        signal,
        budget,
      })
      .then((value) => ({ ok: true as const, value }))
      .catch((error) => ({ ok: false as const, error }))
    if (!retrievalRun.ok) {
      addReason(reason("retrieval_failed", "补检索失败，无法完成核验"))
      return baseCheck
    }
    const newClaims = retrievalRun.value.claims
    const newPointers = retrievalRun.value.pointers
    retrievalRecord.pointers = newPointers ?? []
    retrievalRecord.artifacts = retrievalRun.value.artifacts ?? []
    if (newClaims) claimBox.value = Claim.array().parse(newClaims)
    if (newPointers) pointerBox.value = Pointer.array().parse(newPointers)
    const afterCheck = await staticCheck(claimBox.value, pointerBox.value)
    for (const item of afterCheck.reasons) addReason(item)
    return afterCheck
  })()

  const summary = finalCheck.summary
  const incomplete = signal.aborted
  if (incomplete) {
    if (budgetAbort.signal.aborted) {
      addReason(reason("timeout", "核验超时，结果可能不完整"))
    }
    if (!budgetAbort.signal.aborted) {
      addReason(reason("cancelled", "核验已取消，结果可能不完整"))
    }
  }

  const hasReason = (code: string) => reasons.some((item) => item.code === code)
  const ok = summary.totalClaims === summary.supported && !hasReason("redaction_high") && !hasReason("table_mismatch")
  const degraded =
    incomplete ||
    reasons.some(
      (item) =>
        item.code.endsWith("_unavailable") ||
        item.code === "retrieval_unavailable" ||
        item.code === "retrieval_failed" ||
        item.code === "input_too_large",
    )

  const sortedReasons = sortReasons(reasons)
  const hint = joinHints(sortedReasons)
  const hintText = hint || (degraded ? "核验降级" : ok ? "核验完成" : "核验完成（未通过）")

  const report = {
    specVersion: "verification-report/1.0",
    verificationId,
    mode,
    contextPackId: frame.contextPackId,
    ok,
    degraded,
    incomplete,
    summary,
    reasons: sortedReasons,
    claims: finalCheck.claims,
    retrieval:
      retrievalRecord.attempted || retrievalRecord.pointers.length > 0 || retrievalRecord.artifacts.length > 0
        ? retrievalRecord
        : undefined,
  }

  const view = buildView(report)
  const reportEntry = await writer.artifact({
    kind: "verification-report",
    path: "verification/verification.report.json",
    data: stableJson(report),
  })
  const viewEntry = await writer.artifact({
    kind: "verification-view",
    path: "verification/verification.report.view.md",
    data: view,
  })

  clearTimeout(timer)

  const eventBase = {
    verificationId,
    mode,
    budget,
    contextPackId: frame.contextPackId,
    input_artifact: inputEntry.path,
    report_artifact: reportEntry.path,
    view_artifact: viewEntry.path,
    summary,
  }

  if (budgetAbort.signal.aborted) {
    await writer.event({
      specVersion: "event/1.0",
      ts: nowIso(),
      sessionId: frame.sessionId,
      severity: "error",
      actor: "worker:verification",
      type: "verification.timeout",
      summary: "核验超时",
      data: { ...eventBase, hint: hintText },
      redaction: { applied: true, policyVersion: "v1" },
    })
    return { ok: false, degraded: true, verificationId, hint: hintText, reportPath: reportEntry.path, viewPath: viewEntry.path }
  }

  if (signal.aborted) {
    await writer.event({
      specVersion: "event/1.0",
      ts: nowIso(),
      sessionId: frame.sessionId,
      severity: "warn",
      actor: "worker:verification",
      type: "verification.cancelled",
      summary: "核验已取消",
      data: { ...eventBase, hint: hintText },
      redaction: { applied: true, policyVersion: "v1" },
    })
    return { ok: false, degraded: true, verificationId, hint: hintText, reportPath: reportEntry.path, viewPath: viewEntry.path }
  }

  if (degraded) {
    await writer.event({
      specVersion: "event/1.0",
      ts: nowIso(),
      sessionId: frame.sessionId,
      severity: "warn",
      actor: "worker:verification",
      type: "verification.degraded",
      summary: "核验降级",
      data: { ...eventBase, hint: hintText },
      redaction: { applied: true, policyVersion: "v1" },
    })
    return { ok, degraded: true, verificationId, hint: hintText, reportPath: reportEntry.path, viewPath: viewEntry.path }
  }

  await writer.event({
    specVersion: "event/1.0",
    ts: nowIso(),
    sessionId: frame.sessionId,
    severity: ok ? "info" : "warn",
    actor: "worker:verification",
    type: "verification.completed",
    summary: ok ? "核验完成" : "核验完成（未通过）",
    data: { ...eventBase, hint: hintText },
    redaction: { applied: true, policyVersion: "v1" },
  })

  return { ok, degraded: false, verificationId, hint: hintText, reportPath: reportEntry.path, viewPath: viewEntry.path }
}
