import path from "path"
import {
  resolveEscalatedVerificationMode,
  resolveVerificationMode,
  type VerificationModeResolution,
} from "./verification-mode"

export const strictReferenceFailClosedText = "unknown/evidence_insufficient"

const evidenceBlock = /\[evidence:\s*([^\]]*)\]/gi
const inlineRef = /(?:^|[\s(（\[])([^\s\]）,;，；!?！？]+:\d+(?:-\d+)?)(?=$|[\s)）\].,;，；!?！？])/g
const refShape = /^([^:\s]+):(\d+)(?:-(\d+))?$/
const highRiskPattern = /(final\s+decision|final\s+verdict|guarantee|certain|definitive|must|绝对|必须|保证|最终结论)/i

type Ref = {
  path: string
  lineStart: number
  lineEnd: number
  raw: string
}

type Parsed =
  | {
      ok: true
      ref: Ref
    }
  | {
      ok: false
      reasonCode: string
    }

export type StrictReferenceCheckResult = {
  ok: boolean
  reasonCodes: string[]
  refs: Ref[]
}

export type StrictReferenceApplyResult = {
  applied: boolean
  blocked: boolean
  text: string
  reasonCodes: string[]
  refs: Ref[]
  modeResolved: VerificationModeResolution
}

const trim = (value: string) =>
  value
    .trim()
    .replace(/^[\[\](){}<>"'`]+/, "")
    .replace(/[\[\](){}<>"'`.,;:!?，。；！？]+$/, "")
    .trim()

const hasTraversal = (value: string) => {
  const normalized = value.replace(/\\/g, "/")
  return normalized.split("/").includes("..")
}

const isCurrentSessionUserPath = (input: { path: string; sessionId: string }) => {
  const p = input.path.replace(/\\/g, "/").toLowerCase()
  const sessionId = input.sessionId.trim().toLowerCase()
  if (!sessionId) return false
  const hasSession = p.includes(sessionId)
  if (!hasSession) return false
  const hasUserMessage =
    p.includes("/messages/user") ||
    p.includes("/message/user") ||
    p.includes("user-message") ||
    p.endsWith("/user.md") ||
    p.endsWith("/user.txt")
  return hasUserMessage
}

const uniq = (input: string[]) => Array.from(new Set(input))

const listBlockTokens = (text: string) =>
  Array.from(text.matchAll(evidenceBlock)).flatMap((match) =>
    (match[1] ?? "")
      .split(/[\s,，]+/)
      .map(trim)
      .filter((item) => item.length > 0),
  )

const listInlineRefs = (text: string) =>
  Array.from(text.matchAll(inlineRef))
    .map((match) => trim(match[1] ?? ""))
    .filter((item) => item.length > 0)

const riskSignals = (text: string) => {
  const refs = uniq([...listBlockTokens(text), ...listInlineRefs(text)])
  const evidenceHeavy = refs.length > 0
  const highRisk = highRiskPattern.test(text)
  const signals = [
    ...(highRisk ? ["high_risk"] : []),
    ...(evidenceHeavy ? ["evidence_heavy"] : []),
  ]
  const confidence = highRisk && evidenceHeavy ? 0.95 : evidenceHeavy ? 0.75 : highRisk ? 0.65 : 0
  return {
    signals,
    confidence,
  }
}

const parseRef = (input: { token: string; sessionId: string }): Parsed => {
  const token = trim(input.token)
  const lower = token.toLowerCase()
  if (!token) return { ok: false, reasonCode: "invalid_reference_format" }
  if (lower === "unknown") return { ok: false, reasonCode: "unknown_reference" }
  if (token.includes("*")) return { ok: false, reasonCode: "wildcard_reference" }
  const match = token.match(refShape)
  if (!match) return { ok: false, reasonCode: "invalid_reference_format" }
  const rel = match[1] ?? ""
  const lineStart = Number(match[2])
  const lineEnd = Number(match[3] ?? match[2])
  if (!Number.isInteger(lineStart) || !Number.isInteger(lineEnd) || lineStart <= 0 || lineEnd <= 0 || lineEnd < lineStart) {
    return { ok: false, reasonCode: "invalid_line_range" }
  }
  if (isCurrentSessionUserPath({ path: rel, sessionId: input.sessionId })) {
    return { ok: false, reasonCode: "current_session_user_message" }
  }
  return {
    ok: true,
    ref: {
      path: rel,
      lineStart,
      lineEnd,
      raw: token,
    },
  }
}

const resolveTarget = (input: { baseDir: string; rel: string }) => {
  if (hasTraversal(input.rel)) return undefined
  const root = path.resolve(input.baseDir)
  const target = path.isAbsolute(input.rel) ? path.resolve(input.rel) : path.resolve(root, input.rel)
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`
  if (target !== root && !target.startsWith(prefix)) return undefined
  return target
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

const validateRef = async (input: { ref: Ref; baseDir: string }) => {
  const target = resolveTarget({ baseDir: input.baseDir, rel: input.ref.path })
  if (!target) return { ok: false as const, reasonCode: "path_outside_workspace" }
  const total = await readLineCount(target)
  if (total === undefined) return { ok: false as const, reasonCode: "path_not_found" }
  if (input.ref.lineEnd > total) return { ok: false as const, reasonCode: "line_out_of_range" }
  return { ok: true as const }
}

export const hasStrictReferenceIntent = (input: {
  intentText: string
  hasVerificationIntent?: boolean
}) => resolveVerificationMode(input).mode === "strict"

export const runStrictReferenceCheck = async (input: {
  text: string
  baseDir: string
  sessionId: string
}): Promise<StrictReferenceCheckResult> => {
  const refs = uniq([...listBlockTokens(input.text), ...listInlineRefs(input.text)])
  if (refs.length === 0) {
    return {
      ok: false,
      reasonCodes: ["evidence_missing"],
      refs: [],
    }
  }

  const parsed = refs.map((token) => parseRef({ token, sessionId: input.sessionId }))
  const parseCodes = parsed.flatMap((item) => (item.ok ? [] : [item.reasonCode]))
  const list = parsed.flatMap((item) => (item.ok ? [item.ref] : []))
  const checks = await Promise.all(list.map((ref) => validateRef({ ref, baseDir: input.baseDir })))
  const checkCodes = checks.flatMap((item) => (item.ok ? [] : [item.reasonCode]))
  const reasonCodes = uniq([...parseCodes, ...checkCodes])
  return {
    ok: reasonCodes.length === 0,
    reasonCodes,
    refs: list,
  }
}

export const applyStrictReferenceCheck = async (input: {
  intentText: string
  text: string
  baseDir: string
  sessionId: string
  hasVerificationIntent?: boolean
  modeResolved?: VerificationModeResolution
}): Promise<StrictReferenceApplyResult> => {
  const modeBase =
    input.modeResolved ??
    resolveVerificationMode({
      intentText: input.intentText,
      hasVerificationIntent: input.hasVerificationIntent,
    })
  const risk = riskSignals(input.text)
  const modeResolved = resolveEscalatedVerificationMode({
    ...modeBase,
    confidence: Math.max(modeBase.confidence, risk.confidence),
    reasonCodes: uniq([...modeBase.reasonCodes, ...risk.signals]),
  })
  const applied = modeResolved.mode === "strict"
  if (!applied) {
    return {
      applied,
      blocked: false,
      text: input.text,
      reasonCodes: [],
      refs: [],
      modeResolved,
    }
  }

  const checked = await runStrictReferenceCheck({
    text: input.text,
    baseDir: input.baseDir,
    sessionId: input.sessionId,
  })
  if (checked.ok) {
    return {
      applied,
      blocked: false,
      text: input.text,
      reasonCodes: [],
      refs: checked.refs,
      modeResolved,
    }
  }

  return {
    applied,
    blocked: true,
    text: strictReferenceFailClosedText,
    reasonCodes: checked.reasonCodes,
    refs: checked.refs,
    modeResolved,
  }
}
