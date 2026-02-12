# CARD-BLK-06 / P3-5 执行卡（I.5）

- Owner: `Exec-AI-WORKER` + worker 协作负责人（待实名）
- 当前状态: `todo`
- 任务目标: `patch_planner` 对 heavy 写入任务 lift 实证
- 是否仅补证/可能需要最小实现: `仅补证`
- EvidencePath: `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-5/`

## DoD

1. 产出 `patch-planner-lift-report.md`。
2. 产出 `patch-planner-lift-raw.csv`（30 条对照）。
3. 给出 `常驻/条件启用/降级` 建议。

## 依赖关系

- 建议在 `I.3` 根因初步形成后执行。

## RollbackAction

- lift 不显著则不提升权重。

## 验收命令

```bash
test -s docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-5/patch-planner-lift-report.md \
  && test -s docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-5/patch-planner-lift-raw.csv \
  && bun --cwd packages/opencode test test/session/orchestrator-workers-v2.test.ts test/session/orchestrator-worker-contract.test.ts
```
