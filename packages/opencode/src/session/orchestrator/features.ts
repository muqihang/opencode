import { OrchestratorFeatures } from "@/protocol/orchestrator-features"
import { type OrchestratorPlanScores, OrchestratorUxMode } from "@/protocol/orchestrator-plan"
import { scoreOrchestrator } from "./scorer"

type FeatureInput = {
  uxMode: OrchestratorUxMode
  intentText: string
  hasFileParts: boolean
  parentSessionId?: string
}

type FeatureSignals = {
  intentBytes: number
  intentTokensEstimate: number
  hasWriteIntent: boolean
  hasExecIntent: boolean
  hasVerificationIntent: boolean
}

export type A1Features = {
  highRisk: boolean
  requiresCitation: boolean
  dualPassCandidate: boolean
}

const WritePattern =
  /(apply[_\s-]*patch|apply\s+patch|apply_patch|edit|modify|update|write|rewrite|refactor|rename|delete|create file|add file|commit|patch|修改|编辑|写入|改一下|改动|提交|重构|重命名|删除|新增文件|创建文件)/i

const ExecPattern =
  /(run|bash|shell|command|test|install|build|compile|npm|bun|python|node|script|make|cargo|运行|测试|安装|构建|编译|命令|脚本|execute\s+(?:command|script|test|build|compile|npm|bun|python|node|make|cargo)|执行(?:命令|脚本|测试|构建|编译|安装))/i

const ExecNegationPattern =
  /(不执行|不运行|不要执行|不要运行|无需执行|无需运行|无须执行|无须运行|不需要执行|不需要运行|do not run|don't run|do not execute|don't execute|without running|without executing)/i

const VerifyPattern =
  /(cite|citation|source|evidence|verify|verification|fact check|reference|proof|quote|report|resume|handoff|summary|audit|analysis|retrospective|postmortem|引用|证据|来源|核验|验证|对账|合规|事实核查|分析|复盘|审计|总结|交接|续接包|续接)/i

const FilePartPattern =
  /(上传文件|提供的文件|附件|file part|attached file|uploaded file|该文件|这个文件|文件里|文件中的|文件内)/i

const FileWriteVerbPattern =
  /(修改|编辑|修复|改动|重构|重命名|删除|新增|写入|patch|fix|rewrite|refactor|rename|delete|update|edit|modify)/i

const FileExecVerbPattern =
  /(运行|执行|测试|复现|构建|编译|命令|脚本|run|execute|test|build|compile|command|script)/i

const HighRiskPattern =
  /(legal|law|medical|finance|regulat|compliance|audit|法律|法条|医疗|医嘱|财务|税务|审计|合规|监管)/i

const CitationPattern =
  /(cite|citation|source|evidence|reference|proof|quote|引用|证据|来源|核验|验证|出处|指针|pointer)/i

const CertaintyPattern = /(结论|确定|断言|fact|facts|结论性|裁定|判定|definitive|final answer)/i

const byFileParts = (input: { hasFileParts: boolean; intentText: string; kind: "write" | "exec" }) => {
  if (!input.hasFileParts) return false
  if (!FilePartPattern.test(input.intentText)) return false
  if (input.kind === "write") return FileWriteVerbPattern.test(input.intentText)
  return FileExecVerbPattern.test(input.intentText)
}

const featureSignals = (input: FeatureInput): FeatureSignals => {
  const intentBytes = Math.max(1, Buffer.byteLength(input.intentText, "utf8"))
  const intentTokensEstimate = Math.max(1, Math.ceil(intentBytes / 4))
  const hasWriteIntent = WritePattern.test(input.intentText) || byFileParts({
    hasFileParts: input.hasFileParts,
    intentText: input.intentText,
    kind: "write",
  })
  const hasExecIntent =
    (ExecPattern.test(input.intentText) ||
      byFileParts({
        hasFileParts: input.hasFileParts,
        intentText: input.intentText,
        kind: "exec",
      })) &&
    !ExecNegationPattern.test(input.intentText)
  const hasVerificationIntent = VerifyPattern.test(input.intentText)

  return {
    intentBytes,
    intentTokensEstimate,
    hasWriteIntent,
    hasExecIntent,
    hasVerificationIntent,
  }
}

export const extractA1Features = (input: { intentText: string; hasFileParts: boolean }): A1Features => {
  const requiresCitation = CitationPattern.test(input.intentText)
  const highRisk = HighRiskPattern.test(input.intentText)
  const certainty = CertaintyPattern.test(input.intentText)
  const dualPassCandidate = (highRisk && requiresCitation) || (requiresCitation && certainty) || byFileParts({
    hasFileParts: input.hasFileParts,
    intentText: input.intentText,
    kind: "exec",
  })

  return {
    highRisk,
    requiresCitation,
    dualPassCandidate,
  }
}

export const extractScores = (input: FeatureInput): OrchestratorPlanScores => {
  const features = featureSignals(input)
  return scoreOrchestrator({
    uxMode: input.uxMode,
    intentText: input.intentText,
    intentTokensEstimate: features.intentTokensEstimate,
    hasFileParts: input.hasFileParts,
    hasWriteIntent: features.hasWriteIntent,
    hasExecIntent: features.hasExecIntent,
    hasVerificationIntent: features.hasVerificationIntent,
  })
}

export const extractFeatures = (input: FeatureInput) => {
  const features = featureSignals(input)

  return OrchestratorFeatures.parse({
    specVersion: "orchestrator-features/1.0",
    features: {
      uxMode: input.uxMode,
      intentBytes: features.intentBytes,
      intentTokensEstimate: features.intentTokensEstimate,
      hasFileParts: input.hasFileParts,
      hasWriteIntent: features.hasWriteIntent,
      hasExecIntent: features.hasExecIntent,
      hasVerificationIntent: features.hasVerificationIntent,
      parentSessionId: input.parentSessionId,
    },
  })
}
