# CARD-BLK-06 / P3-2 执行卡（I.2）

- Owner: `Exec-AI-RETRIEVAL` + retrieval 负责人（待实名）
- 当前状态: `todo`
- 任务目标: topK 噪声构成标注，明确是否需要调整 topK/rerank
- 是否仅补证/可能需要最小实现: `仅补证`
- EvidencePath: `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-2/`

## DoD

1. 产出 `topk-noise-breakdown.md`。
2. 产出 `topk-noise-labeled.csv`（至少 50 条）。
3. 给出“立即调整/继续观察”结论。

## 依赖关系

- 无硬依赖；可并行参考 `I.3` trace 结果。

## RollbackAction

- 若标注冲突 `>15%`，扩样后再决策，不改阈值。

## 验收命令

```bash
test -s docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-2/topk-noise-breakdown.md \
  && test -s docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-2/topk-noise-labeled.csv \
  && bun --cwd packages/opencode test test/retrieval/code.test.ts test/retrieval/runner.test.ts
```
