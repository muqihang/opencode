# F4-HQ-P0-LEDGER-MONO-DURABILITY 规格说明

- 任务代号：`F4-HQ-P0-LEDGER-MONO-DURABILITY`
- 范围：`packages/opencode/**`（不触及 `packages/app/**`）
- 目标：一次性修复两个 P0 阻断
  1. Evidence manifest 全链 append-only（不再按 path upsert 覆盖）
  2. Progress Monotonicity 持久化（跨重启保持 cycle/stop/degraded 单调）

## 1. 旧行为 vs 新行为

### 1.1 Evidence manifest

**旧行为**
- writer 侧按 `entry.path` 做 upsert：同一路径二次写入会覆盖旧记录。
- manifest 仅保存“最终快照”，缺失历史链路。
- reader 仅做 schema parse，不校验链完整性。

**新行为**
- writer 侧改为 append-only：每次写入都追加一条 ledger entry，不覆盖旧条目。
- entry 增加链字段：`sequence` + `prevHash` + `entryHash`。
- reader 侧增加链完整性校验，异常时 fail-closed（抛错，不静默放行）。
- 保留向后兼容：纯旧格式 manifest（无链字段）仍可读取。

### 1.2 Progress monotonicity

**旧行为**
- `cycle/stops/degraded` 仅在进程内内存结构（Map/Set）中保存。
- 进程重启后，state 丢失，可能出现 cycle 回拨、stop 丢失、degraded 事件重复。

**新行为**
- 新增持久化 store：`.opencode/context/<sessionId>/orchestrator-progress.json`。
- `reserve` 在原子锁内分配 cycle，保证跨重启单调。
- `stop/degraded` 持久化并在后续调用中恢复，避免重启后重复放行或重复降级事件。
- 引入 `version` 字段 + 原子写（tmp+rename）+ 文件锁目录，避免并发乱序。

## 2. 数据结构

## 2.1 Manifest 链条结构（等价于 sequence/prev_hash）

- 文件：`packages/opencode/src/protocol/evidence-manifest.ts`
- entry 新增字段：
  - `sequence: number`（正整数，1..N）
  - `prevHash: sha256`（上一条 entry 的 `entryHash`，首条使用 root hash）
  - `entryHash: sha256`（当前 entry 的确定性摘要）

链校验规则：
1. `sequence` 连续递增且不重复
2. `prevHash` 必须与上一条 `entryHash` 一致
3. `entryHash` 必须与当前 entry 规范化串重新计算一致

兼容策略：
- 全部 entry 均无链字段 -> 视为 legacy，允许读取。
- 出现混合（部分有、部分无）或链校验失败 -> fail-closed。

## 2.2 Progress 持久化结构

- 文件：`packages/opencode/src/session/orchestrator/progress-store.ts`
- 落盘 schema：`orchestrator-progress/1.0`
- 核心字段：
  - `version`: 单调递增版本号
  - `messages[messageId].cycle`: 当前 message 的最大 cycle
  - `messages[messageId].stopped`: 硬停状态（OR 单调）
  - `messages[messageId].degraded[]`: 已记录的降级 reason 集合（去重）

并发控制：
- 以 `orchestrator-progress.json.lock` 目录锁做进程间互斥。
- 锁内 read-modify-write，写入采用原子 rename。

## 3. 恢复流程（跨重启）

1. writer 调用 `reserve(sessionId, messageId, worker)`：
   - 从磁盘读取上次 state
   - 在锁内计算/保留单调 cycle
   - 持久化并返回 `{ cycle, stopped, degradedSet }`
2. 基于返回 state 计算本次 progress ledger 并发事件。
3. 若命中 stop 条件，调用 `stop()` 持久化硬停。
4. 若命中新 degraded reason，调用 `degraded()` 持久化去重键。
5. 下次进程启动后，重复步骤 1 即可恢复单调状态。

## 4. 关键实现落点

- manifest 协议与链工具：
  - `packages/opencode/src/protocol/evidence-manifest.ts`
- manifest append-only 写入与 latest 视图：
  - `packages/opencode/src/evidence/writer.ts`
  - `packages/opencode/src/evidence/macro-merge.ts`
  - `packages/opencode/src/evidence/export.ts`
- reader fail-closed 校验：
  - `packages/opencode/src/evidence/reader.ts`
- progress 持久化：
  - `packages/opencode/src/session/orchestrator/progress-store.ts`
  - `packages/opencode/src/session/orchestrator/writer.ts`

## 5. 风险与回退

### 5.1 风险
- manifest 由快照变为账本后，文件体积增长更快。
- 若历史链被外部篡改，reader 将 fail-closed，可能阻断导出/回放流程。
- progress store 引入文件锁，极端情况下可能出现锁等待。

### 5.2 回退策略
- 代码回退：恢复到 upsert manifest + 内存态 progress（对应本次改动前版本）。
- 数据回退：
  - manifest 链字段为可选，旧 reader 兼容无链格式。
  - progress store 是新增文件，不影响旧逻辑读取路径。
- 运行回退：若出现锁争用，先降级并发写场景，确认 lock 文件生命周期后再恢复。
