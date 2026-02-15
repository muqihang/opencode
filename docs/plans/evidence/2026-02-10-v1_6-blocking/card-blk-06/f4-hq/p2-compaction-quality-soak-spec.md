# F4-HQ-P2-COMPACTION-QUALITY-SOAK Spec

## 审计输入与范围（P2）
本实现严格基于以下审计输入：
- `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/f4-hq/f4-hq-architecture-audit-2026-02-14.md`
- `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/f4-hq/f4-hq-architecture-improvement-backlog-2026-02-14.csv`

对应 P2 backlog 行（row id / 标题）：
- `F4-AUD-008` / `Compaction consistency metrics`
- `F4-AUD-009` / `Long-session restart soak suite`

本次只落地 P2 质量与 soak 证据，不修改 `packages/app/**`。

## 目标
将 compaction 质量从 coverage-only 升级为 coverage + consistency + contradiction，并补齐跨重启/长会话 soak 证据链。

## 协议与事件新增字段
在 `compaction.report.json.quality` 与 `compaction.quality` 事件中新增：
- `consistency_score`（`0..1`）
- `contradiction_count`（`>=0`）
- `reason_codes`（`string[]`，snake_case）

同时保留已有字段（`semantic_coverage`、`known_facts`、`unknown_facts`、`active_files_count`、`next_steps_count`），确保向后兼容。

## Deterministic 计算设计（禁用 LLM）
实现位置：
- `packages/opencode/src/session/compaction.ts`
- `packages/opencode/src/session/compaction-protocol.ts`

### 1) consistency_score
基于 4 个 domain 的可用性信号（`goal/decisions/openQuestions/working_set`）计算基础分，再乘以冲突惩罚：
- `domainScore = known_domains / 4`
- `penalty = 1 / (1 + contradiction_count)`
- `consistency_score = round3(domainScore * penalty)`

### 2) contradiction_count
从 `goal/decisions/openQuestions/working_set` 收集 statement，提取 deterministic claim key：
- 优先路径级 key（安全路径规范化）
- 回退关键词 key（去停用词、规范化）

通过否定模式（`do not/avoid/remove/disable/...` 与对应中文否定语义）判定 polarity；同一 claim key 同时出现正/负极性即计为矛盾。

### 3) reason_codes
根据状态生成 snake_case 原因码，包含但不限于：
- `goal_unknown`
- `working_set_empty`
- `open_questions_pending`
- `contradiction_detected`
- `consistency_low`
- `consistency_partial`

并执行去重与排序，保证 deterministic。

## soak 证据链设计
新增 `packages/opencode/test/session/compaction-restart-soak.test.ts`：
- 至少 3 轮 compaction
- 通过动态重新加载 `compaction` 模块模拟重启后继续
- 验证 `compaction.report.previous.compactionId` 链条连续
- 验证 `compaction.completed` 计数单调递增（1 → 2 → 3）
- 验证 `state.json.lastCompactionId` 与最新 report 对齐

另对 `orchestrator` 进度持久化测试补充单调性断言（cycle 与持久化文件）。

## 兼容性与风险
### 兼容性
- 未移除任何旧字段。
- 新字段追加到 `quality` 对象，不影响旧字段读取。

### 风险
1. 规则冲突检测对自由文本存在保守性（宁可低召回，避免伪冲突）。
2. 消费端若对 `quality` 做严格 schema 校验，需同步接收新增字段。

### 回退
- 可仅回退新增 quality 字段与计算函数，恢复旧质量模型。
- 事件/报告链保持 fail-closed 语义，不影响既有安全门控。
