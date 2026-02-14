import { stableJson } from "@/util/stable-json"
import { resolveVerificationMode } from "./verification-mode"

const seedPattern = /path=([^\s]+)\s+sha=([a-fA-F0-9]{64})(?:\s+anchor_json=(\{.+\}))?/

export type ClaimsSeedPointer = {
  path: string
  sha256: string
  anchor?: Record<string, unknown>
}

const strict = [
  "<secure_output_contract>",
  "After your natural-language answer, append a structured claims block:",
  "- Wrap JSON with <assistant_claims_json> and </assistant_claims_json>.",
  "- JSON MUST conform to assistant-claims/1.0.",
  "- Root fields are REQUIRED: specVersion, policyVersion, claims.",
  "- Use claim kinds: fact | plan | opinion.",
  "- Each claim MUST include: id, kind, text, pointers.",
  "- Do NOT use `statement`; use `text`.",
  "- fact claims MUST include pointers with path + sha256 + anchor.",
  "- pointer.anchor MUST be a JSON object (example: {\"lineStart\": 9, \"lineEnd\": 10}).",
  "- Never emit anchor as a string (example of invalid: \"lineStart:9,lineEnd:10\").",
  "- If you cannot provide verifiable pointers for a fact, do NOT present it as certain. Mark it as opinion and explicitly say it is uncertain in the user-visible text.",
  "- Do NOT mislabel facts as opinion to bypass citations. If unsure, say unknown/uncertain.",
  "</secure_output_contract>",
].join("\n")

const light = [
  "<secure_output_contract_light>",
  "Respond in natural language and keep uncertain statements explicit.",
  "When evidence is insufficient, say unknown/evidence_insufficient.",
  "Only append strict claims schema when verification-style intent requires it.",
  "</secure_output_contract_light>",
].join("\n")

const safeJson = (value: string) => {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

const parseSeedPointer = (input: string): ClaimsSeedPointer | undefined => {
  const match = input.match(seedPattern)
  if (!match) return
  const path = match[1]?.trim() ?? ""
  const sha256 = (match[2] ?? "").toLowerCase()
  if (!path) return
  if (!sha256) return
  const parsedAnchor = match[3] ? safeJson(match[3]) : undefined
  const anchor = parsedAnchor && typeof parsedAnchor === "object" && !Array.isArray(parsedAnchor)
    ? (parsedAnchor as Record<string, unknown>)
    : undefined
  return {
    path,
    sha256,
    ...(anchor ? { anchor } : {}),
  }
}

export const parseClaimsSeedPointers = (input: string[]) => {
  const seen = new Set<string>()
  return input
    .map((item) => parseSeedPointer(item))
    .flatMap((item) => {
      if (!item) return [] as ClaimsSeedPointer[]
      const key = `${item.path}:${item.sha256}:${stableJson(item.anchor ?? {})}`
      if (seen.has(key)) return [] as ClaimsSeedPointer[]
      seen.add(key)
      return [item]
    })
}

export const resolveSecureOutputContract = (input: {
  intentText: string
  hasVerificationIntent?: boolean
}) => {
  const mode = resolveVerificationMode({
    intentText: input.intentText,
    hasVerificationIntent: input.hasVerificationIntent,
  })
  if (mode.mode === "strict") return strict
  return light
}

export const buildClaimsSeed = (input: {
  strict: boolean
  pointers: ClaimsSeedPointer[]
}) => {
  if (!input.strict) return ""
  if (input.pointers.length === 0) return ""

  const pointers = input.pointers.slice(0, 6)
  const digest = pointers.map(
    (item, index) =>
      `- [S${index + 1}] path=${item.path} sha=${item.sha256} anchor_json=${stableJson(item.anchor ?? { lineStart: 1, lineEnd: 1 })}`,
  )
  const sample = stableJson({
    specVersion: "assistant-claims/1.0",
    policyVersion: "v1",
    claims: [
      {
        id: "c1",
        kind: "fact",
        text: "replace with grounded statement",
        pointers: [{ path: pointers[0]?.path ?? "", sha256: pointers[0]?.sha256 ?? "", anchor: pointers[0]?.anchor ?? { lineStart: 1, lineEnd: 1 } }],
      },
    ],
  })

  return [
    "<claims_seed>",
    "Use these verified pointers first when composing strict fact claims:",
    ...digest,
    "schema_sample:",
    sample,
    "</claims_seed>",
  ].join("\n")
}

export const SecureOutputContract = {
  specVersion: "secure-output-contract/1.1",
  light,
  strict,
  text: strict,
}
