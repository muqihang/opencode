# CARD-BLK-06 / P0-B5 执行卡（F4 / V2）

- Owner: `Exec-AI-PMO` + 迁移负责人（待实名）
- 当前状态: `todo`
- 任务目标: 完成 v1/v2 协议迁移双读双写与可回退切流
- 是否仅补证/可能需要最小实现: `需要最小实现`
- EvidencePath: `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p0-b5/`

## DoD

1. 迁移开关与切流记录完整，支持一键回退 v1-only。
2. 双写对账报告稳定产出，异常可定位。
3. 导出路径包含 reconcile 证据，满足审计。

## 依赖关系

- 依赖 `P0-B1~P0-B4` 稳定。

## RollbackAction

- 切流异常立即回退 v1-only 并冻结迁移窗口。

## 验收命令

```bash
bun --cwd packages/opencode run typecheck \
  && bun --cwd packages/opencode test test/evidence/tenant-namespace.test.ts test/evidence/export-tenant-compat.test.ts test/evidence/evidence-export.test.ts --bail
```
