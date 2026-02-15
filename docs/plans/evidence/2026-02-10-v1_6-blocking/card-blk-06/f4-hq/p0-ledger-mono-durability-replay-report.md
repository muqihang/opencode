# F4-HQ-P0-LEDGER-MONO-DURABILITY Replay Report

- 任务代号：`F4-HQ-P0-LEDGER-MONO-DURABILITY`
- 分支：`codex/v16-f4-hq-p0-ledger-mono-durability`
- 模式：local-only（未执行 push）

## 1. RED -> GREEN 过程

## 1.1 RED（先失败）

- 命令：
  - `cd packages/opencode && bun test test/evidence/manifest-append-only.test.ts test/session/orchestrator-writer-progress-persistence.test.ts --bail`
- 结果：`exit 1`
- 失败点：
  - manifest 同路径写入仅保留 1 条（未 append-only）

- 命令：
  - `cd packages/opencode && bun test test/session/orchestrator-writer-progress-persistence.test.ts --bail`
- 结果：`exit 1`
- 失败点：
  - 重启后 cycle 未递增（回拨到 1）

## 1.2 GREEN（最小实现后）

- 命令：
  - `cd packages/opencode && bun test test/evidence/manifest-append-only.test.ts test/session/orchestrator-writer-progress-persistence.test.ts --bail`
- 结果：`exit 0`

- 回归最小集：
  - `cd packages/opencode && bun test test/evidence/evidence-writer.test.ts test/evidence/reader.test.ts test/evidence/macro-merge.test.ts test/evidence/evidence-export.test.ts test/session/orchestrator-writer.test.ts --bail`
- 结果：`exit 0`

- 额外受影响回归：
  - `cd packages/opencode && bun test test/session/orchestrator-integration-v2.test.ts test/session/dual-pass-degrade.test.ts --bail`
- 结果：`exit 0`

## 2. A3 验收命令

1) `cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/packages/opencode && bun run typecheck`
- 结果：`exit 0`

2) `cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/packages/opencode && bun test test/session test/evidence --bail`
- 结果：`exit 0`

3) `test -s /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/f4-hq/p0-ledger-mono-durability-spec.md`
- 结果：待本报告写入后执行，预期 `exit 0`

4) `test -s /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/f4-hq/p0-ledger-mono-durability-replay-report.md`
- 结果：待本报告写入后执行，预期 `exit 0`

## 3. 实施摘要

- Evidence manifest：从 upsert 改为 append-only ledger，链字段 `sequence/prevHash/entryHash`。
- Reader：新增链完整性校验，损坏时 fail-closed；legacy manifest 兼容读取。
- Export/Merge：读取 latest 视图，避免 append-only 历史条目导致旧 sha 校验误报。
- Progress：新增落盘 store（`orchestrator-progress/1.0`），实现 cycle/stop/degraded 跨重启单调。

## 4. 风险复核

- manifest 增长速度上升（已知可接受，后续可配合 compaction）。
- 链校验 fail-closed 可能暴露历史脏数据（符合安全优先策略）。
- 文件锁竞争风险可控（当前测试覆盖通过）。
