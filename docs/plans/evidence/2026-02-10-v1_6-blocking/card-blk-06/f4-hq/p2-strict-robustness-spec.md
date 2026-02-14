# F4-HQ-P2-STRICT-ROBUSTNESS-01 Spec

## 背景与问题
本卡聚焦两个高优先问题：
1. strict 场景判定在多链路存在漂移（`orchestrator/features`、`secure-output-contract`、`reference-check` 各自维护 regex）。
2. strict 模式下 claims 自动草稿存在“先草稿后失败”的潜在误用：当引用越界或命中当前会话用户消息路径时，仍可能进入 auto-draft。

## 修复目标
- strict/normal 判定收敛为单一来源（single source of truth），并在 contract 注入与 reference-check 执行保持一致。
- 为每次消息新增 `reference_check.mode_resolved` 结构化事件，包含 `mode/confidence/reason_codes/intent`。
- auto-draft 改为 fail-closed：仅允许“可验证引用”进入草稿（路径可落盘且存在、行号合法、sha 可补全、非 unknown/通配符、非当前会话用户消息路径）。
- 保持前台 claims 隐藏行为不回退。

## 方案设计
### 1) 单一 strict 判定函数
新增 `packages/opencode/src/session/verification-mode.ts`：
- 对 verification/resume/handoff/audit/summary（含中英同义）统一归类。
- 输出统一结构：`{ mode, confidence, reasonCodes, intent }`。
- 由以下链路共用：
  - `orchestrator/features`（`hasVerificationIntent`）
  - `secure-output-contract`（strict/light 合约选择）
  - `reference-check`（是否执行 strict 校验）
  - `processor`（事件落盘）

### 2) processor 可观测性增强
在 `packages/opencode/src/session/processor.ts`：
- 在每次消息完成 reference-check 决策后落盘 `reference_check.mode_resolved`。
- 事件数据固定包含：
  - `mode`
  - `confidence`
  - `reason_codes`
  - `intent`

### 3) auto-draft 安全边界收紧
在 `packages/opencode/src/secure-output/worker.ts`：
- `draftClaimsPayload` 前置校验 inline 引用：
  - 拒绝 `unknown` / `*` 通配符。
  - 拒绝当前会话用户消息路径。
  - 校验行号必须落在真实文件范围内。
  - 仅在 `sha256` 可补全时允许生成草稿。
- 不满足条件时不草稿，沿既有协议降级路径 fail-closed。

## 变更范围
仅修改最小必要文件：
- `packages/opencode/src/session/verification-mode.ts`（新增）
- `packages/opencode/src/session/orchestrator/features.ts`
- `packages/opencode/src/session/secure-output-contract.ts`
- `packages/opencode/src/session/reference-check.ts`
- `packages/opencode/src/session/processor.ts`
- `packages/opencode/src/secure-output/worker.ts`
- `packages/opencode/test/session/orchestrator-secure-output-policy.test.ts`
- `packages/opencode/test/session/processor-secure-output-stream.test.ts`
- `packages/opencode/test/secure-output/secure-output.test.ts`
