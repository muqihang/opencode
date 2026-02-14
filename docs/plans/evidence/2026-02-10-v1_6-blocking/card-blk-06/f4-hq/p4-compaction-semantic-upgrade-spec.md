# F4-HQ-P4-COMPACTION-SEMANTIC-UPGRADE Spec

## 背景与目标
当前结构化 compaction 在语义层存在三个问题：
1. 手动触发时 `notes` 中出现 `trigger: unknown`，触发来源不可观测。
2. `capsule.session.json` 的 `active_files` / `next_steps` 长期占位 `unknown`，续接质量弱。
3. 缺少统一质量指标事件，难以量化语义覆盖率与已知/未知事实比例。

本卡目标是在 **不引入同步前台 LLM** 且保持 fail-closed/replay 安全逻辑不变的前提下，提升 compaction 语义提取与可观测性。

## 旧行为 vs 新行为
### 旧行为
- `notes`：`trigger` 在手动压缩场景经常落为 `unknown`。
- `facts`：`active_files`、`next_steps` 固定 `unknown`。
- `goal`：主要依赖单一 `last_user_message_preview`。
- 事件：仅有 `compaction.started/completed`，无语义质量专门事件。
- `compaction.report.json`：无质量指标字段。

### 新行为
- `notes` 新增 `trigger_source`，取值限定为：
  - `manual`
  - `auto:soft`
  - `auto:hard`
  - `auto:emergency`
- 增加确定性语义提取（线性复杂度）：
  - 从最近消息文本中提取并规范化 `active_files`（安全路径、去重、上限）。
  - 从最近用户意图/assistant 待办句提取 `next_steps`（规则匹配、去重、上限）。
  - `goal` 优先使用最近明确任务句，无法命中再回退预览。
- 新增 `compaction.quality` 事件。
- `compaction.report.json` 新增 `quality` 字段，指标与事件字段保持一致。

## 质量指标定义（协议一致）
`compaction.quality` 事件与 `compaction.report.json.quality` 同时落盘：
- `semantic_coverage`: `goal/active_files/next_steps` 已知占比（0~1）
- `known_facts`: 已知 facts 数
- `unknown_facts`: 未知 facts 数
- `active_files_count`: 提取到的活动文件数量
- `next_steps_count`: 提取到的续接步骤数量

## 质量指标样例
基于结构化回归样例（含显式路径与下一步描述）：
- `semantic_coverage`: `1.0`
- `known_facts`: `7`
- `unknown_facts`: `0`
- `active_files_count`: `2`
- `next_steps_count`: `1`

## 风险与回退方案
### 风险
1. 规则抽取可能对异常文本格式（超长噪声、混合符号）产生保守结果，导致 `active_files/next_steps` 回落为 `unknown`。
2. 新增 report schema 字段后，依赖旧结构的离线解析脚本需要适配 `quality`。
3. 语义抽取规则若过宽，可能引入伪路径或低质量步骤（已通过安全路径过滤和长度上限降低风险）。

### 回退方案
1. 快速回退：撤销 `semantic` 抽取辅助逻辑与 `quality` 字段写入，恢复旧版 facts/report 构造路径。
2. 兼容回退：保留 `quality` 字段但将抽取结果降级为 `unknown`，仅保留基础计数字段，避免中断消费端。
3. 安全兜底：fail-closed/replay 逻辑不变，异常情况下继续走既有 cancel/degraded 路径并输出错误产物。
