import fs from "fs/promises"
import { EventV1 } from "@/protocol/event"
import { resolveTenantScope } from "@/util/tenant-context"

type RecordData = Record<string, unknown>

export type CitationPointer = {
  ref: string
  sha256?: string
}

type ClaimStatus = "pass" | "degrade" | "block"
type ClaimAction = "emit" | "unknown_first" | "ask_more_context"

type TurnGateDataInput = {
  messageId: string
  mode: "strict" | "balanced" | "loose"
  claimGate: {
    status: ClaimStatus
    action: ClaimAction
    reasons?: string[]
    unsupportedRate?: number
    conflictDensity?: number
  }
  dualPass: {
    enabled: boolean
    attempted: boolean
    fallback: boolean
    reason?: string
  }
  citations?: Array<string | { ref?: string; path?: string; sha256?: string }>
  features?: {
    highRisk: boolean
    requiresCitation: boolean
    dualPassCandidate: boolean
  }
}

export type TurnGateReplay = {
  messageId?: string
  mode?: string
  claimGate: {
    status: ClaimStatus
    action: ClaimAction
    reasons: string[]
    unsupportedRate?: number
    conflictDensity?: number
  }
  dualPass: {
    enabled: boolean
    attempted: boolean
    fallback: boolean
    reason?: string
  }
  citations: CitationPointer[]
  features: {
    highRisk: boolean
    requiresCitation: boolean
    dualPassCandidate: boolean
  }
}

const asRecord = (value: unknown): RecordData => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as RecordData
}

const asText = (value: unknown) => {
  if (typeof value !== "string") return undefined
  const text = value.trim()
  if (!text) return undefined
  return text
}

const asBoolean = (value: unknown) => value === true

const asNumber = (value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined
  return value
}

const asTexts = (value: unknown) => {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => asText(item))
    .filter((item): item is string => Boolean(item))
}

const citationFrom = (value: unknown): CitationPointer | undefined => {
  const text = asText(value)
  if (text) return { ref: text }

  const data = asRecord(value)
  const ref = asText(data.ref) ?? asText(data.path)
  if (!ref) return
  const sha256 = asText(data.sha256)
  if (!sha256) return { ref }
  return { ref, sha256 }
}

