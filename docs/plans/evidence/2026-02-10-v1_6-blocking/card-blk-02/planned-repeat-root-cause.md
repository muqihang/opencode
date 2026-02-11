# CARD-BLK-02 planned-repeat 根因分析（启动版）

- 日期：2026-02-10
- 阶段：D1 启动版（仅定义口径与结构，不给出实测 Top1）
- 对应目标：确认重复 planned 来源（外层触发 / 协议重入 / 预算回跳）

## 1) Trace 字段（message 生命周期）

本启动版固定使用以下 trace 最小字段集合：

- `messageId`：消息唯一标识（同一次用户消息全链路一致）
- `planId`：orchestrator 计划标识（同 message 可能出现多个）
- `cycle`：同 message 下 planned 的顺序序号（1,2,3...）
- `trigger_source`：本次 planned 触发来源（`outer_trigger` / `protocol_reentry` / `budget_rebound` / `unknown`）

补充约束：

- `cycle` 从 1 起，按事件时间升序编号。
- `trigger_source` 暂按证据归因，无法判定时写 `unknown`，不得臆测。
- 仅当同 `messageId` 出现 `cycle >= 2` 时记为“重复 planned 样本”。

## 2) 样本口径（启动版）

样本单位：`messageId` 级。

纳入条件：

1. 同 `messageId` 在观测窗口内至少出现 2 次 planned（`cycle >= 2`）。
2. 该 message 可回溯到连续事件序列（可定位到对应日志/产物路径）。
3. 可对每次 planned 标注 `trigger_source`（允许部分为 `unknown`，但不得全空）。

排除条件：

1. 事件缺失导致无法建立 `cycle` 顺序。
2. 跨 message 拼接造成 `messageId` 不一致。
3. 仅有单次 planned（`cycle = 1`）。

样本规模：

- D1 启动版：先落 `10` 条占位结构样本（无实测结论）。
- D2 实测版：以 `10` 条真实重复样本完成首因标注并计算 Top1 占比。

## 3) Top1 统计方法（固定）

统计目标：给出“首要根因 Top1 + 占比”。

步骤：

1. 对每条样本确定 `first_cause`（取该 `messageId` 首次进入重复态时的首因）。
2. 仅统计 `first_cause != unknown` 的有效样本数 `N_valid`。
3. 按根因类别计数：
   - `C_outer_trigger`
   - `C_protocol_reentry`
   - `C_budget_rebound`
4. `Top1 = argmax(C_*)`。
5. `Top1_ratio = Top1_count / N_valid`（保留两位小数，百分比格式）。

并列处理：

- 若出现并列最大值，结论标注“Top1 并列”，并在 `Need-Decision` 升级确认，不自行改口径。

质量门槛：

- 若 `N_valid = 0`，结论必须写“根因不明确”，并触发卡片既定 rollback：仅做观测增强，不推进 breaker 参数收紧。

## 4) 统一输出契约（固定）

1) 当前结论
2) 证据路径（绝对路径）
3) 未覆盖风险
4) 下一步
5) Need-Decision（若无写“无”）

## 5) 启动版当前状态

- 口径状态：已冻结（仅 CARD-BLK-02 使用）
- 数据状态：占位结构已落盘，待 D2 真实回放填充
- 当前结论：仅完成启动，尚无可发布 Top1 实测占比
