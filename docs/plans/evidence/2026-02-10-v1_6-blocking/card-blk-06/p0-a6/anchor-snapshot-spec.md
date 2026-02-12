# anchor-snapshot/1.0 规格说明（P0-A6 最小实现）

## 1. 目标与范围

- 卡片：`CARD-BLK-06 / P0-A6`
- 目标：在现有 session/context/ledger/compaction 链路落地 `anchor-snapshot/1.0` 最小可用实现。
- 实现边界：仅补齐锚点快照结构、落盘、事件、以及恢复链路 fail-closed 语义；不做跨卡重构。

## 2. 字段定义与来源

| 字段 | 含义 | 来源（代码路径） |
|---|---|---|
| `specVersion` | 固定协议版本 | `packages/opencode/src/session/anchor-snapshot.ts` |
| `sessionId` | 会话标识 | LLM/Compaction 输入 `sessionID` |
| `messageId` | 当前轮消息标识 | LLM 使用 `input.user.id`；Compaction 使用 `input.parentID` |
| `planId` | 计划锚点标识（V1 最小实现） | 当前固定为 `"unknown"`（占位，保证字段存在可解析） |
| `generatedAtUtc` | 生成时间（UTC） | 运行时 `new Date().toISOString()` |
| `repo.head` | 仓库快照头（V1 最小实现） | 当前 `"unknown"` 或沿用上轮 anchor |
| `repo.dirty` | 工作区脏标识（V1 最小实现） | 当前 `false` 或沿用上轮 anchor |
| `model.providerId/modelId` | 运行模型信息 | LLM/Compaction 模型输入 |
| `context.lastContextPackId` | 上一上下文包指针 | `ContextLedger.lastContextPackId` |
| `context.orchestratorMode` | 调度模式 | LLM 取 `retrievalRoute.main.mode`；Compaction 沿用上轮或 `"unknown"` |
| `toolsetFingerprint` | 工具集指纹 | LLM 使用 `blocks.toolsetFingerprint`；Compaction 沿用上轮或 `"unknown"` |

## 3. 产物与事件

### 3.1 落盘产物

- LLM 链路：`context/<contextPackId>/anchor.snapshot.json`
- Compaction 链路：`compaction/<compactionId>/anchor.snapshot.json`

### 3.2 事件

- 新增事件类型：`anchor.snapshot`
- 事件 actor：
  - LLM：`session:llm`
  - Compaction：`session:compaction`

## 4. Ledger 变更

在 `context-ledger/1.0` 结构中新增可选字段：

- `lastAnchorSnapshot: { path: string; sha256: string }`

用途：为恢复链路提供上一轮 anchor 指针。

## 5. fail-closed 最小语义（恢复链路）

在 `SessionCompaction.process()` 中新增恢复前校验：

1. 若存在 `lastContextPackId` 但缺失 `lastAnchorSnapshot`，立即 `fail-closed`。
2. 若存在 `lastAnchorSnapshot` 但文件不可读或 schema 解析失败，立即 `fail-closed`。
3. fail-closed 行为：
   - 返回 `"stop"`
   - 记录 `compaction.cancelled` 事件
   - 产出 `reason_zh` + `next_steps_zh`

## 6. 变更文件（本卡范围）

- `packages/opencode/src/session/anchor-snapshot.ts`
- `packages/opencode/src/session/context-ledger.ts`
- `packages/opencode/src/session/llm.ts`
- `packages/opencode/src/session/compaction.ts`
- `packages/opencode/test/session/context-pack-determinism.test.ts`
- `packages/opencode/test/session/compaction-structured.test.ts`
