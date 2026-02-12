# P3-10 / I.10 `evidence_gain_per_cycle` 阈值鲁棒性补证

- 执行日期：`2026-02-12`
- 执行约束：`local-only`、`fail-fast`、`no-push`
- 证据目录：`docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-10/`

## 1) 目标与当前阈值

目标来自 `I.10`：评估“低增益但最终成功”场景，避免断路器误伤。

- `I.10` DoD 与依赖：
  - `docs/plans/evidence/2026-02-10-v1_6-blocking/p3-wave-plan-2026-02-12.md:228`
  - `docs/plans/evidence/2026-02-10-v1_6-blocking/p3-wave-plan-2026-02-12.md:238`
- 当前门禁定义（决策稿）：
  - `evidence_gain_per_cycle > 0`：`docs/plans/2026-02-10-v1_6-final-collab-architecture-decision.md:561`
  - 自动回滚触发：`evidence_gain_per_cycle <= 0` 且 `rerun_count_per_message > 1`：`docs/plans/2026-02-10-v1_6-final-collab-architecture-decision.md:624`
  - `rerun_count_per_message = orchestrator.planned - 1`：`docs/plans/2026-02-10-v1_6-final-collab-architecture-decision.md:557`

## 2) 数据来源与口径

### 2.1 数据来源

1. `I.7` 数据集（结局标签与 verdict 协变量）：
   - `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-7/critic-verdict-dataset.csv`
2. 本地事件回放池：
   - `/Users/muqihang/chelingxi_workspace/test/.opencode/evidence/local/default/ses_*/events.jsonl`

### 2.2 口径说明（关键）

当前 `events.jsonl` 中**没有**直接落盘 `evidence_gain_per_cycle` 字段，因此本次采用可复核代理值：

- cycle 切分：按同 `messageId` 的 `orchestrator.planned` 时间顺序切分轮次；
- 每轮证据增益：该轮 `retrieval.started.retrievalCacheKey` 中“首次出现”的 key 数；
- 代理指标：

`evidence_gain_per_cycle_proxy = sum(new_unique_keys on cycle>=2) / rerun_count_planned`

其中 `rerun_count_planned = max(0, planned_count - 1)`。

### 2.3 结局标签继承 I.7

为保持依赖关系一致，本报告沿用 I.7 结局口径：

- `task_completion`：`routing.completed` 且无 `orchestrator.degraded` 记为 `1`；
- `secure_output_pass`：出现 `secure_output.degraded` 记为 `0`；
- `critic_status`：`evidence_critic` 最终态（`completed/degraded/not_invoked`）。

口径出处：
- `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-7/critic-verdict-completion-regression.md:22`
- `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-7/critic-verdict-completion-regression.md:25`
- `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-7/critic-verdict-completion-regression.md:26`
- `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-7/critic-verdict-completion-regression.md:27`

## 3) 结果：阈值鲁棒性与误伤

### 3.1 样本覆盖

- I.7 基础样本：`34` 条消息；
- 可映射到 `orchestrator.planned` cycle 的样本：`25` 条；
- 其中 `rerun_count_planned > 0`：`10` 条。

### 3.2 低增益分布

在 `rerun_count_planned > 0` 的 `10` 条中：

- `evidence_gain_per_cycle_proxy <= 0`（低增益）共 `8` 条（`80.00%`）；
- 低增益 + `task_completion=1` 共 `6` 条（`75.00%`，占低增益子集）；
- 低增益 + 严格成功（`task_completion=1` 且 `secure_output_pass=1`）共 `1` 条。

`critic_status` 在低增益样本中的分布：

- `completed`: `5`
- `degraded`: `2`
- `not_invoked`: `1`

### 3.3 对当前回滚谓词的误伤评估

按“消息级近似”评估当前谓词（未展开 6h 窗口）：

`trigger_proxy = (evidence_gain_per_cycle_proxy <= 0) AND (rerun_count_planned > 1)`

混淆结果（目标为识别 `task_completion=0`）：

- `trigger` 总数：`6`
- `TP`（失败且命中）：`0`
- `FP`（成功却命中）：`6`
- `FN`（失败未命中）：`10`
- `TN`（成功未命中）：`9`

对应指标：

- 成功样本潜在误伤率（task_completion 口径）：`6/15 = 40.00%`
- 失败召回率：`0/10 = 0.00%`

> 解释：在本批样本与当前代理口径下，`<=0` 低增益更像“可完成但重复检索无新增 key”的轨迹，不是失败的有效分界。

## 4) 低增益成功样本落盘

已落盘：`low-gain-success-samples.csv`

- 路径：`docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-10/low-gain-success-samples.csv`
- 行数：`6`
- 关键字段：
  - `sample_id/message_id/session_id`
  - `critic_status/task_completion/secure_output_pass`
  - `rerun_count_planned/rerun_count_critic`
  - `evidence_gain_per_cycle_proxy`
  - `cycle_new_unique_retrieval_keys`（样本链路）
  - `plan_id_chain/evidence_file`

观察到的共性：

1. 多条样本为 `cycle_new_unique_retrieval_keys = N|0|0|...`，即首轮后无新增 key；
2. `plan_id_chain` 在同一 `message` 内长期重复，说明重复计划主要发生在同一计划轨道；
3. 低增益成功样本中，`critic_status=completed` 占多数（`5/6`），与 I.7 “completed 与完成同向”结论不冲突。

## 5) 与 adaptive TTC 机制一致性复核

当前代码/测试已验证预算门禁与 breaker 语义，但未直接将 `evidence_gain_per_cycle` 接入 adaptive TTC 逻辑：

- 预算/降级/breaker 原因码：`packages/opencode/src/session/orchestrator/plan.ts:197`
- 预算降级与 breaker trip 测试：`packages/opencode/test/session/adaptive-ttc-budget.test.ts:62`
- scale 与 budget blocked 测试：`packages/opencode/test/session/adaptive-ttc-policy.test.ts:53`
- breaker 事件与 reason 可观测性：`packages/opencode/test/session/adaptive-ttc-breaker.test.ts:59`

本次补证与上述逻辑一致：仅做证据评估，不改任何实现。

## 6) 阈值建议（仅建议，不改阈值）

### 建议结论

**不建议在当前证据强度下直接收紧 `evidence_gain_per_cycle` 数值阈值。**

理由：

1. 低增益在本批样本中不能有效区分失败（失败召回为 0）；
2. 消息级近似下潜在误伤率偏高（`40%`）；
3. I.7 已显示 `critic_status` 具备更强方向性（`completed` 与完成同向，`degraded` 完成率低）。

### 执行建议（门禁策略层）

1. 维持当前数值阈值不变，先作为“观测告警优先”；
2. 若要触发自动动作，建议与 I.7 协变量联动（如 `critic_status=degraded` 或 `critic_degraded_rate` 恶化）再升级；
3. 下一轮补证优先补齐原生埋点字段（直接落盘 `evidence_gain_per_cycle`），再做 24h/6h 窗口级回归。

## 7) 风险与限制

1. 本报告使用 `proxy`（`retrievalCacheKey` 首次出现数）替代原生指标；
2. 样本来自本地回放，不代表线上自然流量；
3. 本次误伤评估是“消息级近似”，未完整重建 6h 连续窗口；
4. `secure_output_pass` 仍是事件代理口径（见 I.7 风险条款）。

## 8) RollbackAction

若后续补样（含原生埋点）推翻本次结论：

1. 维持现有 `H.2` 规则不变；
2. 暂不基于 `evidence_gain_per_cycle` 单指标触发新增自动动作；
3. 继续按 `I.7` 已有协变量做软阻断与人工复核。
