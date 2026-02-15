# F4-HQ P4D Compaction Runtime Hardening Replay Report

## 执行环境

- 仓库：`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src`
- worktree：`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-f4-hq-p4d-compaction-runtime-hardening`
- 分支：`codex/v16-f4-hq-p4d-compaction-runtime-hardening`

---

## RED 证据（先失败）

先执行：

```bash
cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-f4-hq-p4d-compaction-runtime-hardening/packages/opencode
TMPDIR=/tmp BUN_INSTALL=/tmp/bun-install bun test test/session/compaction-structured.test.ts
```

结果：`exit code = 1`

关键失败点（节选）：

- `assisted_status` 期望 `success/degraded/failed/disabled`，实际 `undefined`
- `assisted_timeout_ms`、`summary_format_version` 缺失
- 失败/超时降级说明不可见（无显式提示）

说明：RED 阶段已证实“事件/报告字段缺失 + 静默降级”问题真实存在。

---

## GREEN 证据（修复后通过）

### G1. 依赖安装

```bash
cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-f4-hq-p4d-compaction-runtime-hardening
TMPDIR=/tmp BUN_INSTALL=/tmp/bun-install bun install
```

结果：`exit code = 0`

### G2. Typecheck

```bash
cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-f4-hq-p4d-compaction-runtime-hardening/packages/opencode
TMPDIR=/tmp BUN_INSTALL=/tmp/bun-install bun run typecheck
```

结果：`exit code = 0`

### G3. 指定验收测试

```bash
cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-f4-hq-p4d-compaction-runtime-hardening/packages/opencode
TMPDIR=/tmp BUN_INSTALL=/tmp/bun-install bun test test/session/compaction-structured.test.ts test/session/compaction-structured-regression.test.ts test/session/compaction.test.ts test/session/capsule-assisted-verifier.test.ts --bail
```

结果：`exit code = 0`

通过要点：

- 默认 timeout 为 `30000ms`；
- `experimental.compaction_llm_timeout_ms` 可覆盖；
- `OPENCODE_EXPERIMENTAL_COMPACTION_LLM_TIMEOUT_MS` 可覆盖；
- assisted hint 仅接受 `# Compaction Summary` 风格；
- failed/timeout 时前台显示显式降级说明；
- report 与 assisted 事件字段一致并可判定展示来源。

---

## R1~R4 对应落点

- R1：`config.ts` + `flag.ts` + `compaction.ts` + `capsule-assisted.ts`
- R2：`capsule-assisted.ts`（hintSafe/humanHint 防护）+ `compaction-structured.test.ts`
- R3：`compaction.ts`（emitSkipped 时 updatePart 追加降级说明）+ `compaction-structured.test.ts`
- R4：`compaction-protocol.ts`（schema）+ `compaction.ts`（report runtime + 事件同步）+ `compaction-structured.test.ts`

---

## 仍存风险与后续建议

1. 当前 `summary_format_version` 采用字符串约定（`human-summary/1.0`、`assisted-summary/1.0`），后续建议收敛成协议枚举以减少消费者分歧。
2. report 在 compaction 主流程先写初值，再由 assisted 分支异步更新；如果外部消费者在极短窗口内读取，可能读到初值。建议下游以 `compaction.assisted_*` 事件或最终时间戳做二次确认。
3. 若后续引入多种降级分类，可将 `assisted_reason_code` 扩展为稳定 taxonomy 并补充文档。

