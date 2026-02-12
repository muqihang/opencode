# CARD-BLK-06 / P2-1 执行卡

- Owner: TBD
- 当前状态: todo
- ETA: Wave-1（前置项，优先派发）
- EvidencePath: /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p2-1/

## DoD

1. 产出 `freshness-metadata-spec.md`，定义 `freshness_score`、`observed_at`、`stale_reason` 字段与计算口径。
2. 产出 `freshness-gate-report.md`，至少覆盖 50 条回放样本并给出“旧证据误用率”对比。
3. 不改写既有阈值定义，报告中显式回指决策稿 `G/H` 门禁口径。

## 依赖关系

- 依赖 `P1-2`（检索主链收敛）与 `P0-B2`（EvidenceBundleV2）已稳定。

## 并行性判断

- `P2-1` 为前置项，必须先于 `P2-2` 与 `P2-3`。

## RollbackAction

- 关闭 freshness 评分开关，回退为既有检索排序并保留观测落盘。

## 验收命令

```bash
test -s docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p2-1/freshness-metadata-spec.md \
  && test -s docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p2-1/freshness-gate-report.md \
  && bun --cwd packages/opencode test test/retrieval/code.test.ts test/retrieval/runner.test.ts
```

