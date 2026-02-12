# CARD-BLK-06 / P0-A6 执行卡（F4 / V1）

- Owner: `Exec-AI-SESSION` + 架构负责人（待实名）
- 当前状态: `todo`
- 任务目标: 落地 `anchor-snapshot/1.0`，确保锚点快照可回放可核验
- 是否仅补证/可能需要最小实现: `需要最小实现`
- EvidencePath: `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p0-a6/`

## DoD

1. 形成 `anchor-snapshot/1.0` 结构化产物（含 `toolsetFingerprint` 等核心字段）。
2. 至少 20 条回放样本可验证锚点字段完整性与可解析性。
3. 产出 fail-closed 规则：锚点缺失或校验失败时停止恢复链路。

## 依赖关系

- 无硬依赖；作为 `P0-A7/P0-A8` 前置。

## RollbackAction

- 若锚点一致性不达标，维持旧恢复路径并禁止启用后续 V2 恢复特性。

## 验收命令

```bash
bun --cwd packages/opencode run typecheck \
  && bun --cwd packages/opencode test test/session/context-pack-determinism.test.ts test/session/compaction-structured.test.ts --bail
```
