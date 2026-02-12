# CARD-BLK-06 / P3-8 执行卡（I.8）

- Owner: `Exec-AI-PMO` + 产品/评测负责人（待实名）
- 当前状态: `todo`
- 任务目标: 通用认知方案跨领域有效性验证
- 是否仅补证/可能需要最小实现: `仅补证`
- EvidencePath: `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-8/`

## DoD

1. 产出 `cross-domain-general-cognition-validation.md`。
2. 产出 `external-benchmark-manifest.md`。
3. 给出“继续沿用/收缩适用面”建议。

## 依赖关系

- 建议参考 `I.6` 与 `I.7` 结论统一评估维度。

## RollbackAction

- 若跨域不稳定，降级为工程假设。

## 验收命令

```bash
test -s docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-8/cross-domain-general-cognition-validation.md \
  && test -s docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-8/external-benchmark-manifest.md \
  && bun --cwd packages/opencode test test/eval/offline-regression.test.ts test/eval/offline-gate.test.ts
```
