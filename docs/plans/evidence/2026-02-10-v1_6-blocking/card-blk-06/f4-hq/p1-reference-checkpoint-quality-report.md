# F4-HQ P1 Reference Checkpoint Quality Report

## 执行摘要

本次修复覆盖两条主线：
- C2：verification intent 下的引用硬约束注入稳定性
- compaction：resume checkpoint 的 deterministic 结构质量

结果：指定验收命令全 0，通过。

## RED -> GREEN 证据

### RED（先失败）

1) `orchestrator-turn` 新增测试先失败：
- 原因：`enforceReferenceCheckPolicy` 在 RED 阶段尚未实现，导出不存在。

2) `compaction-structured` 新增断言先失败：
- 期望 `capsule.goal.status = known`
- 实际 `Received: "unknown"`

### GREEN（最小实现后）

- 引用硬约束由 processor 主链路注入，测试通过。
- compaction 构建 capsule.session 时显式填充 goal/decisions/openQuestions，测试通过。

## checkpoint 前后差异

### Before

- `goal`: `{ status: "unknown" }`
- `decisions`: `[]`
- `openQuestions`: `[]`

### After

- `goal`: `{ status: "known", value: <last_user_message_preview 或 fallback> }`
- `decisions`: 至少两条 deterministic known
  - `compaction_id=<...>`
  - `trigger_parent_id=<...>`
- `openQuestions`: 至少两条 deterministic unknown
  - `active_files pending confirmation`
  - `next_steps pending confirmation`

## 质量门结果

### 指定验收命令

1. `cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-f4-hq-p1-reference-checkpoint/packages/opencode && bun run typecheck`
- exit code: `0`

2. `cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-f4-hq-p1-reference-checkpoint/packages/opencode && bun test test/session/orchestrator-turn.test.ts test/session/compaction-structured.test.ts --bail`
- exit code: `0`

## 仍存风险与后续卡点

1) policy 文本匹配风险（语义漂移）
- 当前引用硬约束以 deterministic 文本注入。
- 后续若上层 prompt 模板重构，需保持该 policy 稳定可见且不被后续覆盖。

2) checkpoint 语义仍偏最小可用
- 当前 decisions/openQuestions 为 deterministic 基线项，保证可恢复与可追踪。
- 后续可在不破坏 deterministic 基线的前提下，引入更丰富但可验证的结构（例如 active files extraction pipeline）。

3) workers 与 policy 的演进耦合风险
- 本次已解除 policy 对 workers 执行的依赖。
- 后续 rollout 迭代（尤其 v16 相关开关）需持续回归“workers=off + verification intent”场景。

## 结论

本卡点在 local 验收条件下可判定为 GO。
