# dualwrite cutover report（P0-B5）

- Card: `CARD-BLK-06 / P0-B5`
- Date: `2026-02-13`
- Branch: `codex/v16-p0-b5-migration-dualwrite`
- Worktree: `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-p0-b5-migration-dualwrite`

## 1) 最小实现范围

代码变更（最小闭环）：

- `packages/opencode/src/evidence/storage-layering.ts`
  - 增加 `migration` 审计对象（阶段、读写模式、切流键、回退目标与开关模板）
- `packages/opencode/src/evidence/writer.ts`
  - `writer.reconcile()` 报告新增 `switch` 字段，落盘形成切流审计证据
- `packages/opencode/src/evidence/export.ts`
  - 导出链路改为“只要 reconcile 文件存在就导出”，不依赖当前运行时开关，支持回退后审计连续性

测试补强（RED->GREEN）：

- `packages/opencode/test/evidence/tenant-namespace.test.ts`
  - 覆盖迁移开关生效 + v1-only 回退可验证
- `packages/opencode/test/evidence/export-tenant-compat.test.ts`
  - 覆盖切流记录可审计 + 回退后 reconcile 仍可导出
- `packages/opencode/test/evidence/evidence-export.test.ts`
  - 覆盖 reconcile 导出链路完整

## 2) 切流开关与回退步骤

切流（推荐顺序）：

1. `OPENCODE_EXPERIMENTAL_STORAGE_LAYERING=1`
2. `OPENCODE_EXPERIMENTAL_STORAGE_DUAL_WRITE=1`
3. `OPENCODE_EXPERIMENTAL_STORAGE_RECONCILE=1`

回退（v1-only）：

1. `OPENCODE_EXPERIMENTAL_STORAGE_RECONCILE=0`
2. `OPENCODE_EXPERIMENTAL_STORAGE_DUAL_WRITE=0`
3. `OPENCODE_EXPERIMENTAL_STORAGE_LAYERING=0`

审计锚点：

- `reconcile.switch.stage`
- `reconcile.switch.cutover.key`
- `reconcile.switch.rollback.target`
- `reconcile.switch.rollback.flags`

## 3) RED -> GREEN 结果

RED：

- 命令：
  - `cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-p0-b5-migration-dualwrite/packages/opencode && bun test test/evidence/tenant-namespace.test.ts test/evidence/export-tenant-compat.test.ts test/evidence/evidence-export.test.ts --bail`
- 结果：失败（缺失切流审计字段）
- Exit: `1`

GREEN：

- 命令：
  - `cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-p0-b5-migration-dualwrite/packages/opencode && bun test test/evidence/tenant-namespace.test.ts test/evidence/export-tenant-compat.test.ts test/evidence/evidence-export.test.ts --bail`
- 结果：通过
- Exit: `0`

## 4) 异常判定与回滚阈值

异常判定：

- `dual-write-reconcile.json` 中 `summary.mismatched > 0`
- 回退后导出缺失 `reconcile/dual-write-reconcile.json`
- 出现 `evidence.export_failed` 或无法定位 `cutover.key`

回滚阈值：

- 任意发布窗口 `mismatched > 0` 且无法快速修复
- `secure_output_pass_rate` 相对基线下降超过 `3pp`
- `critic_degraded_rate` 相对基线恶化超过 `5pp`

回滚动作：

1. 立即执行 v1-only 回退三开关
2. 冻结迁移窗口
3. 保留并导出 reconcile 报告用于复盘

## 5) 最小验收命令与 exit code

1. `cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-p0-b5-migration-dualwrite/packages/opencode && bun run typecheck`
   - Exit: `0`
2. `cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-p0-b5-migration-dualwrite/packages/opencode && bun test test/evidence/tenant-namespace.test.ts test/evidence/export-tenant-compat.test.ts test/evidence/evidence-export.test.ts --bail`
   - Exit: `0`
3. `test -s /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-p0-b5-migration-dualwrite/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p0-b5/migration-switch-log.md`
   - Exit: `0`
4. `test -s /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-p0-b5-migration-dualwrite/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p0-b5/dualwrite-cutover-report.md`
   - Exit: `0`
