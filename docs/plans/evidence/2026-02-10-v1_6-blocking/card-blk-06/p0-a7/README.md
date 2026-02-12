# CARD-BLK-06 / P0-A7 执行卡（F4 / V1）

- Owner: `Exec-AI-RETRIEVAL` + retrieval 负责人（待实名）
- 当前状态: `todo`
- 任务目标: 落地 `probe-journal/1.0`，统一增量探针账本与 dedupe 口径
- 是否仅补证/可能需要最小实现: `需要最小实现`
- EvidencePath: `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p0-a7/`

## DoD

1. 产出 `probe-journal/1.0` 结构，包含 `probeId/dedupeKey/why/expectedEvidence`。
2. retrieval 事件中可关联 probe 账本，支持 message 级去重核验。
3. 输出重复探针统计（为 `duplicate_probe_rate` 提供原生数据来源）。

## 依赖关系

- 依赖 `P0-A6` 锚点上下文字段可用。

## RollbackAction

- 若重复探针不可控，关闭增量探针策略并回退到单轮检索。

## 验收命令

```bash
bun --cwd packages/opencode run typecheck \
  && bun --cwd packages/opencode test test/retrieval/code.test.ts test/retrieval/runner.test.ts --bail
```
