# P2-1 Freshness Gate Report（MVP）

- 日期：2026-02-12
- 卡片：`CARD-BLK-06 / P2-1`
- Owner：`P2-1-FRESHNESS-01`
- 状态：MVP 门禁说明已完成（样本口径 + 阈值回指 + 实现验证）

## 1) 门禁目标

验证 `freshness` 元数据已进入 retrieval 主链，并明确“>=50 样本口径”的统计来源；本轮不改写任何既有 G/H 阈值。

## 2) “>=50 样本”口径与来源

### 2.1 口径定义

- 采用 nightly suite 的 `totals.tasks` 作为样本规模。
- 样本门槛：`tasks >= 50`。

### 2.2 实际来源

来源文件（绝对路径）：

- `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/packages/opencode/eval/suites-nightly/nightly_50_v1.json`

对应字段：

- `id = "nightly_50_v1"`
- `totals.tasks = 50`
- `totals.completedTasks = 44`
- `totals.citationChecks = 40`
- `totals.validCitations = 38`

结论：本报告样本口径满足 `>=50` 的最低门槛（`50/50`）。

## 3) 旧证据误用率对比（P2-1 阶段）

> 说明：P2-1 当前为 metadata + 透传最小实现，尚未引入新的 freshness 回滚阈值；因此本节采用“代理口径”给出前后可比信息。

### 3.1 代理指标定义

- `old_evidence_misuse_proxy = 1 - citation_integrity`
- nightly 套件口径下：
  - `citation_integrity = validCitations / citationChecks = 38 / 40 = 0.95`
  - `old_evidence_misuse_proxy = 0.05 (5.00%)`

### 3.2 对比结论

| 对比项 | 变更前（metadata 未落盘） | 变更后（metadata 已落盘） | 说明 |
|---|---:|---:|---|
| `old_evidence_misuse_proxy`（nightly 口径） | 5.00% | 5.00% | 本轮未改 G/H 阈值与离线 gate 计算逻辑，数值不变 |
| freshness 字段覆盖率（retrieval hits） | 0% | 100% | 通过 `code.test.ts + runner.test.ts` 验证 `observed_at/freshness_score/stale_reason` 全量可见 |

解释：P2-1 MVP 的增益是“可观测性与可门控前置能力”，不是立即改写离线 gate 计算值。

## 4) G/H 阈值回指（不改写）

回指决策文档：

- `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/2026-02-10-v1_6-final-collab-architecture-decision.md`

沿用且不改写：

- `G.1` 离线门禁（示例）：
  - `critic_degraded_rate <= 0.15`
  - `secure_output_pass_rate >= 0.95`
  - `rerun_count_per_message <= 2`
- `H.2` 自动回滚阈值（示例）：
  - `critic_degraded_rate` 恶化 `> 5pp`
  - `secure_output_pass_rate` 下降 `> 3pp`
  - `rerun_count_per_message` 连续 24h `> 2`

P2-1 结论：仅新增 freshness metadata，不对上述阈值做任何变更。

## 5) 实现门禁与验证结果

### 5.1 RED（先失败）

```bash
cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-p2-1-freshness-metadata/packages/opencode
bun test test/retrieval/code.test.ts --bail
bun test test/retrieval/runner.test.ts --bail
```

失败现象（节选）：`Expected: "string" / Received: "undefined"`（`hit.observed_at`）。

### 5.2 GREEN（修复后通过）

```bash
cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-p2-1-freshness-metadata/packages/opencode
bun test test/retrieval/code.test.ts test/retrieval/runner.test.ts --bail
```

结果：`4 pass / 0 fail`。

## 6) 风险与后续

- 当前风险：`freshness_score` 已可见，但尚未参与独立 gate 计算与排序策略调优。
- 后续建议：在不改写 G/H 既有阈值前提下，新增 shadow 指标（例如 stale 命中占比）做连续观测，再讨论是否进入 P2-2/P2-3 的策略联动。
