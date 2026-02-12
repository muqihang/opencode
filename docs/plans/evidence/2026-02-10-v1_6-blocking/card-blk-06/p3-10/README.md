# CARD-BLK-06 / P3-10 执行卡（I.10）

- Owner: `Exec-AI-ORCH` + 指标治理负责人（待实名）
- 当前状态: `todo`
- 任务目标: `evidence_gain_per_cycle` 阈值鲁棒性评估
- 是否仅补证/可能需要最小实现: `仅补证`
- EvidencePath: `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-10/`

## DoD

1. 产出 `evidence-gain-threshold-robustness.md`。
2. 产出 `low-gain-success-samples.csv`。
3. 给出阈值调整建议（仅建议，不直接改阈值）。

## 依赖关系

- 依赖 `I.7` 相关性结论。

## RollbackAction

- 证据不足则维持现有阈值。

## 验收命令

```bash
test -s docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-10/evidence-gain-threshold-robustness.md \
  && test -s docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-10/low-gain-success-samples.csv \
  && bun --cwd packages/opencode test test/session/adaptive-ttc-breaker.test.ts test/session/adaptive-ttc-policy.test.ts
```
