# F4-HQ P4E Compaction Default Preserve Replay Report

## 执行环境

- 仓库：`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src`
- worktree：`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-f4-hq-p4e-compaction-default-preserve`
- 分支：`codex/v16-f4-hq-p4e-compaction-default-preserve`

---

## RED 证据（先失败）

### R1 默认开启用例先失败

```bash
cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-f4-hq-p4e-compaction-default-preserve/packages/opencode
TMPDIR=/tmp BUN_INSTALL=/tmp/bun-install bun test test/session/compaction-structured.test.ts --bail
```

结果：`exit code = 1`

关键失败：

- 新增用例 `defaults to assisted flow when config/env are unset...` 期望 `assisted_status=failed`，实际为 `disabled`；
- 证明默认路径仍未触发 assisted 流程。

### R2 主响应保全用例先失败

```bash
cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-f4-hq-p4e-compaction-default-preserve/packages/ui
TMPDIR=/tmp BUN_INSTALL=/tmp/bun-install bun test src/components/session-turn.test.ts --bail
```

结果：`exit code = 1`

关键失败：

- `selectResponsePart` 尚不存在（`Export named 'selectResponsePart' not found`）；
- 证明 R2 测试在修复前不可通过。

---

## GREEN 证据（修复后通过）

### G1 验收命令 1（依赖安装）

```bash
cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-f4-hq-p4e-compaction-default-preserve
TMPDIR=/tmp BUN_INSTALL=/tmp/bun-install bun install
```

结果：`exit code = 0`

### G2 验收命令 2（opencode typecheck + 指定测试）

```bash
cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-f4-hq-p4e-compaction-default-preserve/packages/opencode
TMPDIR=/tmp BUN_INSTALL=/tmp/bun-install bun run typecheck
TMPDIR=/tmp BUN_INSTALL=/tmp/bun-install bun test test/session/compaction-structured.test.ts test/session/compaction-structured-regression.test.ts test/session/compaction.test.ts test/session/capsule-assisted-verifier.test.ts --bail
```

结果：`exit code = 0`

通过要点：

- 默认未配置场景会尝试 assisted（不再固定 `disabled`）；
- 显式 `compaction_llm_augment: false` 仍保持 `disabled`；
- failed/degraded/disabled 场景有用户可见回落说明；
- report 持续包含并更新 `ui_view_source`、`assisted_status`、`assisted_timeout_ms`、`summary_format_version`。

### G3 验收命令 3（ui typecheck）

```bash
cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-f4-hq-p4e-compaction-default-preserve/packages/ui
TMPDIR=/tmp BUN_INSTALL=/tmp/bun-install bun run typecheck
```

结果：`exit code = 0`

### G4 受影响 UI 单测补跑

```bash
cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-f4-hq-p4e-compaction-default-preserve/packages/ui
TMPDIR=/tmp BUN_INSTALL=/tmp/bun-install bun test src/components/session-turn.test.ts
```

结果：`exit code = 0`

---

## 结果对照（R1~R4）

- R1：新增默认开启回归用例，修复后 `assisted_status` 非固定 `disabled`，显式 false 仍 `disabled`。
- R2：`SessionTurn` 主响应选择排除 `mode="compaction"`，新增 UI 单测验证主结果不被覆盖。
- R3：compaction skip（failed/degraded/disabled）统一追加可见提示，避免静默回退。
- R4：report/event 运行态字段持续可判定并由测试断言。

