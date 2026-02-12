# probe-journal/1.0 去重与 RED->GREEN 报告（P0-A7）

- Card: `CARD-BLK-06 / P0-A7`
- 代码范围: `packages/opencode/src/retrieval/runner.ts`
- 测试范围: `packages/opencode/test/retrieval/runner.test.ts`
- 执行模式: `fail-fast / local-only / no-push`

## 1) RED 证据

先新增测试：

- `retrieval writes probe journal and marks duplicate probe by message+key`
- 断言首次与重复 retrieval 的 probe 文件均存在，并校验以下字段：
  - `specVersion = probe-journal/1.0`
  - `messageId`
  - `probeId`
  - `dedupeKey`
  - `why`
  - `queries`
  - `expectedEvidence`
- 最小 dedupe 断言：同 `messageId` + 同 `dedupeKey` 的第二次 probe 应标记 `duplicate=true`

RED 执行结果（新增测试后、实现前）：

- 命令：`bun test test/retrieval/runner.test.ts --bail`
- 结果：`FAIL`
- 关键失败：`probe.journal.json` 不存在（`ENOENT`）

## 2) GREEN 变更

最小实现点：

1. 在 `runRetrieval()` 中新增 `ProbeJournal` 结构生成。
2. 使用现有 `retrievalCacheKey` 作为 `dedupeKey`，保持口径统一。
3. 新增 `countProbeMatches()`：按 `sessionId` 扫描已落盘 probe，统计同 `messageId+dedupeKey` 命中数。
4. 写入 `retrieval/<retrievalId>/probe.journal.json`。
5. retrieval 返回值 `artifacts` 与终态事件 `data.artifacts` 新增 `probe` 指针。
6. 终态事件 `data.probe` 透传去重摘要：`dedupeKey / duplicate / seen`。

GREEN 执行结果：

- 命令：`bun test test/retrieval/runner.test.ts --bail`
- 结果：`PASS`
- 新增用例通过：`retrieval writes probe journal and marks duplicate probe by message+key`

## 3) 字段与来源复核

| 字段 | 来源复核结论 |
|---|---|
| `specVersion` | 固定常量 `probe-journal/1.0` |
| `messageId` | 来自 `runRetrieval(input.messageId)` |
| `probeId` | 复用 `retrievalId` |
| `dedupeKey` | 来自 `retrievalCacheKey({ plan, workspace })` |
| `why` | 固定说明字符串 |
| `queries` | 来自 `buildPlan(intentText).queries` |
| `expectedEvidence` | 来自本轮 artifact 相对路径集合 |

## 4) 风险与回滚动作

- 风险：session 内 probe 目录扫描带来额外 I/O。
  - 回滚：移除 `countProbeMatches()`，固定 `seen=1/duplicate=false`。
- 风险：下游若假设 retrieval artifacts 固定三字段可能受影响。
  - 回滚：保留 probe 文件落盘，删除 `artifacts.probe` 透传字段。
- 风险：去重口径未来变更（例如加入 query hash）会造成历史解释偏差。
  - 回滚：保持 `messageId+dedupeKey`，并在新版本升级到 `probe-journal/1.1`。

## 5) 最小验收命令与结果

1. `cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-p0-a7-probe-journal/packages/opencode && bun run typecheck`
   - exit code: `0`
2. `cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-p0-a7-probe-journal/packages/opencode && bun test test/retrieval/code.test.ts test/retrieval/runner.test.ts --bail`
   - exit code: `0`
3. `test -s /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-p0-a7-probe-journal/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p0-a7/probe-journal-spec.md`
   - exit code: `0`
4. `test -s /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-p0-a7-probe-journal/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p0-a7/probe-journal-dedupe-report.md`
   - exit code: `0`
