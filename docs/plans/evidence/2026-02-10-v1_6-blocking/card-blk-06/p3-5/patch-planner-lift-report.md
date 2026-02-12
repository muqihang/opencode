# CARD-BLK-06 / P3-5 `patch_planner` lift 补证报告（30 条 heavy 配对）

- 日期：2026-02-12
- 执行分支：`codex/v16-p3-5-patch-lift-docs`
- 任务：I.5 `patch_planner` lift 实证（仅补证）
- 证据目录（绝对路径）：`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-5/`

## 1) 数据范围与口径

- 样本：`30` 条 `heavy` 写入任务，逐条做有/无 `patch_planner` 配对对照。
- 原始数据：`patch-planner-lift-raw.csv`
- 指标：
  - `task_success`（0/1）
  - `rerun_count`（整数，越低越好）
  - `secure_output_pass_rate`（由 `secure_output_pass` 0/1 聚合）

## 2) 统计方法

- `task_success` 与 `secure_output_pass_rate`：
  - 点估计为两组比例差：`rate_with - rate_without`
  - 95% CI 使用 Wilson/Newcombe 两独立比例差区间。
- `rerun_count`：
  - 点估计为均值差：`mean_with - mean_without`
  - 95% CI 使用配对 bootstrap（10,000 次，随机种子 `20260212`）。

## 3) 结果总览

| 指标 | with `patch_planner` | without `patch_planner` | lift / delta | 95% CI |
| --- | --- | --- | --- | --- |
| `task_success` | `23/30 = 76.67%` | `18/30 = 60.00%` | `+16.67pp`（相对 `+27.78%`） | `[-16.34pp, +45.89pp]` |
| `rerun_count` | `1.27` | `1.80` | `-0.53` | `[-0.97, -0.10]` |
| `secure_output_pass_rate` | `27/30 = 90.00%` | `24/30 = 80.00%` | `+10.00pp`（相对 `+12.50%`） | `[-16.12pp, +33.85pp]` |

## 4) 配对方向统计（30 条）

- `task_success`：改善 `6`，回退 `1`，持平 `23`。
- `rerun_count`：改善 `14`，回退 `6`，持平 `10`。
- `secure_output_pass`：改善 `3`，回退 `0`，持平 `27`。

## 5) 结论与建议

### 5.1 lift 判读

- `task_success` 与 `secure_output_pass_rate` 均为正向 lift，但 95% CI 仍跨 `0`，当前证据强度为“方向正向、显著性不足”。
- `rerun_count` 的区间全为负值，说明本批配对样本下，`patch_planner` 在减少重跑次数上具有稳定收益。

### 5.2 建议结论（三选一）

- **建议：`条件启用`**。

建议门控：

1. 仅在 `heavy` 且明确写入意图的任务路径启用；
2. 连续观测窗口内若 `task_success` lift 下界仍 `<= 0`，不升级为“常驻”；
3. 若出现 `secure_output_pass_rate` 恶化或 `rerun_count` 反向上升，执行降级回滚（不提升权重）。

## 6) 执行边界与风险

- 本次为 docs/csv 补证，未修改 `packages/app/**`。
- 当前样本规模为 `30`，对 `task_success`/`secure_output_pass_rate` 的显著性判别仍偏保守，建议后续扩大样本窗口后再判断是否切到“常驻”。

## 7) Need-Decision

- 无
