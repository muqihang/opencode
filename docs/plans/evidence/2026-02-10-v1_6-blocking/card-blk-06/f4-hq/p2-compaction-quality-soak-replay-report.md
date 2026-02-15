# F4-HQ-P2-COMPACTION-QUALITY-SOAK Replay Report

## 审计引用与实现范围
已读取并引用：
- `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/f4-hq/f4-hq-architecture-audit-2026-02-14.md`
- `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/f4-hq/f4-hq-architecture-improvement-backlog-2026-02-14.csv`

P2 行：
- `F4-AUD-008` `Compaction consistency metrics`
- `F4-AUD-009` `Long-session restart soak suite`

## RED -> GREEN 证据

### RED（先失败）
命令：
`TMPDIR=/tmp BUN_INSTALL=/tmp/bun-install bun test test/session/compaction-structured.test.ts test/session/compaction-structured-regression.test.ts test/session/compaction.test.ts test/session/orchestrator-writer-progress-persistence.test.ts test/session/compaction-restart-soak.test.ts --bail`

结果：`exit 1`（符合 RED 预期）
关键失败：
- `compaction-structured-regression.test.ts`
- 断言 `consistency_score` 类型为 `number`，实际为 `undefined`

### GREEN（最小实现后）
1) 类型检查：
- 命令：`TMPDIR=/tmp BUN_INSTALL=/tmp/bun-install bun run typecheck`
- 结果：`exit 0`

2) 指定验收集：
- 命令：`TMPDIR=/tmp BUN_INSTALL=/tmp/bun-install bun test test/session/compaction-structured.test.ts test/session/compaction-structured-regression.test.ts test/session/compaction.test.ts test/session/orchestrator-writer-progress-persistence.test.ts test/session/compaction-restart-soak.test.ts --bail`
- 结果：`exit 0`（35 pass, 0 fail）

## 实现摘要
### 协议与产物
- `CompactionQuality` 新增 `consistency_score`、`contradiction_count`、`reason_codes`。
- `compaction.report.json.quality` 同步新增字段。
- `compaction.quality` 事件与 report 字段保持一一一致。

### deterministic 冲突检测覆盖面
冲突检测覆盖：
- `goal`
- `decisions`
- `openQuestions`
- `working_set`

通过 claim key + polarity（正/否定）检测矛盾，输出 `contradiction_count` 与 `reason_codes`。

## soak 链路证据
来自 `compaction-restart-soak.test.ts`：
1. 执行 `>=3` 轮 compaction（固定 3 轮）。
2. 每轮使用动态模块加载（query-tag）模拟重启后继续。
3. 验证链路：
   - `round2.previous.compactionId == round1.compactionId`
   - `round3.previous.compactionId == round2.compactionId`
4. 进度/检查点单调：
   - `compaction.completed` 计数 `1 -> 2 -> 3`
   - `state.json.lastCompactionId` 始终对齐当轮最新 report。

## 变更文件
- `packages/opencode/src/session/compaction-protocol.ts`
- `packages/opencode/src/session/compaction.ts`
- `packages/opencode/test/session/compaction-structured.test.ts`
- `packages/opencode/test/session/compaction-structured-regression.test.ts`
- `packages/opencode/test/session/orchestrator-writer-progress-persistence.test.ts`
- `packages/opencode/test/session/compaction-restart-soak.test.ts`
