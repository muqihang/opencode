# CARD-BLK-06 / P4-1 执行卡（I.1 外部闭环）

- Owner: `Exec-AI-SECURE` + 应用层负责人（待实名）
- 当前状态: `todo`
- 任务属性: `外部闭环卡`
- 任务目标: 完成 `provider-wire` 20/20 外部闭环，解除 `I.1` 最终签收前置阻塞
- EvidencePath: `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p4-1/`

## DoD

1. `provider-wire 20/20` 全量非 `unknown`。
2. `prompt_hash` 可对账并形成最终对账说明。
3. 最终签收人明确并形成签收结论。

## 证据产物

- `provider-wire-intake-final.csv`
- `provider-wire-reconcile-final.md`
- `i1-final-signoff.md`

## 失败口径

- 任一字段 `unknown`，即判定 `BLOCKED`。

## RollbackAction

- 若未达成 DoD，维持 `I.1` 外部阻塞与 `Final` 不放行口径。

## 验收命令

```bash
test -s docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p4-1/provider-wire-intake-final.csv \
  && test -s docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p4-1/provider-wire-reconcile-final.md \
  && test -s docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p4-1/i1-final-signoff.md
```
