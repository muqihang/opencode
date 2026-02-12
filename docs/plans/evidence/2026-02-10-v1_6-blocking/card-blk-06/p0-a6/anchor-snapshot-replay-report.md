# anchor-snapshot/1.0 回放报告（P0-A6）

## 1. RED -> GREEN 证据

### RED（先失败）

- 命令：
  - `cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-p0-a6-anchor-snapshot/packages/opencode && bun test test/session/context-pack-determinism.test.ts test/session/compaction-structured.test.ts --bail`
- 结果：`exit code = 1`
- 关键失败：`Cannot find module '../../src/session/anchor-snapshot'`
- 结论：新增断言已生效，功能未实现时按预期失败。

### GREEN（最小实现后）

- 命令：
  - `cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-p0-a6-anchor-snapshot/packages/opencode && bun test test/session/context-pack-determinism.test.ts test/session/compaction-structured.test.ts --bail`
- 结果：`exit code = 0`
- 结论：
  - `specVersion=anchor-snapshot/1.0` 固定值断言通过
  - `session/message/plan/toolsetFingerprint` 字段存在且可解析
  - 缺失 anchor 的恢复链路触发 fail-closed 并返回 `stop`

## 2. 最小验收命令与 exit code（A6）

> 本卡在隔离 worktree 中执行，命令与原口径一致，仅将路径指向本卡 worktree。

1. `cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-p0-a6-anchor-snapshot/packages/opencode && bun run typecheck`
   - `exit code = 0`
2. `cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-p0-a6-anchor-snapshot/packages/opencode && bun test test/session/context-pack-determinism.test.ts test/session/compaction-structured.test.ts --bail`
   - `exit code = 0`
3. `test -s /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-p0-a6-anchor-snapshot/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p0-a6/anchor-snapshot-spec.md`
   - `exit code = 0`
4. `test -s /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-p0-a6-anchor-snapshot/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p0-a6/anchor-snapshot-replay-report.md`
   - `exit code = 0`

## 3. 风险与回滚口径

### 已识别风险

1. `planId/repo.head/repo.dirty` 在 V1 为最小占位（`unknown`/`false`），语义完整度低于最终态。
2. fail-closed 打开后，历史会话若仅有 `lastContextPackId` 无 anchor，将主动停止恢复链路。

### 回滚口径

1. 若线上出现异常拦截，可回退本卡变更并恢复既有 compaction 行为。
2. 回滚后保持 `P0-A6 未签收`，不得推进依赖其锚点语义的后续任务（`P0-A7/P0-A8`）。
3. 回滚期间继续保留现有证据目录，避免执行证据链断裂。
