# P3-7 critic verdict 与任务完成相关性补证（I.7）

- 执行日期：`2026-02-12`
- 执行约束：`local-only`、`fail-fast`、`no-push`
- 证据目录：`docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-7/`

## 1) 数据来源与样本

- 事件源：`/Users/muqihang/chelingxi_workspace/test/.opencode/evidence/local/default/ses_*/events.jsonl`
- 会话数：`10`
- 消息样本数：`34`（满足建议下限 `>=30`）
- 生成数据集：`critic-verdict-dataset.csv`

样本状态分布：

- `critic_status=completed`：`17`
- `critic_status=degraded`：`4`
- `critic_status=not_invoked`：`13`

## 2) 字段构造口径（从 events.jsonl 聚合）

数据集字段：`sample_id, message_id, mode, critic_status, task_completion, secure_output_pass, rerun_count`

- `mode`：优先取 `secure_output.requested.data.mode`；否则取 `orchestrator.planned.data.orchestratorMode`；否则 `unknown`
- `critic_status`：取 `orchestrator.worker.lifecycle` 中 `workerId=evidence_critic` 的**最后一次终态**（`completed/degraded`）；无终态为 `not_invoked`
- `task_completion`：`routing.completed` 出现且 `orchestrator.degraded` 未出现记为 `1`，否则 `0`
- `secure_output_pass`：出现 `secure_output.degraded` 记为 `0`，否则 `1`
- `rerun_count`：`max(0, count(evidence_critic phase=running)-1)`

## 3) 相关性与回归结果

### 3.1 主分析（全样本，n=34）

将 `critic_status=completed` 记为 `1`，其余（`degraded/not_invoked`）记为 `0`，对 `task_completion` 做二元相关与逻辑回归。

2x2 列联表（`x=critic_completed`, `y=task_completion`）：

- `a=11`（x=1,y=1）
- `b=6`（x=1,y=0）
- `c=5`（x=0,y=1）
- `d=12`（x=0,y=0）

结论指标：

- 方向：**正相关**（`critic_status=completed` 与任务完成同向）
- 相关效应量（Phi）：`0.3536`
- 风险差（RD）：`+35.29pp`（`64.71% - 29.41%`）
- 比值比（Haldane 校正 OR）：`4.021`，`95% CI [1.002, 16.136]`
- Fisher 精确检验（双侧）：`p=0.0844`
- 单变量 Logistic：`OR=4.40`，`95% CI [1.04, 18.60]`，`Wald p=0.0440`

解释：

- 方向一致地支持“`completed` verdict 更容易对应任务完成”；
- 但精确检验与 Wald 检验不完全一致（小样本+分布偏斜），统计稳健性仍偏弱。

### 3.2 敏感性分析（仅 critic 已触发样本，n=21）

仅保留 `critic_status in {completed,degraded}`：

- `completed` 完成率：`11/17 = 64.71%`
- `degraded` 完成率：`0/4 = 0.00%`
- Fisher 精确检验（双侧）：`p=0.0351`
- OR（Haldane 校正）：`15.923`，`95% CI [0.735, 345.088]`

解释：

- 在“确实触发 critic”的子样本中，方向更强；
- 但 `degraded` 仅 `4` 条，区间极宽，仍需补样稳固。

## 4) 可否作为门禁代理信号

**结论：可作为“辅助门禁信号”，暂不建议作为单一硬门禁。**

建议门禁策略（当前证据强度下）：

1. `critic_status=degraded` 可触发 `fail-fast` 退化路径与人工复核（软阻断）；
2. 发布硬门禁不应仅依赖 verdict，需与 `secure_output_pass`、`rerun_count` 联合判断；
3. 在补样前，不将 verdict 单独绑定为 release unblock 条件。

## 5) 风险与偏差

1. 样本来自本地回放事件（`local/default`），非线上自然流量；
2. 存在 `not_invoked` 子集（`13/34`），与 `completed/degraded` 并非同一执行路径；
3. `secure_output_pass` 目前依赖事件代理口径（非显式 pass 事件），可解释性有限；
4. `rerun_count` 存在长尾（个别消息高重跑），对回归稳定性有影响。

## 6) 补样方案（若升级为硬门禁）

- 目标样本：`>=60` 条“critic 已触发”消息（建议每种模式至少 `15` 条）；
- 增加显式任务结局标签（成功/失败）与 secure-output 显式 pass 事件；
- 复跑同口径回归（Fisher + Logistic），要求：
  - 方向不反转；
  - OR 95% CI 下界 `>1`；
  - Fisher 双侧 `p<0.05`。

## 7) 最终判定（I.7）

- 本次补证已完成：`dataset + regression report` 已落盘；
- 相关性方向：`positive`
- 门禁结论：`可作辅助信号，不可单独硬门禁`
