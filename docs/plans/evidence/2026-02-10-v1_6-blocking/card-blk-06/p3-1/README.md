# CARD-BLK-06 / P3-1 执行卡（I.1）

- Owner: `Exec-AI-SECURE` + 应用层负责人（待实名）
- 当前状态: `todo`
- 任务目标: `secure-output` 失配机理分层（合同到达率 vs 合同遵守率）
- 是否仅补证/可能需要最小实现: `可能需要最小实现`
- EvidencePath: `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-1/`

## DoD

1. 产出 `contract-delivery-compliance-split.md`。
2. 产出 `provider-wire-snapshot-ledger.csv`（覆盖 20 条样本）。
3. 明确 `unknown` 是否清零并给出签收建议。

## 依赖关系

- 依赖 `CARD-BLK-01` 既有样本与 `ND-I1-PROVIDER-WIRE-01` 账本。

## RollbackAction

- 分层证据不收敛则维持 `Final No-Go`，不放开相关上线。

## 验收命令

```bash
test -s docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-1/contract-delivery-compliance-split.md \
  && test -s docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-1/provider-wire-snapshot-ledger.csv \
  && bun --cwd packages/opencode test test/session/llm.test.ts test/secure-output/secure-output.test.ts
```
