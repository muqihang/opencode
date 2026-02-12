# CARD-BLK-06 / P3-4 执行卡（I.4）

- Owner: `Exec-AI-SESSION` + session/processor 负责人（待实名）
- 当前状态: `todo`
- 任务目标: pointerContextOS 开关有效性 A/B 回放验证
- 是否仅补证/可能需要最小实现: `可能需要最小实现`
- EvidencePath: `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-4/`

## DoD

1. 产出 `pointerContextOS-ab-report.md`。
2. 包含 `pointer_hit_rate/claim_verify_rate/rerun_count` 三指标。
3. 结论明确为 `有效/无效/不稳定`。

## 依赖关系

- 建议在 `I.3` 初步结论后执行，减少变量干扰。

## RollbackAction

- 若无效/不稳定，开关任务降级 P1。

## 验收命令

```bash
test -s docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-4/pointerContextOS-ab-report.md \
  && bun --cwd packages/opencode test test/session/context-os-hydration.test.ts test/session/context-os-cache-key.test.ts
```
