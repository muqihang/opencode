# P2-1 Freshness Metadata 规格（MVP）

- 日期：2026-02-12
- 卡片：`CARD-BLK-06 / P2-1`
- Owner：`P2-1-FRESHNESS-01`
- 状态：MVP 已落盘（metadata 可见 + hits artifact 透传）
- 证据目录（绝对路径）：`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p2-1/`

## 1) 目标与范围

本规格定义 retrieval hit 的最小 freshness 元数据，并约束其在以下路径可见：

1. code retrieval 命中（`packages/opencode/src/retrieval/code.ts`）
2. workbench retrieval 命中（`packages/opencode/src/retrieval/workbench.ts`）
3. retrieval runner 落盘产物（`retrieval/<retrievalId>/hits.json`）

本轮仅实现 metadata + 透传，不改写 G/H 阈值、不引入新的回滚阈值。

## 2) 命中字段契约（新增）

每条 hit 至少新增并保持以下字段：

- `observed_at: string`
  - 含义：命中写入时的观测时间（UTC ISO8601）。
  - 示例：`2026-02-12T08:21:13.584Z`
- `freshness_score: number`
  - 含义：时效性分值，取值区间 `[0, 1]`，值越大表示越新鲜。
- `stale_reason: string`
  - 含义：命中可能陈旧时的原因；空串表示当前无陈旧告警。

## 3) MVP 评分口径

### 3.1 code hit（`source` 维度）

- `lsp`：`freshness_score = 0.95`，`stale_reason = ""`
- `rg`：`freshness_score = 0.90`，`stale_reason = ""`
- `tree`：`freshness_score = 0.60`，`stale_reason = "source_tree_only"`

说明：`tree` 仅路径级命中，正文密度低，按保守口径降分并打陈旧标签。

### 3.2 workbench hit（`origin.kind` 维度）

- `pdf` / `docx` / `chunks`：`freshness_score = 0.85`，`stale_reason = ""`
- `archive`：`freshness_score = 0.70`，`stale_reason = "archive_snapshot"`

说明：归档类输入默认视为快照语义，因此保守降分并标注快照陈旧原因。

## 4) 透传与落盘要求

- code/workbench 返回 hit 时必须包含三字段。
- `runRetrieval` 在合并 code/workbench 命中并写 `hits.json` 时，必须保留三字段。
- cache hit 走 rehydrate 流程时，不得丢失 freshness 元数据。

## 5) TDD 证据（RED → GREEN）

### RED（先失败）

执行命令：

```bash
cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-p2-1-freshness-metadata/packages/opencode
bun test test/retrieval/code.test.ts --bail
bun test test/retrieval/runner.test.ts --bail
```

失败证据（节选）：

- `Expected: "string" / Received: "undefined"`（`hit.observed_at`）
- 同时在 `code.test.ts` 与 `runner.test.ts` 触发。

### GREEN（修复后通过）

执行命令：

```bash
cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-p2-1-freshness-metadata/packages/opencode
bun test test/retrieval/code.test.ts test/retrieval/runner.test.ts --bail
```

通过证据：

- `4 pass`
- `0 fail`

## 6) 回滚策略（与执行卡一致）

如需回滚行为，关闭 freshness 分值参与（排序/门控）即可；保留 `observed_at` 观测落盘用于排障与统计，不删除既有 hits artifact。
