# P0-B4 rerun/fallback 审计报告（最小实现）

- Card: `CARD-BLK-06 / P0-B4`
- Session: `codex/v16-p0-b4-adaptive-rerun-breaker`
- Report scope: message 级幂等、`maxRerun`、自动断路、fallback 可审计

## 字段与规则定义（审计视角）

- `idempotencyKey`: `sessionId:messageId:orchestratorPlanId`
  - 证据: 缓存命中时写 `orchestrator.idempotent`。
- `maxRerun` + `rerunCount`
  - 证据: `orchestrator.planned` 包含 `maxRerun`、`rerunCount`。
- `decision` + `stopReason`
  - 证据: 同步落在 `orchestrator.planned`。
- `fallbackPath`
  - 证据: `orchestrator.planned` 与 `orchestrator.idempotent` 可见路径字符串；可重建 stop/continue 的 fallback 分支。

## RED -> GREEN 证据

### RED

- `bun test test/session/adaptive-ttc-breaker.test.ts --bail`
  - Exit: `1`
  - 错误: 期望存在 `orchestrator.idempotent`，实际不存在。
- `bun test test/session/adaptive-ttc-policy.test.ts --bail`
  - Exit: `1`
  - 错误: 期望 `fallbackPath` 包含 `dual_pass` 与 `continue`，实际为空。
- `bun test test/session/adaptive-ttc-budget.test.ts --bail`
  - Exit: `1`
  - 错误: 期望 `budgets.maxRerun === 1`，实际 `undefined`。

### GREEN

- `bun test test/session/adaptive-ttc-breaker.test.ts test/session/adaptive-ttc-policy.test.ts test/session/adaptive-ttc-budget.test.ts --bail`
  - Exit: `0`
  - 结果: 三文件全部通过，新增断言覆盖以下行为：
    1) message 级幂等键命中与审计事件；
    2) `maxRerun` 超限触发 stop；
    3) 断路决策与 fallback 路径审计字段。

## 误伤评估口径与回滚阈值

- 误伤口径：
  - 成功率侧: `secure_output_pass_rate`
  - 退化侧: `critic_degraded_rate`
  - 收敛侧: `rerun_count_per_message`
  - 增益侧: `evidence_gain_per_cycle`
- 阈值（命中即回滚）:
  - `secure_output_pass_rate` 下降 > 3pp
  - `critic_degraded_rate` 恶化 > 5pp
  - `rerun_count_per_message` 连续 24h > 2
  - `evidence_gain_per_cycle` 连续 6h <= 0 且 `rerun_count_per_message > 1`
- 回滚动作:
  1) 退回保守 breaker 参数；
  2) 保留新增审计字段；
  3) 48h 内完成误伤样本复盘。

## 最小验收命令与 exit code

> 按执行卡 A6 顺序；执行后回填。

1. `cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-p0-b4-adaptive-rerun-breaker/packages/opencode && bun run typecheck`
   - Exit: `0`
2. `cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-p0-b4-adaptive-rerun-breaker/packages/opencode && bun test test/session/adaptive-ttc-breaker.test.ts test/session/adaptive-ttc-policy.test.ts test/session/adaptive-ttc-budget.test.ts --bail`
   - Exit: `0`
3. `test -s /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-p0-b4-adaptive-rerun-breaker/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p0-b4/rerun-breaker-spec.md`
   - Exit: `0`
4. `test -s /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-p0-b4-adaptive-rerun-breaker/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p0-b4/rerun-fallback-audit-report.md`
   - Exit: `0`
