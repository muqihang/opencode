const Rule = [
  { code: "intent_citation", pattern: /(cite|citation|source|evidence|reference|proof|quote|引用|证据|来源|出处|指针|pointer)/i },
  { code: "intent_verify", pattern: /(verify|verification|fact\s*check|核验|验证|事实核查|对账|合规)/i },
  { code: "intent_resume", pattern: /(resume|续接包|续接)/i },
  { code: "intent_handoff", pattern: /(handoff|交接)/i },
  { code: "intent_summary", pattern: /(summary|report|summary\s+title|总结|摘要)/i },
  { code: "intent_audit", pattern: /(audit|审计|复盘|retrospective|postmortem)/i },
  { code: "intent_analysis", pattern: /(analysis|分析)/i },
] as const

export type VerificationMode = "strict" | "normal"

export type VerificationModeResolution = {
  mode: VerificationMode
  confidence: number
  reasonCodes: string[]
  intent: string
}

const uniq = (input: string[]) => Array.from(new Set(input))

const matchCodes = (text: string) =>
  Rule.filter((item) => item.pattern.test(text)).map((item) => item.code)

const confidence = (input: {
  strict: boolean
  feature: boolean
  matches: number
}) => {
  if (!input.strict) return 0.2
  if (input.feature && input.matches > 0) return 1
  if (input.feature) return 0.95
  return Math.min(0.9, 0.7 + input.matches * 0.05)
}

export const resolveVerificationMode = (input: {
  intentText: string
  hasVerificationIntent?: boolean
}): VerificationModeResolution => {
  const intent = input.intentText.trim()
  const feature = input.hasVerificationIntent === true
  const matched = matchCodes(intent)
  const strict = feature || matched.length > 0
  const mode = strict ? "strict" : "normal"
  const reasonCodes = strict
    ? uniq([...(feature ? ["orchestrator_verification_intent"] : []), ...matched])
    : ["intent_not_verification"]

  return {
    mode,
    confidence: confidence({ strict, feature, matches: matched.length }),
    reasonCodes,
    intent,
  }
}

