# CARD-BLK-06 / P3-6 执行卡（I.6）

- Owner: `Exec-AI-RETRIEVAL` + orchestrator 负责人（待实名）
- 当前状态: `todo`
- 任务目标: 双检索链收敛后召回/成本对照
- 是否仅补证/可能需要最小实现: `可能需要最小实现`
- EvidencePath: `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-6/`

## DoD

1. 产出 `dual-retrieval-recall-cost-report.md`。
2. 产出 `convergence-routing-decision.md`。
3. 给出是否允许进入 `I.7/I.10` 的结论。

## 依赖关系

- 依赖 `I.2` 噪声标注与 `I.3` 重复 planned 根因。

## RollbackAction

- 若召回下降或成本失控，回退单主链策略。

## 验收命令

```bash
test -s docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-6/dual-retrieval-recall-cost-report.md \
  && test -s docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-6/convergence-routing-decision.md \
  && bun --cwd packages/opencode test test/retrieval/e2e.test.ts test/session/orchestrator-tool-broker-policy.test.ts
```
