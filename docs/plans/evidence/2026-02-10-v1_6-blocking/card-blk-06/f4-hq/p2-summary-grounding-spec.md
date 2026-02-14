# F4-HQ-P2-EXEC-SUMMARY-GROUNDING-01 Spec

## 背景与问题
在会话中，用户常以“总结/交接/复盘/续接包/report/resume/handoff”等意图请求输出阶段性结论。
现有 `verification intent` 识别只覆盖 `cite/source/evidence/verify` 等显式证据词，导致这类“总结型任务”未被判定为需证据约束场景。

## 本次会话“脱锚总结”根因
1. `hasVerificationIntent` 漏识别：
   - 根因文件：`packages/opencode/src/session/orchestrator/features.ts`
   - 根因机制：`VerifyPattern` 缺少总结/交接/复盘等中英关键词。
2. `reference_check_policy` 约束不完整：
   - 根因文件：`packages/opencode/src/session/processor.ts`
   - 根因机制：policy 仅要求“事实 file:line + 无证据 unknown/evidence_insufficient”，未明确“路径来源不可编造”和“数量不可编造”。

## 修复目标
- 让总结/交接/复盘类请求默认进入 `verification intent` 口径。
- 在 `verification intent` 命中时，`reference_check_policy` 保持注入（`workers=off` 也生效）。
- policy 文本 deterministic 且包含：
  - 事实必须 `file:line`
  - 路径只能来自已提供/已读取证据，禁止编造
  - 数量/结论无证据时必须 `unknown/evidence_insufficient`

## 规则触发前后对比（verification intent 命中口径）
### 之前
- 命中：`verify/evidence/source/citation/...`
- 不稳定：`总结/交接/复盘/report/resume/handoff` 可能不命中

### 之后
- 新增命中关键词（中英）：
  - 中文：`分析` `复盘` `审计` `总结` `交接` `续接包` `续接`
  - 英文：`report` `resume` `handoff` `summary` `audit` `analysis` `retrospective` `postmortem`
- 结果：上述意图不再依赖用户显式写出 `verify/evidence`，也会触发证据约束链路。

## 设计边界
- 保持非阻塞：只增强识别和提示约束，不引入阻塞式强校验。
- 不改 orchestrator 主流程语义，不新增工具执行路径。
- 变更范围限制在 `packages/opencode/**` 与 `docs/**`。