const dedupeCitations = (input: CitationPointer[]) => {
  const seen = new Set<string>()
  return input.filter((item) => {
    const key = `${item.ref}#${item.sha256 ?? ""}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const citationKeys = ["input_artifact", "claims_artifact", "verification_report_artifact", "error_artifact"] as const

const citationsFromData = (data: RecordData) => {
  const fromList = Array.isArray(data.citations)
    ? data.citations.map((item) => citationFrom(item)).filter((item): item is CitationPointer => Boolean(item))
    : []
  const fromArtifacts = citationKeys
    .map((key) => asText(data[key]))
    .filter((item): item is string => Boolean(item))
    .map((ref) => ({ ref }))
  return dedupeCitations([...fromList, ...fromArtifacts])
}

const parseStatus = (value: unknown, fallback?: ClaimStatus): ClaimStatus => {
  if (value === "pass" || value === "degrade" || value === "block") return value
  if (fallback) return fallback
  return "pass"
}

const parseAction = (value: unknown, status: ClaimStatus): ClaimAction => {
  if (value === "emit" || value === "unknown_first" || value === "ask_more_context") return value
  if (status === "pass") return "emit"
  if (status === "degrade") return "unknown_first"
  return "ask_more_context"
}

const replayFromEventData = (data: RecordData, fallback?: ClaimStatus): TurnGateReplay => {
  const reasons = asTexts(data.claim_gate_reasons)
  const fallbackReasons = reasons.length > 0 ? reasons : asTexts(data.reason_codes)
  const status = parseStatus(data.claim_gate_status, fallback)
  const action = parseAction(data.claim_gate_action, status)
  const enabled = asBoolean(data.dual_pass_enabled)
  const attempted = asBoolean(data.dual_pass_attempted) || enabled
  const defaultFallback = enabled && status !== "pass"
  const fallbackUsed = asBoolean(data.dual_pass_fallback) || defaultFallback

  return {
    messageId: asText(data.messageId),
    mode: asText(data.mode),
    claimGate: {
      status,
      action,
      reasons: fallbackReasons,
      unsupportedRate: asNumber(data.claim_gate_unsupported_rate),
      conflictDensity: asNumber(data.claim_gate_conflict_density),
    },
    dualPass: {
      enabled,
      attempted,
      fallback: fallbackUsed,
      reason: asText(data.dual_pass_reason),
    },
    citations: citationsFromData(data),
    features: {
      highRisk: asBoolean(data.feature_high_risk),
      requiresCitation: asBoolean(data.feature_requires_citation),
      dualPassCandidate: asBoolean(data.feature_dual_pass_candidate),
    },
  }
}

const normalizeTurnGateEvent = (event: EventV1): EventV1 => {
  if (event.type !== "turn.gate") return event
  const replay = replayTurnGateEvent(event)
  if (!replay) return event
  const data = {
    ...(event.data ?? {}),
    ...buildTurnGateEventData({
      messageId: replay.messageId ?? "unknown",
      mode: replay.mode === "strict" || replay.mode === "balanced" || replay.mode === "loose" ? replay.mode : "balanced",
      claimGate: {
        status: replay.claimGate.status,
        action: replay.claimGate.action,
        reasons: replay.claimGate.reasons,
        unsupportedRate: replay.claimGate.unsupportedRate,
        conflictDensity: replay.claimGate.conflictDensity,
      },
      dualPass: {
        enabled: replay.dualPass.enabled,
        attempted: replay.dualPass.attempted,
        fallback: replay.dualPass.fallback,
        reason: replay.dualPass.reason,
      },
      citations: replay.citations,
      features: replay.features,
    }),
  }
  return EventV1.parse({ ...event, data })
}

export const buildTurnGateEventData = (input: TurnGateDataInput) => {
  const reasons = Array.from(new Set((input.claimGate.reasons ?? []).map((item) => item.trim()).filter(Boolean)))
  const citations = dedupeCitations(
    (input.citations ?? [])
      .map((item) => citationFrom(item))
      .filter((item): item is CitationPointer => Boolean(item)),
  )
  return {
    messageId: input.messageId,
    mode: input.mode,
    claim_gate_status: input.claimGate.status,
    claim_gate_action: input.claimGate.action,
    claim_gate_reasons: reasons,
    reason_codes: reasons,
    claim_gate_unsupported_rate: input.claimGate.unsupportedRate,
    claim_gate_conflict_density: input.claimGate.conflictDensity,
    dual_pass_enabled: input.dualPass.enabled,
    dual_pass_attempted: input.dualPass.attempted,
    dual_pass_fallback: input.dualPass.fallback,
    dual_pass_reason: input.dualPass.reason,
    citations,
    feature_high_risk: input.features?.highRisk === true,
    feature_requires_citation: input.features?.requiresCitation === true,
    feature_dual_pass_candidate: input.features?.dualPassCandidate === true,
  } satisfies RecordData
}

export const replayTurnGateEvent = (event: unknown): TurnGateReplay | undefined => {
  const parsed = EventV1.safeParse(event)
  if (!parsed.success) return
  const data = asRecord(parsed.data.data)

  if (parsed.data.type === "turn.gate") {
    return replayFromEventData(data)
  }

  if (parsed.data.type === "secure_output.completed") {
    return replayFromEventData(data, "pass")
  }

  if (parsed.data.type === "secure_output.degraded") {
    return replayFromEventData(data, "degrade")
  }

  return
}

export const extractCitationPointersFromEvents = (events: unknown[]) => {
  return dedupeCitations(
    events
      .map((event) => replayTurnGateEvent(event))
      .filter((item): item is TurnGateReplay => Boolean(item))
      .flatMap((item) => item.citations),
  )
}

export async function appendEvent(file: string, input: unknown) {
  const parsed = EventV1.parse(input)
  const scope = resolveTenantScope({ tenantId: parsed.tenantId, orgId: parsed.orgId })
  const scoped = EventV1.parse({
    ...parsed,
    tenantId: parsed.tenantId ?? scope.tenantId,
    orgId: parsed.orgId ?? scope.orgId,
  })
  const data = normalizeTurnGateEvent(scoped)
  await fs.appendFile(file, JSON.stringify(data) + "\n")
  return data
}
