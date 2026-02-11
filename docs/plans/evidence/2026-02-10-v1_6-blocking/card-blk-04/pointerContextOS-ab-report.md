# pointerContextOS A/B 回放报告（启动版）

- 卡号：`CARD-BLK-04`
- Owner：`Exec-AI-SESSION`
- 日期：2026-02-10
- 阶段：D1 启动版（设计与方法定义）
- 范围限制：仅阻断执行启动，不包含 P1/P2 实现，不改阈值，不改决策口径

## 1) 目标与假设

- 目标：验证 `pointerContextOS` 开关是否真实影响运行行为。
- 零假设（H0）：开关开/关对关键指标无统计显著差异。
- 备择假设（H1）：开关开/关在至少一项关键指标上存在统计显著差异。

## 2) A/B 设计（启动版）

- 样本规模：20 条（同样本配对对照）。
- 样本来源：同一任务池内可复现实例；每条样本在 A/B 两组输入保持一致。
- A 组（Control）：`pointerContextOS=OFF`。
- B 组（Treatment）：`pointerContextOS=ON`。
- 执行方式：配对回放（每个 `sample_id` 执行两次，环境与上下文固定）。
- 随机与顺序：A/B 顺序随机化，降低顺序偏差。
- 记录粒度：每条样本生成 A/B 各 1 条运行记录，并保留原始日志定位信息。

## 3) 指标定义

### 3.1 pointer 命中率（primary）

- 定义：样本回放中 pointer 实际命中次数 / pointer 应命中机会次数。
- 记法：`pointer_hit_rate = hit_count / opportunity_count`。
- 解释：评估开关对工作集指针命中行为的直接影响。

### 3.2 最终 claim 可验证率（primary）

- 定义：样本最终输出中，可由证据链验证通过的 claim 占比。
- 记法：`claim_verifiable_rate = verifiable_claims / total_claims`。
- 解释：评估开关是否带来可验证结论提升。

### 3.3 rerun 次数（secondary）

- 定义：同一 message 在达到终态前触发 rerun 的轮次数。
- 记法：`rerun_count_per_sample`。
- 解释：评估开关是否改善收敛效率或稳定性。

## 4) 显著性方法（启动版）

- 数据结构：配对样本（同一 `sample_id` 的 A 与 B 成对比较）。
- 检验策略：
  - 比例类指标（命中率、可验证率）：优先采用配对二项差异检验（McNemar 或等价配对比例检验）。
  - 计数类指标（rerun 次数）：采用配对非参数检验（Wilcoxon signed-rank）。
- 显著性阈值：沿用定版会冻结口径，当前仅做“显著/不显著”判定表达，不新增阈值定义。
- 效应量：
  - 比例类报告绝对差值（B-A）与相对提升。
  - 计数类报告中位数差与分布方向。
- 结果分类：`有效` / `无效` / `不稳定`
  - 有效：至少一项 primary 指标显著改善，且无明显副作用恶化。
  - 无效：primary 指标无显著改善且效应接近零。
  - 不稳定：结果方向在样本子集间冲突，或伴随显著波动。

## 5) 数据记录规范

- 样本清单文件：`pointerContextOS-ab-sample-list.csv`
- 每条样本必填字段：`sample_id`、`scenario`、`message_id`、`run_a_id`、`run_b_id`、`status`。
- 指标回填字段：`pointer_hit_rate_a/b`、`claim_verifiable_rate_a/b`、`rerun_count_a/b`。

## 6) 当前状态与后续

- 当前状态：完成 A/B 设计、统计方法、指标口径定义；尚未执行真实回放。
- 下一步：按样本清单完成 20 条配对回放并回填统计结果。
- 输出约束：仅补证，不改业务实现，不改阈值，不改决策口径。

