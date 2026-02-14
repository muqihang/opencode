# F4-HQ-P0-RERUN-HARDSTOP-02 Spec

## 任务信息

- 任务名：`F4-HQ-P0-RERUN-HARDSTOP-02`
- 工作树：`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-f4-hq-p0-rerun-hardstop`
- 分支：`codex/v16-f4-hq-p0-rerun-hardstop`
- 范围：`packages/opencode/**` + `docs`（local-only，不 push）

## 修复目标

在 4+3 主链路中，抑制 `rerun/degraded` 风暴，保证 strict gate 硬门禁可过：

1. non-worker 模式（`chat`/`fork`）不进入 rerun breaker 语义链。
2. 同一 `session+message` 命中 `max_rerun` 后，后续重复 prepare/write 不再持续抬升 `rerun/cycle` 语义。
3. `adaptive_ttc` degraded 事件按 `message+reason` 去重，避免线性刷屏。

## 设计与实现

### 1) non-worker 模式旁路 rerun breaker

- 文件：`packages/opencode/src/session/orchestrator/plan.ts`
- 新增 `rerunMode(mode)`，仅 `assist/heavy` 参与 rerun 计数。
- 对 `chat/fork`：
  - `nextRerun(...)` 直接返回 `0`，并清理该 message 的 rerun 计数。
  - `applyRerunLimit(...)` 直接返回加好 budget 的 plan，不追加 `adaptive.ttc.max_rerun.stop`。

**理由**：`chat/fork` 不走 worker 回合，不存在 rerun breaker 的控制对象；让其参与 breaker 只会引入伪 stop 与噪声事件。

### 2) max_rerun 硬停闩锁（同 message）

- 文件：`packages/opencode/src/session/orchestrator/plan.ts`
  - rerun 计数 capped 到 `maxRerun + 1`，命中后不再继续增长。
- 文件：`packages/opencode/src/session/orchestrator/writer.ts`
  - 新增 `stops:Set<session:message>`。
  - 当 `stopReason=max_rerun_exceeded` 首次出现后标记闩锁。
  - 后续重复写入同 message：
    - 不再新增 `orchestrator.planned(stopReason=max_rerun_exceeded)` 行。
    - `cycle` 不再递增（冻结到首次 stop 时值）。

### 3) adaptive_ttc degraded 去重

- 文件：`packages/opencode/src/session/orchestrator/writer.ts`
- 新增 `degraded:Set<session:message:reason>`。
- reason 先做去重与稳定排序后拼接，作为去重 key 的组成部分。
- 相同 `message+reason` 只写一次 `orchestrator.degraded(stage=adaptive_ttc)`。

### 4) progress-ledger 口径修正

- non-worker 模式下，ledger 固定为单次 continue 语义：
  - `cycle=1`
  - `rerunCount=0`
  - `stopReason=not_stopped`
- worker 模式继续按原逻辑产出，但被 stop 闩锁约束，避免重复 stop 噪声。

## 修复前后口径差异

### 指标：`max_rerun`

- 修复前：`chat/fork` 在重复同 message prepare/build 下可能出现 `adaptive.ttc.max_rerun.stop`。
- 修复后：`chat/fork` 永不产出该 reason；仅 `assist/heavy` 参与。

### 指标：`stop_exceeded_rows`

- 定义：同一 message 上 `orchestrator.planned.data.stopReason == max_rerun_exceeded` 的重复行数。
- 修复前：可随重复流程线性增长。
- 修复后：一次性硬停闩锁；重复行不再增加（目标口径 `<=1`，新增重复行为 `=0`）。

### 指标：`orchestrator.degraded`（`stage=adaptive_ttc`）

- 修复前：同 message 同原因可重复刷出多条 degraded 事件。
- 修复后：按 `message+reason` 去重，重复流程不再线性增长。

## RED / GREEN 证据摘要

### RED（先失败）

- 命令：`cd .../packages/opencode && bun test test/session/orchestrator-plan.test.ts test/session/orchestrator-writer.test.ts test/session/orchestrator-turn.test.ts --bail`
- 退出码：`1`（新增 non-worker rerun breaker 约束在旧实现下失败，符合 RED 预期）

### GREEN（最小修复后）

- 命令：`cd .../packages/opencode && bun run typecheck`
- 退出码：`0`
- 命令：`cd .../packages/opencode && bun test test/session/orchestrator-plan.test.ts test/session/orchestrator-writer.test.ts test/session/orchestrator-turn.test.ts --bail`
- 退出码：`0`

## 已知风险与后续卡点

1. 去重/闩锁当前为进程内内存态（Map/Set），进程重启后不保留；跨进程去重仍依赖事件侧汇聚。
2. `stop_exceeded_rows` 采用一次性 stop 事件策略（`<=1`），若后续策略改为完全静默 stop，需要同步更新测试与文档口径。
3. rerun 语义当前以 `session+message` 为 key；若未来要引入更细粒度（如 planId 维度），需要评估兼容性与回放一致性。

## 最小验收命令（A4/B5）

- `cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-f4-hq-p0-rerun-hardstop/packages/opencode && bun run typecheck`
- `cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-f4-hq-p0-rerun-hardstop/packages/opencode && bun test test/session/orchestrator-plan.test.ts test/session/orchestrator-writer.test.ts test/session/orchestrator-turn.test.ts --bail`

