import { OrchestratorFeatures } from "@/protocol/orchestrator-features"
import { OrchestratorUxMode } from "@/protocol/orchestrator-plan"

type FeatureInput = {
  uxMode: OrchestratorUxMode
  intentText: string
  hasFileParts: boolean
  parentSessionId?: string
}

const WritePattern =
  /(apply[_\s-]*patch|apply\s+patch|apply_patch|edit|modify|update|write|rewrite|refactor|rename|delete|create file|add file|commit|patch|修改|编辑|写入|改一下|改动|提交|重构|重命名|删除|新增文件|创建文件)/i

const ExecPattern =
  /(run|execute|bash|shell|command|test|install|build|compile|npm|bun|python|node|script|make|cargo|运行|执行|测试|安装|构建|编译|命令|脚本)/i

const VerifyPattern =
  /(cite|citation|source|evidence|verify|verification|fact check|reference|proof|quote|引用|证据|来源|核验|验证|对账|合规|事实核查)/i

export const extractFeatures = (input: FeatureInput) => {
  const intentBytes = Math.max(1, Buffer.byteLength(input.intentText, "utf8"))
  const intentTokensEstimate = Math.max(1, Math.ceil(intentBytes / 4))
  const hasWriteIntent = WritePattern.test(input.intentText)
  const hasExecIntent = ExecPattern.test(input.intentText)
  const hasVerificationIntent = VerifyPattern.test(input.intentText)

  return OrchestratorFeatures.parse({
    specVersion: "orchestrator-features/1.0",
    features: {
      uxMode: input.uxMode,
      intentBytes,
      intentTokensEstimate,
      hasFileParts: input.hasFileParts,
      hasWriteIntent,
      hasExecIntent,
      hasVerificationIntent,
      parentSessionId: input.parentSessionId,
    },
  })
}
