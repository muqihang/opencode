# F4-HQ-P2-STRICT-ROBUSTNESS-01 Regression Report

## 变更摘要
- strict 判定统一到 `verification-mode`，消除 contract / features / reference-check 三套 regex 漂移。
- 新增 `reference_check.mode_resolved` 事件，输出 `mode/confidence/reason_codes/intent`。
- auto-draft 收紧为“可验证引用”白名单路径；越界与当前会话用户消息路径不再进入草稿。

## RED（先失败）
### RED-1：auto-draft 越界引用不应草稿
- 用例：`strict: does not auto-draft when inline line range is out of file bounds`
- 失败现象（旧实现）：仍产生 `secure_output.claims_drafted`。
- 失败证据：`bun test ... --bail` 首次断言失败，`Expected false, Received true`。

### RED-2：strict 一致性与 mode_resolved 结构断言
- 新增用例覆盖：
  - `verification/resume/handoff/audit/summary` 在 contract 与 reference-check 一致 strict。
  - `applyStrictReferenceCheck` 返回结构化 `modeResolved`。
- 旧实现不满足上述行为（summary 链路不一致 / 缺少 modeResolved 结构）。

## GREEN（修复后通过）
### 代码实现
- `resolveVerificationMode()` 统一 strict/normal 判定并返回结构化解析信息。
- `processor` 每次消息落盘 `reference_check.mode_resolved`。
- `secure-output` 自动草稿仅接受 grounded refs（存在+行号合法+sha 可补全+安全路径）。

### 回归结果
- `bun run typecheck` 通过。
- 指定 5 个测试文件全部通过（44 pass，0 fail）。

## 风险与边界
1. strict 判定统一后，部分过去“宽松”场景会更早进入 strict fail-closed（风险可控，符合证据优先目标）。
2. `confidence` 为启发式评分，主要用于可观测与排障，不应作为安全策略唯一依据。
3. auto-draft 保持保守：宁可不草稿降级，也不接受潜在不可信引用。

## 结论
本卡完成 strict 判定收敛、mode 可观测增强和 auto-draft 安全边界硬化，满足“最小改动、fail-closed、不回退前台隐藏行为”的收口要求。
