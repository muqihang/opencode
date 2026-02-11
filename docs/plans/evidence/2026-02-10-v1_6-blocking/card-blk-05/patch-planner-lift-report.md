# CARD-BLK-05 Patch Planner Lift Report（D1 启动版）

- 日期：2026-02-10
- 卡片：`CARD-BLK-05`
- Owner：`Exec-AI-WORKER`（首责） + worker 协作负责人（签收）
- 状态：启动版（方法冻结，结果待回放）
- 证据目录（绝对路径）：`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-05/`

## 1. 对照设计（不扩题，仅 I.5）

### 1.1 实验目标

量化 `patch_planner` 在 `heavy` 复杂写入任务中的真实增益，输出建议结论：

- 保留为 heavy 常驻
- 条件启用
- 降级

### 1.2 对照组定义

- 样本量：30 条 heavy 写入任务（与执行卡一致）
- A 组（treatment）：启用 `patch_planner`
- B 组（control）：不启用 `patch_planner`
- 指标：`task_success`、`rerun_count`、`secure_output_pass_rate`

### 1.3 样本与运行约束

- 本阶段仅建立样本模板与统计口径，不做 P1/P2 实现。
- 不修改任何阈值与决策口径。
- 仅产出文档、证据、回放与分析产物。

## 2. Lift 口径与公式

### 2.1 主指标 lift（成功率提升）

定义：

`lift_task_success = success_rate_A - success_rate_B`

其中：

- `success_rate_A = success_count_A / n_A`
- `success_rate_B = success_count_B / n_B`

补充比值口径（可选展示，不替代主口径）：

`relative_lift = (success_rate_A - success_rate_B) / success_rate_B`

### 2.2 次指标

- `delta_rerun = mean_rerun_A - mean_rerun_B`（期望 <= 0）
- `delta_secure_pass = secure_pass_rate_A - secure_pass_rate_B`

### 2.3 与决策稿口径的衔接

决策稿在线门禁定义 `worker_lift_rate = enhanced_messages / eligible_messages`。本卡实验属于离线补证（I.5），采用任务级 A/B 差值 `lift_task_success` 作为直接增益证据，同时保留 `secure_output_pass_rate` 与 `rerun_count` 作为一致性约束，不替代线上门禁阈值。

## 3. 95% 置信区间方法（启动版固定）

### 3.1 二项率差值置信区间（主方法）

对于 `lift_task_success` 与 `delta_secure_pass`：

- 使用 Wilson/Newcombe 方法估计两独立比例差值的 95% CI。
- 报告字段：`point_estimate`、`ci_low`、`ci_high`。

### 3.2 重跑次数差值置信区间

对于 `delta_rerun`：

- 优先 bootstrap（10,000 次重采样）估计 95% CI。
- 若样本分布近似正态，可同时给出 Welch t-interval 作为对照。

### 3.3 显著性与决策读法（仅报告，不改阈值）

- 若 `lift_task_success` 的 95% CI 全部 > 0，记为“增益显著”。
- 若区间跨 0，记为“增益不显著/证据不足”。
- 若显著但 `delta_secure_pass < 0` 且恶化明显，标记为“需谨慎，建议条件启用”。

## 4. 启动版产物清单

- `patch-planner-lift-report.md`（本文件）
- `patch-planner-lift-samples.csv`（30 条占位样本）
- `d1-kickoff.md`（启动结论与统一输出契约）

## 5. 执行边界确认

- 不扩题到 P1/P2。
- 不改阈值，不改决策口径。
- 不执行高风险命令。
- 当前仅 D1 启动材料，不输出最终 lift 结论。

## 6. 统一输出契约（必须原样包含）

1) 当前结论：已完成 CARD-BLK-05 启动版设计与样本模板落盘，统计口径与置信区间方法已冻结，待 D4 回放取数。
2) 证据路径（绝对路径）：/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-05/
3) 未覆盖风险：尚未执行真实回放，当前结论不代表 patch_planner 实际 lift 显著性。
4) 下一步：按 30 条任务完成 A/B 回放，回填 CSV，计算 `lift_task_success`、`delta_rerun`、`delta_secure_pass` 及其 95% CI。
5) Need-Decision（若无写“无”）：无
