# F4-HQ-P4C-COMPACTION-UX-LLM-UNIFICATION-01 重放报告（RED→GREEN）

## 环境与基线
- 仓库：`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src`
- 隔离 worktree：`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-f4-hq-p4c-compaction-ux-llm-unification`
- 分支：`codex/v16-f4-hq-p4c-compaction-ux-llm-unification`
- 祖先检查：`85d273588` 为 `HEAD` 祖先（通过）。

## RED 失败点（先失败）

### RED-1：用户摘要仍为机器视图
- 命令：
  - `TMPDIR=/tmp BUN_INSTALL=/tmp/bun-install bun test test/session/compaction-structured.test.ts --bail`
- 结果：`exit 1`
- 失败要点：
  - 断言 `# Compaction Summary` 未出现（当时输出仍是 `# Capsule`）。
  - 说明 deterministic summary 仍在泄漏机器结构。

### RED-2：污染输入未满足 unknown 回落
- 命令：
  - `TMPDIR=/tmp BUN_INSTALL=/tmp/bun-install bun test test/session/compaction-structured-regression.test.ts --bail`
- 结果：`exit 1`
- 失败要点：
  - `## Next Steps\n- unknown` 断言失败。
  - 说明 next_steps 抽取仍受噪声影响，未稳定 fail-safe。

## GREEN 通过证据

### 验收命令 1
- 命令：
  - `TMPDIR=/tmp BUN_INSTALL=/tmp/bun-install bun install`
- 结果：`exit 0`

### 验收命令 2
- 命令：
  - `cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-f4-hq-p4c-compaction-ux-llm-unification/packages/opencode && TMPDIR=/tmp BUN_INSTALL=/tmp/bun-install bun run typecheck`
- 结果：`exit 0`

### 验收命令 3
- 命令：
  - `cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-f4-hq-p4c-compaction-ux-llm-unification/packages/opencode && TMPDIR=/tmp BUN_INSTALL=/tmp/bun-install bun test test/session/compaction-structured.test.ts test/session/compaction-structured-regression.test.ts test/session/compaction.test.ts test/session/capsule-assisted-verifier.test.ts --bail`
- 结果：`exit 0`
- 关键摘要：`39 pass / 0 fail`。

## 回归覆盖与验收结论
- R1：新增机器字段黑名单断言，验证 summary part（用户可见）不含机器字段。
- R2：新增“config=true 可触发 assisted.requested”断言，验证不再被 runner env 硬门禁短路。
- R3：验证 deterministic 先可见，assisted success + verifyOk 后被 LLM 视图覆盖，且 `ui_view_source=llm`。
- R4：验证 degraded/failed/disabled 路径保持 deterministic（且是人类可读），并带明确 skipped reason。
- R5：新增污染回归样例，验证规范化去噪、去重与 unknown 回落。

## 风险与后续建议
- 建议后续增加 snapshot 级别用例，锁定 Summary 渲染格式演进。
- 建议给 `compaction.assisted_*` 事件加文档约束（字段兼容策略），减少下游解析漂移风险。
