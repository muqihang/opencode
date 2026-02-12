# CARD-BLK-06 / P3-3 执行卡（I.3）

- Owner: `Exec-AI-ORCH` + orchestrator 负责人（待实名）
- 当前状态: `todo`
- 任务目标: message 级重复 planned 根因定位
- 是否仅补证/可能需要最小实现: `可能需要最小实现`
- EvidencePath: `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-3/`

## DoD

1. 产出 `planned-repeat-root-cause.md`。
2. 产出 `planned-repeat-samples.json`（至少 10 条）。
3. 给出 breaker 收紧可行性结论。

## 依赖关系

- 依赖 `P0-A8 progress-ledger` 字段可用。

## RollbackAction

- 根因不明确时保持观测增强，不推进 breaker 收紧。

## 验收命令

```bash
test -s docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-3/planned-repeat-root-cause.md \
  && test -s docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-3/planned-repeat-samples.json \
  && bun --cwd packages/opencode test test/session/orchestrator-tool-broker.test.ts test/session/orchestrator-turn.test.ts
```
