# progress-ledger/1.0 单调性 RED->GREEN 报告（P0-A8）

- Card: `CARD-BLK-06 / P0-A8`
- 代码范围: `packages/opencode/src/session/orchestrator/writer.ts`
- 测试范围:
  - `packages/opencode/test/session/orchestrator-turn.test.ts`
  - `packages/opencode/test/session/adaptive-ttc-policy.test.ts`
  - `packages/opencode/test/session/adaptive-ttc-breaker.test.ts`
- 执行模式: `fail-fast / local-only / no-push`

## 1) RED 证据

先新增/扩展测试，要求 `orchestrator.planned` 事件必须包含：

- `specVersion = progress-ledger/1.0`
- `messageId`
- `cycle`
- `coverageGain`
- `newEvidenceCount`
- `duplicateProbeRate`
- `decision`
- `stopReason`
- `evidence_gain_per_cycle`（原生字段）

并新增“无增益停止”最小行为断言：

- 当 adaptive breaker 触发 stop 语义时，`decision=stop`；
- 且 `evidence_gain_per_cycle=0`、`newEvidenceCount=0`、`coverageGain=0`、`duplicateProbeRate>=1`；
- 用于证明停止依据可审计，而非黑盒降级。

RED 运行结果（实现前）：

- 命令：`bun test test/session/orchestrator-turn.test.ts test/session/adaptive-ttc-policy.test.ts test/session/adaptive-ttc-breaker.test.ts --bail`
- 结果：`FAIL`
- 关键失败：`orchestrator.planned` 事件缺失/不含 progress-ledger 字段（断言 `expected true, received false`）。

## 2) GREEN 最小实现

最小改动点（不改业务目标，仅补观测与判定字段）：

1. 在 `writeOrchestratorArtifacts()` 生成 `progress-ledger/1.0` 最小结构；
2. 以 `sessionId+messageId` 维护 cycle 计数，补齐 `cycle`；
3. 根据 adaptive reason 归并 stop/continue 决策：
   - stop：`adaptive.ttc.early_stop / adaptive.ttc.degrade_* / adaptive.ttc.breaker.*`
   - continue：其余情况
4. 将字段写入 `orchestrator.planned.data`：
   - `specVersion/messageId/cycle/coverageGain/newEvidenceCount/duplicateProbeRate/decision/stopReason/evidence_gain_per_cycle`
5. 在测试中补充 planned 事件触发点与字段断言，完成 RED->GREEN 闭环。

GREEN 运行结果：

- 命令：`bun test test/session/orchestrator-turn.test.ts test/session/adaptive-ttc-policy.test.ts test/session/adaptive-ttc-breaker.test.ts --bail`
- 结果：`PASS`
- 明细：`11 pass / 0 fail`

## 3) evidence_gain_per_cycle 原生化说明（对照 p3-10）

- 变更前（p3-10）：`evidence_gain_per_cycle` 仅能通过 `retrievalCacheKey` 首次出现数做代理估算。
- 变更后（本卡）：`evidence_gain_per_cycle` 成为 `orchestrator.planned.data` 原生字段，与同轮 `decision/stopReason` 同时落盘。
- 对照结论：
  1. 代理口径仍可保留用于交叉验证；
  2. 但门禁审计已具备“事件级直接读取”能力，不必先做 proxy 反推。

## 4) 最小验收命令与结果

1. `cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-p0-a8-progress-ledger/packages/opencode && bun run typecheck`
   - exit code: `0`
2. `cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-p0-a8-progress-ledger/packages/opencode && bun test test/session/orchestrator-turn.test.ts test/session/adaptive-ttc-policy.test.ts test/session/adaptive-ttc-breaker.test.ts --bail`
   - exit code: `0`
3. `test -s /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-p0-a8-progress-ledger/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p0-a8/progress-ledger-spec.md`
   - exit code: `0`
4. `test -s /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-p0-a8-progress-ledger/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p0-a8/progress-ledger-monotonicity-report.md`
   - exit code: `0`

## 5) 风险与回滚动作

- 风险1：当前 `evidence_gain_per_cycle` 采用最小 stop/continue 映射，尚未细化到 retrieval 增量级别。
  - 回滚动作：保留字段但不作为自动断路硬条件（观测优先）。
- 风险2：cycle 依赖进程内 map，跨进程恢复时不保证连续。
  - 回滚动作：告警/审计依赖 `messageId+ts` 主排序，cycle 仅作辅助字段。
- 风险3：stop 语义与 adaptive reason 绑定，若后续 reason 码扩展可能漏判。
  - 回滚动作：新增 reason 码时同步维护 stop code 列表，并先落测试再放量。
