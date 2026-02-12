# CARD-BLK-06 / P2-4 执行卡

- Owner: TBD
- 当前状态: todo
- ETA: Wave-2（可与 `P2-2` 并行）
- EvidencePath: /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p2-4/

## DoD

1. 产出 `storage-layering-design.md`，定义三层职责、读写路径、租户边界。
2. 产出 `dual-write-reconcile-report.md`，记录双写期间一致性对账结果。
3. 产出 `migration-playbook.md`，包含切换步骤、失败回退步骤、停机影响说明。

## 依赖关系

- 依赖 `P0-A6/A7/A8` 协议地基（snapshot/probe/progress）已可复用。

## 并行性判断

- 可与 `P2-2` 并行；与 `P2-5` 存在接口冻结依赖。

## RollbackAction

- 停用双写与新读路径，恢复 `L0` 单层读写并保留迁移日志。

## 验收命令

```bash
test -s docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p2-4/storage-layering-design.md \
  && test -s docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p2-4/dual-write-reconcile-report.md \
  && test -s docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p2-4/migration-playbook.md \
  && bun --cwd packages/opencode test test/evidence/tenant-namespace.test.ts test/evidence/export-tenant-compat.test.ts test/evidence/evidence-export.test.ts
```

