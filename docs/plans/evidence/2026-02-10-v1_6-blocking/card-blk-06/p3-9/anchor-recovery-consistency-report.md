# P3-9 / I.9 - anchor 恢复一致性报告（compaction）

- Date: 2026-02-12
- Scope: 既有 compaction 代码与测试链路复核
- Branch: `codex/v16-p3-9-anchor-coverage`
- Mode: local-only, fail-fast, no-push

## 1) 覆盖目标与判定口径

- 目标: 验证 compaction 前后，anchor 相关快照/恢复链路的关键字段是否一致。
- 关键字段口径:
  - Pointer: `path`, `sha256`, `kind`, `anchor`
  - 恢复指针: `lastCapsuleSession.path/sha256`, `lastCapsuleRendered.path/sha256`

协议与字段定义证据：

- `packages/opencode/src/session/capsule-protocol.ts:25`
- `packages/opencode/src/session/capsule-protocol.ts:31`

## 2) Compaction 触发路径（>=2）

### 路径 A：手动 summarize 路由（服务端）

- `POST /:sessionID/summarize` 调用 `SessionCompaction.create(...)`。
- 证据:
  - `packages/opencode/src/server/routes/session.ts:572`
  - `packages/opencode/src/server/routes/session.ts:618`

### 路径 B：自动触发（上下文溢出）

- `prompt.loop` 中依据 token 结果调用 `SessionCompaction.trigger(...)`，命中后进入 `SessionCompaction.create(...)`。
- 证据:
  - `packages/opencode/src/session/prompt.ts:541`
  - `packages/opencode/src/session/prompt.ts:543`
  - `packages/opencode/src/session/prompt.ts:753`
  - `packages/opencode/src/session/prompt.ts:754`

### 路径 C：测试直调 process（结构化回归/证据）

- 现有测试直接走 `SessionCompaction.process(...)` 验证 artifacts/events。
- 证据:
  - `packages/opencode/test/session/compaction-structured.test.ts:63`
  - `packages/opencode/test/session/compaction-structured-regression.test.ts:119`

## 3) 恢复链路一致性证据

### 3.1 写入侧（compaction -> ledger/event/artifact）

- 生成并落盘：`capsule.session.json` 与 `capsule.md`。
- 更新 `ContextLedger`：`lastCapsuleSession` + `lastCapsuleRendered`。
- `compaction.completed` 事件携带 artifacts（含 path/sha256/kind）。

证据：

- `packages/opencode/src/session/compaction.ts:351`
- `packages/opencode/src/session/compaction.ts:363`
- `packages/opencode/src/session/compaction.ts:366`
- `packages/opencode/src/session/compaction.ts:452`
- `packages/opencode/src/session/compaction.ts:463`
- `packages/opencode/src/session/compaction.ts:469`

### 3.2 读取侧（prompt 恢复注入）

- 从 `ContextLedger.read(sessionID)` 读取 `lastCapsuleAssistedRendered?.path` / `lastCapsuleRendered?.path`。
- 依据 path 读取文件文本注入上下文。

证据：

- `packages/opencode/src/session/prompt.ts:657`
- `packages/opencode/src/session/prompt.ts:662`
- `packages/opencode/src/session/prompt.ts:665`
- `packages/opencode/src/session/prompt.ts:666`

### 3.3 测试侧（已有验证）

- `compaction-structured.test` 验证 compaction artifact 在 manifest 中可发现，且具备 `path/kind/sha256`，并验证文件存在；同时验证 started/completed 事件存在。
- `context-ledger.test` 验证扩展字段可从磁盘解析并保持值。

证据：

- `packages/opencode/test/session/compaction-structured.test.ts:73`
- `packages/opencode/test/session/compaction-structured.test.ts:85`
- `packages/opencode/test/session/compaction-structured.test.ts:88`
- `packages/opencode/test/session/compaction-structured.test.ts:93`
- `packages/opencode/test/session/context-ledger.test.ts:58`
- `packages/opencode/test/session/context-ledger.test.ts:59`

## 4) 一致性判定

### 可维持

- 当前 compaction 写入链路与恢复读取链路在 `path/sha256/kind` 维度有统一结构，且能通过现有测试证明“可落盘、可发现、可读取”。
- `Pointer` 统一字段集保留 `anchor`，结构层面可维持。

### 需扩展

- 现有 compaction 测试尚未断言“恢复读取文本内容与 `sha256` 一致”，`prompt.ts` 读取时也未做 `sha256` 校验。
- 现有测试未覆盖 provider 维度的 `anchor` 字段 round-trip（只验证结构，不验证 provider 分支一致性）。

## 5) 最小变更建议（如进入实现）

1. 在 `compaction-structured.test.ts` 新增断言：
   - 读取 `ContextLedger` 中 `lastCapsuleRendered.path`；
   - 计算文件 `sha256`，与 ledger / `compaction.completed.artifacts.capsule.sha256` 对齐。
2. 在 `capsule-protocol.test.ts` 与 `capsule.test.ts` 增加 `anchor` round-trip 与稳定排序后的保留断言。
3. 如需 provider 级补证，优先做参数化测试（openai/anthropic/google）覆盖 `anchor` 一致性。

## 6) 回滚动作

若任一路径验证失败（字段不一致或 hash 对不上）：

1. 暂停 compaction 自动触发路径（仅保留人工 summarize 路径）。
2. 仅允许已通过一致性断言的 provider 进入 anchor-snapshot 回放。
3. 保持现有 `Pointer` 字段集不扩面，待补证通过后再恢复默认路径。
