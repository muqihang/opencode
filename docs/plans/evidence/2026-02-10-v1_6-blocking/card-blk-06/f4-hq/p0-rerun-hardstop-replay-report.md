# F4-HQ-P0-RERUN-HARDSTOP-02 Replay Report

## 1. 变更清单

- `packages/opencode/src/session/orchestrator/plan.ts`
- `packages/opencode/src/session/orchestrator/writer.ts`
- `packages/opencode/test/session/orchestrator-plan.test.ts`
- `packages/opencode/test/session/orchestrator-writer.test.ts`

## 2. 关键行为回放（前后对比）

### A) non-worker（chat/fork）不进入 rerun breaker

- 修复前：重复同 message 的 plan/build 可能进入 `adaptive.ttc.max_rerun.stop` 分支。
- 修复后：
  - `orchestratorMode in {chat,fork}` 直接旁路 rerun breaker。
  - reason 中不出现 `adaptive.ttc.max_rerun.stop`。
  - progress-ledger 在 non-worker 模式固定 `rerunCount=0`。

### B) max_rerun 硬停闩锁，阻止 storm

- 修复前：同 message 重复 prepare/write 时，`stopReason=max_rerun_exceeded` 行可持续增长。
- 修复后：
  - 首次命中后打闩锁（`stops`）。
  - 后续重复流程不再新增 stop 行，不再抬升 cycle 语义。
  - 口径：`stop_exceeded_rows <= 1`（重复新增为 `0`）。

### C) adaptive_ttc degraded 去重

- 修复前：`orchestrator.degraded(stage=adaptive_ttc)` 可随循环线性增长。
- 修复后：按 `message+reason` 去重，同因同 message 仅写一次。

## 3. RED/GREEN 证据

### RED 记录（预期失败）

- 命令：
  - `cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-f4-hq-p0-rerun-hardstop/packages/opencode && bun test test/session/orchestrator-plan.test.ts test/session/orchestrator-writer.test.ts test/session/orchestrator-turn.test.ts --bail`
- 退出码：`1`
- 失败点：新增用例 `chat and fork stay outside rerun breaker semantics` 在旧实现下失败（符合 RED）。

### GREEN / A4 记录

- 命令：
  - `cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-f4-hq-p0-rerun-hardstop/packages/opencode && bun run typecheck`
- 退出码：`0`

- 命令：
  - `cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-f4-hq-p0-rerun-hardstop/packages/opencode && bun test test/session/orchestrator-plan.test.ts test/session/orchestrator-writer.test.ts test/session/orchestrator-turn.test.ts --bail`
- 退出码：`0`

## 4. B5 续跑验收（本次任务）

- 待本任务 B5 命令执行后，记录最新 exit code（目标均为 `0`）。

## 5. 风险与后续卡点

1. 当前闩锁/去重为进程内状态，非持久化；跨进程需要额外幂等方案。
2. 一次性 stop 口径（`<=1`）已写入测试，未来若改为完全静默 stop，需同步更新测试与证据文档。
3. 若后续把 rerun key 从 `session+message` 调整为其他维度，需补迁移与兼容回放测试。

