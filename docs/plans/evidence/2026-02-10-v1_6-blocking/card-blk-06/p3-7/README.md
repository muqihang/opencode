# CARD-BLK-06 / P3-7 执行卡（I.7）

- Owner: `Exec-AI-EVAL` + 评测负责人（待实名）
- 当前状态: `todo`
- 任务目标: `critic verdict` 与任务成功相关性验证
- 是否仅补证/可能需要最小实现: `仅补证`
- EvidencePath: `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-7/`

## DoD

1. 产出 `critic-verdict-completion-regression.md`。
2. 产出 `critic-verdict-dataset.csv`。
3. 给出 verdict 是否可作为门禁代理信号的结论。

## 依赖关系

- 依赖 `I.6` 收敛策略稳定后采样。

## RollbackAction

- 相关性不足则不绑定为发布门禁。

## 验收命令

```bash
test -s docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-7/critic-verdict-completion-regression.md \
  && test -s docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-7/critic-verdict-dataset.csv \
  && bun --cwd packages/opencode test test/session/orchestrator-evidence-critic.test.ts test/verification/verification-worker.test.ts
```
