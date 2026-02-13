# migration switch log（P0-B5）

- Card: `CARD-BLK-06 / P0-B5`
- Date: `2026-02-13`
- Scope: `packages/opencode`（未修改 `packages/app/**`）

## 1) 切流开关与阶段映射

环境开关（运行时）：

- `OPENCODE_EXPERIMENTAL_STORAGE_LAYERING`
- `OPENCODE_EXPERIMENTAL_STORAGE_DUAL_WRITE`
- `OPENCODE_EXPERIMENTAL_STORAGE_RECONCILE`

阶段映射（`resolveStorageLayering().migration.stage`）：

- `v1-only`: 三个开关均关闭，写入 `v1-only`
- `dual-read`: 仅 `layering=1`
- `dual-write`: `layering=1` 且 `dual_write=1`
- `dual-write-reconcile`: `layering=1` 且 `dual_write=1` 且 `reconcile=1`

审计字段（新增）：

- `migration.writeMode`：`v1-only | v1-v2`
- `migration.readMode`：`v1-first | v2-first`
- `migration.cutover`：`{ enabled, key }`
- `migration.rollback`：`{ target: "v1-only", flags: { layering: "0", dualWrite: "0", reconcile: "0" } }`

## 2) 一键回退（v1-only）

回退动作（无停机）：

1. `OPENCODE_EXPERIMENTAL_STORAGE_RECONCILE=0`
2. `OPENCODE_EXPERIMENTAL_STORAGE_DUAL_WRITE=0`
3. `OPENCODE_EXPERIMENTAL_STORAGE_LAYERING=0`

回退后行为：

- `migration.stage = v1-only`
- `migration.writeMode = v1-only`
- 导出链路仍会携带已落盘的 `reconcile/dual-write-reconcile.json`（若文件存在），保证审计链不断裂

## 3) RED -> GREEN 证据

RED（先失败）：

```bash
cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-p0-b5-migration-dualwrite/packages/opencode \
  && bun test test/evidence/tenant-namespace.test.ts test/evidence/export-tenant-compat.test.ts test/evidence/evidence-export.test.ts --bail
```

- 失败点：缺失 `reconcile.switch` / `migration.*` 审计字段
- Exit: `1`

GREEN（最小实现后）：

```bash
cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-p0-b5-migration-dualwrite/packages/opencode \
  && bun test test/evidence/tenant-namespace.test.ts test/evidence/export-tenant-compat.test.ts test/evidence/evidence-export.test.ts --bail
```

- 结果：通过
- Exit: `0`

## 4) 异常判定与回滚阈值

异常判定：

- `dual-write-reconcile.summary.mismatched > 0`
- `reconcile/dual-write-reconcile.json` 导出缺失
- 导出或读链路出现 `protocol.violation` / `evidence.export_failed`

回滚阈值（命中即回退 `v1-only`）：

- 任意单次发布窗口出现不可解释 `mismatched > 0`
- `secure_output_pass_rate` 低于基线 `3pp`
- `critic_degraded_rate` 恶化超过 `5pp`

## 5) 最小验收命令与 exit code

1. `cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-p0-b5-migration-dualwrite/packages/opencode && bun run typecheck`
   - Exit: `0`
2. `cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-p0-b5-migration-dualwrite/packages/opencode && bun test test/evidence/tenant-namespace.test.ts test/evidence/export-tenant-compat.test.ts test/evidence/evidence-export.test.ts --bail`
   - Exit: `0`
3. `test -s /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-p0-b5-migration-dualwrite/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p0-b5/migration-switch-log.md`
   - Exit: `0`
4. `test -s /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-p0-b5-migration-dualwrite/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p0-b5/dualwrite-cutover-report.md`
   - Exit: `0`
