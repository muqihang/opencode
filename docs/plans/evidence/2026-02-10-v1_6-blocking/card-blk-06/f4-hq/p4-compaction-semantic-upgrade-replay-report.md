# F4-HQ-P4-COMPACTION-SEMANTIC-UPGRADE Replay Report

## 变更摘要
- 手动 compaction 场景新增 `trigger_source=manual`，消除 `trigger: unknown` 不透明状态。
- 引入确定性语义提取：`goal`、`active_files`、`next_steps` 可由最近消息规则抽取。
- 新增 `compaction.quality` 事件，并将同构 `quality` 指标写入 `compaction.report.json`。

## RED（先失败）
- 测试文件：`test/session/compaction-structured.test.ts`
- 新增断言覆盖：
  1. R1：手动 compaction 必须有 `trigger_source: manual`，且不出现 `trigger: unknown`。
  2. R2：证据充足时，`goal/active_files/next_steps` 至少 2 项为 `known`。
  3. R3：必须写出 `compaction.quality` 事件，并具备五项质量指标。
- RED 结果：首次执行失败，失败点为 `trigger_source` 缺失（符合“先红”预期）。

## GREEN（修复后）
### 实现点
- `packages/opencode/src/session/compaction.ts`
  - 新增线性规则抽取：安全路径提取、下一步句提取、任务句优先的 goal 选择。
  - 写入 `trigger_source`（manual / auto:soft|hard|emergency）。
  - 计算并落盘 `quality`，新增 `compaction.quality` 事件。
- `packages/opencode/src/session/compaction-protocol.ts`
  - `CompactionReport` 新增 `quality` schema（5项指标）。

### GREEN 结果
- `compaction-structured` 与 `compaction-structured-regression` 测试通过。
- 质量指标在事件与 report 中字段一致。

## 旧行为 vs 新行为对照
- 旧：手动触发语义信息弱（`trigger: unknown`、`active_files/next_steps` 常年 unknown）。
- 新：可观测触发来源 + 确定性语义抽取 + 质量指标闭环（event/report 双落盘）。

## 质量指标样例
来自结构化场景样例（含路径与步骤证据）：
- `semantic_coverage: 1.0`
- `known_facts: 7`
- `unknown_facts: 0`
- `active_files_count: 2`
- `next_steps_count: 1`

## 风险与回退方案
### 风险
1. 规则抽取对非标准自然语言可能偏保守，部分场景仍可能输出 unknown。
2. report schema 增加 `quality` 后，旧版消费者若做严格字段校验需同步升级。

### 回退方案
1. 回滚到旧版 compaction facts/report 生成逻辑。
2. 保留新字段但置为保守值（unknown + 0），避免消费端断裂。
3. 继续依赖既有 fail-closed/replay 兜底，确保安全性不回退。
