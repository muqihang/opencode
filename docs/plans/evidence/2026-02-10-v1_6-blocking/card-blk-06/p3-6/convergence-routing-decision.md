# CARD-BLK-06 / P3-6 收敛路由决策单（I.6，fail-fast）

- 日期：2026-02-12
- 任务：`P3-6-CONVERGENCE-01`
- 决策对象：双检索链收敛策略（主链 + 补偿链）是否保持
- 决策结论：**保持当前收敛策略（Conditional Keep）**

## 1) 决策输入（必须满足）

### 1.1 依赖输入已具备

- `I.2` 已提供噪声构成证据（识别召回质量主风险）。
- `I.3` 已提供重复 planned 根因证据（识别预算回跳风险）。
- `I.6` 本轮已补齐召回/成本报告。
- 证据：
  - `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-2/topk-noise-breakdown.md:1`
  - `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-3/planned-repeat-root-cause.md:1`
  - `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-6/dual-retrieval-recall-cost-report.md:1`

### 1.2 路由边界可验证

- 补偿链触发决策是显式函数，不依赖隐式字符串匹配。
- `invalid config/env -> fallback(strict + orchestrator_main)` 已有实现与测试。
- 证据：
  - `packages/opencode/src/session/hybrid-routing-policy.ts:83`
  - `packages/opencode/src/session/hybrid-routing-policy.ts:131`
  - `packages/opencode/test/session/llm.test.ts:235`

### 1.3 fail-fast 机制可执行

- `tool_broker` 可按 `bounceMax` 与 `policy.allowed` 立即拒绝。
- retrieval 有超时预算与状态事件（timeout/degraded/cancelled）。
- 证据：
  - `packages/opencode/src/session/orchestrator/tool-broker.ts:155`
  - `packages/opencode/src/session/orchestrator/tool-broker.ts:240`
  - `packages/opencode/src/retrieval/runner.ts:263`
  - `packages/opencode/src/retrieval/runner.ts:717`

## 2) 决策本体（可执行）

### 2.1 路由策略

保持以下策略，不做参数扩题：

1. 主策略：`main_first`
2. 生产默认：`compensationGate=balanced`
3. 回退策略：`orchestrator_main`
4. 异常配置：强制 `fallback => strict`

对应实现锚点：

- `packages/opencode/src/session/hybrid-routing-policy.ts:69`
- `packages/opencode/src/session/hybrid-routing-policy.ts:75`
- `packages/opencode/src/session/hybrid-routing-policy.ts:123`

### 2.2 主链/补偿链边界

- 主链健康且覆盖 retrieval：补偿链关闭。
- 主链降级或不可用：补偿链允许单次兜底。
- 主链健康但不覆盖 retrieval：仅 `balanced` 开启补偿。
- `off` 仅用于实验/应急，不作为默认。

对应实现锚点：

- `packages/opencode/src/session/hybrid-routing-policy.ts:136`
- `packages/opencode/src/session/hybrid-routing-policy.ts:142`
- `packages/opencode/src/session/hybrid-routing-policy.ts:143`
- `packages/opencode/src/session/hybrid-routing-policy.ts:144`

## 3) 放行判定（I.7 / I.10）

### 3.1 I.7 判定

- **判定：Go（条件放行）**。
- 条件：沿用当前收敛策略，不切新路由实验；按既有 `I.7` 验收卡执行。
- 依据：`I.7` 依赖 `I.6` 稳定后采样，当前已具备稳定边界与 fail-fast 闸门。
- 锚点：
  - `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-7/README.md:17`

### 3.2 I.10 判定

- **判定：Hold（暂不进入）**。
- 原因：`I.10` 明确依赖 `I.7` 结论，当前应保持顺序执行。
- 锚点：
  - `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-10/README.md:17`

## 4) fail-fast 触发条件与动作

出现以下任一条件并连续 2 个采样周期超限，立即执行回退：

1. `cost/req > +3%`
2. `p95 latency > +8%`
3. `fallback rate > +1.0pp`

动作清单（按序）：

1. 冻结建议参数（停止继续推进建议态）。
2. 路由门控切回“单主链优先”（回退 `strict`）。
3. 保留观测事件并落盘异常记录，进入人工签收。

口径锚点：

- `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p2-3/auto-tuning-runbook.md:39`
- `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p2-3/auto-tuning-runbook.md:50`
- `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p2-3/auto-tuning-runbook.md:57`

## 5) 责任与执行窗口

- 路由执行责任：`Exec-AI-RETRIEVAL` + orchestrator 负责人（待实名）。
- 当前窗口建议：维持策略直到 `I.7` 数据集与回归报告完成。
- 完成 `I.7` 后，立即进入 `I.10` 阈值鲁棒性评估。

## 6) 结论（一句话）

在 `2026-02-12` 当前证据下，**继续保持收敛策略是可执行且更稳妥的选择**；如触发 fail-fast 超限则按既定 runbook 立即回退单主链。

## 7) Need-Decision

- 无。
