# CARD-BLK-06 / P2-5 执行卡

- Owner: TBD
- 当前状态: todo
- ETA: Wave-3（可并行准备，最终签收在 `P2-4` 接口冻结后）
- EvidencePath: /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p2-5/

## DoD

1. 产出 `permission-baseline-matrix.md`，覆盖最小权限基线与跨平台差异。
2. 产出 `retention-dryrun-report.md`，先 dry-run 验证留存策略，不直接执行不可逆删除。
3. 产出 `export-audit-policy.md`，明确导出审计字段、保留周期、追踪责任人。

## 依赖关系

- 策略基线可先行；最终签收依赖 `P2-4` 分层存储接口冻结。

## 并行性判断

- 可并行准备；最终签收需串行等待 `P2-4`。

## RollbackAction

- retention 作业切回 dry-run only，停止实际清理并保留审计日志。

## 验收命令

```bash
test -s docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p2-5/permission-baseline-matrix.md \
  && test -s docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p2-5/retention-dryrun-report.md \
  && test -s docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p2-5/export-audit-policy.md \
  && bun --cwd packages/opencode test test/file/path-traversal.test.ts test/permission/next.test.ts test/tool/bash-approval-merge.test.ts
```

