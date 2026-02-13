# P0-B4 rerun-breaker/1.0 最小规范（message 级重跑收敛）

- Card: `CARD-BLK-06 / P0-B4`
- Scope: `packages/opencode`（不改 `packages/app/**`）
- Goal: 以最小行为面实现 message 级幂等、`maxRerun` 收敛、自动断路与可审计回放

## 字段与规则定义

### 1) message 级幂等键

- 字段: `idempotencyKey`
- 公式: `sessionId:messageId:orchestratorPlanId`
- 落盘位置:
  - `orchestrator.planned` 事件 `data.idempotencyKey`
  - `orchestrator.idempotent` 事件 `data.idempotencyKey`
- 规则:
  - `runOrchestratorTurn` 命中同键缓存时，不重复执行 worker；返回缓存结果。
  - 命中缓存必须写 `orchestrator.idempotent` 事件（`decision=reuse_cached_turn`）。

### 2) maxRerun 收敛

- 字段:
  - `budgets.maxRerun`（当前最小实现固定 `1`）
  - `rerunCount`（按同 `sessionId + messageId` 递增；首轮为 `0`）
- 规则:
  - `rerunCount <= maxRerun`: 按原策略继续。
  - `rerunCount > maxRerun`: 触发断路，注入 `adaptive.ttc.max_rerun.stop`。
  - 断路时收敛 worker 扇出到 1（仅保留首 worker），并写入 breaker reason。

### 3) 自动断路与 fallback 审计

- 新增/复用 reason:
  - `adaptive.ttc.max_rerun.stop`
  - `adaptive.ttc.breaker.active`
  - `adaptive.ttc.breaker.trip`
  - `adaptive.ttc.fallback.unknown_first`
- 事件字段:
  - `decision`: `continue | stop`
  - `stopReason`: `not_stopped | no_new_evidence | max_rerun_exceeded`
  - `fallbackPath`:
    - continue: `adaptive.ttc.continue -> dual_pass.draft`
    - stop: `adaptive.ttc.breaker.stop -> dual_pass.unknown-first`
- 可回放要求:
  - 通过 `orchestrator.planned` + `orchestrator.idempotent` + `orchestrator.degraded` 三类事件，能复原“为何停、停后走哪条 fallback”。

## RED -> GREEN 证据

### RED（先失败）

1. `bun test test/session/adaptive-ttc-breaker.test.ts --bail`
   - 失败点: 缺 `orchestrator.idempotent` 事件，message 级幂等不可审计。
   - Exit: `1`
2. `bun test test/session/adaptive-ttc-policy.test.ts --bail`
   - 失败点: `orchestrator.planned` 缺 `fallbackPath` 字段。
   - Exit: `1`
3. `bun test test/session/adaptive-ttc-budget.test.ts --bail`
   - 失败点: `budgets.maxRerun` 未落盘，超限 stop 未生效。
   - Exit: `1`

### GREEN（最小实现后）

- `bun test test/session/adaptive-ttc-breaker.test.ts test/session/adaptive-ttc-policy.test.ts test/session/adaptive-ttc-budget.test.ts --bail`
- 结果: 全部通过。
- Exit: `0`

## 误伤评估口径与回滚阈值

- 评估口径（沿用 F4/H）：
  - `critic_degraded_rate`
  - `secure_output_pass_rate`
  - `rerun_count_per_message`
  - `evidence_gain_per_cycle`
- 误伤判定（任一命中视为误伤风险上升）：
  - 断路后 `secure_output_pass_rate` 相对基线下降 > 3pp
  - `critic_degraded_rate` 相对对照组恶化 > 5pp
  - 高难任务样本中出现“被断路但人工复核可成功”比例持续上升
- 回滚阈值（对应 H.2 口径）:
  - `rerun_count_per_message` 连续 24h > 2
  - `evidence_gain_per_cycle` 连续 6h <= 0 且 `rerun_count_per_message > 1`
- 回滚动作:
  1) 恢复保守 breaker 参数（放宽 maxRerun/停机条件）；
  2) 保留审计字段，避免观测回退；
  3) 输出复盘样本并回灌离线回放池。

## 最小验收命令与 exit code

> 以下命令按 A6 顺序执行；exit code 在执行后回填。

1. `cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-p0-b4-adaptive-rerun-breaker/packages/opencode && bun run typecheck`
   - Exit: `0`
2. `cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-p0-b4-adaptive-rerun-breaker/packages/opencode && bun test test/session/adaptive-ttc-breaker.test.ts test/session/adaptive-ttc-policy.test.ts test/session/adaptive-ttc-budget.test.ts --bail`
   - Exit: `0`
3. `test -s /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-p0-b4-adaptive-rerun-breaker/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p0-b4/rerun-breaker-spec.md`
   - Exit: `0`
4. `test -s /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-p0-b4-adaptive-rerun-breaker/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p0-b4/rerun-fallback-audit-report.md`
   - Exit: `0`
