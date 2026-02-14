# F4-HQ P1 Reference Checkpoint Spec

## 背景

任务：`F4-HQ-P1-EXEC-REFERENCE-CHECKPOINT-01`。
目标是修复 strict V2 剩余核心失败项：
- C2（引用可追溯）
- compaction 后续接质量弱（resume checkpoint 结构化信息不足）

范围限定：`packages/opencode/**` 与 `docs/**`，local-only，不触及 `packages/app/**`。

## C2 失败根因

### 根因 1：引用硬约束未在 processor 主链路强制注入

在 `session processor` 中，最终发给 LLM 的 `system` 由：
- `streamInput.system`
- `runOrchestratorTurn` 返回 system
- fork notice
三者组合而来。

此前没有一个与 worker 生命周期解耦的、deterministic 的“引用硬约束”注入点。
当 `rollout.llmWorkers=false`（或 workers 实际不运行）时，`executeOrchestratorTurnByRollout` 会回退到 base system，导致 verification intent 场景无法稳定携带“事实引用约束”。

### 根因 2：compaction 的 capsule.session 默认值过弱

`Capsule.buildSession` 默认：
- `goal.status = unknown`
- `decisions = []`
- `openQuestions = []`

而 `SessionCompaction.process` 在构建 capsule 时未传入上述三项，导致 checkpoint 在 resume 侧可用性不足（目标未知、决策缺失、待确认项缺失）。

## 修复机制

### 1) 引用硬约束（processor deterministic 注入）

在 `packages/opencode/src/session/processor.ts` 新增 `enforceReferenceCheckPolicy()`，并在组装 `orchestratedInput.system` 时执行：

触发条件：
- orchestrator enabled 且未 degraded
- hasVerificationIntent = true

注入内容（deterministic policy）：
- `事实必须给 file:line 引用；无证据必须 unknown/evidence_insufficient。`

关键性质：
- 与 worker 生命周期解耦
- workers=off 时仍生效
- 仅修改 `system` 指令，不改变工具权限模型（non-blocking）

### 2) deterministic resume checkpoint 增强（compaction）

在 `packages/opencode/src/session/compaction.ts` 构造 `Capsule.buildSession` 时显式填充：

- `goal`：从 `last_user_message_preview` 推导为 `known`
- `decisions`：至少一条 deterministic 已知项（实际写入 compaction_id、trigger_parent_id）
- `openQuestions`：至少一条 deterministic 待确认项（实际写入 active_files/next_steps 待确认）

该机制不依赖 LLM，同步成立；LLM-assisted compaction 仍为可选增强链路。

## 变更清单

- `packages/opencode/src/session/processor.ts`
- `packages/opencode/src/session/compaction.ts`
- `packages/opencode/test/session/orchestrator-turn.test.ts`
- `packages/opencode/test/session/compaction-structured.test.ts`

## 验收标准映射

- C2 引用可追溯：通过 processor system 注入 deterministic policy 达成。
- resume checkpoint 质量：`capsule.session.json` 满足
  - `goal.status = known`
  - `decisions.length >= 1`
  - `openQuestions.length >= 1`

