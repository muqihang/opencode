import type { OrchestratorMode, OrchestratorPlanScores, OrchestratorUxMode } from "@/protocol/orchestrator-plan"

export type ScorerInput = {
  uxMode: OrchestratorUxMode
  intentText: string
  intentTokensEstimate: number
  hasFileParts: boolean
  hasWriteIntent: boolean
  hasExecIntent: boolean
  hasVerificationIntent: boolean
}

type ScoredMode = Extract<OrchestratorMode, "chat" | "assist" | "heavy">

const StepPattern =
  /(步骤|step|phase|流程|先.+再|然后|并且|方案|strategy|plan|multi[_\s-]*step|回滚|迁移)/i

const RulePattern =
  /(必须|严格|约束|不得|至少|确保|要求|constraint|requirement|must|guardrail|policy)/i

const RiskPattern =
  /(legal|law|medical|finance|tax|audit|compliance|regulat|security|privacy|法律|法条|医疗|医嘱|财务|税务|审计|合规|监管|生产|线上|隐私|安全)/i

const DangerPattern =
  /(delete|drop|truncate|migration|rollback|deploy|release|rm\s+-rf|删除|清空|迁移|回滚|发布|生产数据库|线上数据库)/i

const CertaintyPattern = /(结论|确定|断言|裁定|判定|definitive|final answer|guarantee)/i

const ToolPattern =
  /(检索|搜索|查找|查询|文档|资料|source|sources|reference|citation|cite|evidence|verify|fact check|lookup|search|retrieve|引用|证据|来源|核验|验证)/i

const clamp = (n: number) => Math.max(0, Math.min(1, Number(n.toFixed(3))))

const complexity = (input: ScorerInput) => {
  const token =
    input.intentTokensEstimate >= 768
      ? 0.42
      : input.intentTokensEstimate >= 320
        ? 0.3
        : input.intentTokensEstimate >= 120
          ? 0.18
          : input.intentTokensEstimate >= 40
            ? 0.1
            : 0.04
  const text = input.intentText
  const step = StepPattern.test(text) ? 0.16 : 0
  const rule = RulePattern.test(text) ? 0.12 : 0
  const write = input.hasWriteIntent ? 0.16 : 0
  const exec = input.hasExecIntent ? 0.13 : 0
  const verify = input.hasVerificationIntent ? 0.12 : 0
  const file = input.hasFileParts ? 0.08 : 0
  const ux = input.uxMode === "deep" ? 0.06 : 0

  return clamp(token + step + rule + write + exec + verify + file + ux)
}

const risk = (input: ScorerInput) => {
  const text = input.intentText
  const base = 0.04
  const domain = RiskPattern.test(text) ? 0.56 : 0
  const danger = DangerPattern.test(text) ? 0.23 : 0
  const certainty = CertaintyPattern.test(text) ? 0.08 : 0
  const verify = input.hasVerificationIntent ? 0.08 : 0
  const action = input.hasWriteIntent || input.hasExecIntent ? 0.06 : 0

  return clamp(base + domain + danger + certainty + verify + action)
}

const tool = (input: ScorerInput) => {
  const text = input.intentText
  const base = 0.03
  const lookup = ToolPattern.test(text) ? 0.44 : 0
  const verify = input.hasVerificationIntent ? 0.2 : 0
  const exec = input.hasExecIntent ? 0.22 : 0
  const file = input.hasFileParts ? 0.12 : 0
  const write = input.hasWriteIntent ? 0.08 : 0
  const size = input.intentTokensEstimate >= 256 ? 0.08 : 0

  return clamp(base + lookup + verify + exec + file + write + size)
}

export const scoreOrchestrator = (input: ScorerInput): OrchestratorPlanScores => {
  return {
    complexity_score: complexity(input),
    risk_score: risk(input),
    tool_need_score: tool(input),
  }
}

export const modeFromScores = (input: {
  uxMode: OrchestratorUxMode
  scores: OrchestratorPlanScores
}): ScoredMode => {
  const scores = input.scores
  if (scores.risk_score >= 0.8) return "heavy"
  if (scores.complexity_score >= 0.6) return "heavy"
  if (scores.complexity_score >= 0.3) return "assist"
  if (scores.risk_score >= 0.45) return "assist"
  if (scores.tool_need_score >= 0.5) return "assist"
  if (input.uxMode === "deep" && scores.complexity_score >= 0.25) return "assist"
  return "chat"
}
