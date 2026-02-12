# P2-2 Routing A/B Report（MVP）

- 日期：2026-02-12
- 卡片：`CARD-BLK-06 / P2-2`
- Owner：`P2-2-HYBRID-ROUTING-01`
- 状态：MVP A/B 结论可签收（工程级）

## 1) 目标

验证 `LC/RAG` 混合路由策略在工程层满足：

1. `A`（strict，主链优先）与 `B`（balanced，受控补偿）行为可区分；
2. 故障或非法配置时，稳定回退 `orchestrator_main`；
3. 无双主链竞争。

> 说明：本报告为 blocking 卡片最小验收，聚焦“策略行为与回退正确性”；不在本轮扩展线上大样本质量统计。

## 2) A/B 组定义

- **A 组（strict）**：`compensationGate=strict`
  - 主链健康且可覆盖时，补偿链关闭。
  - 主链降级时，补偿链单次兜底。

- **B 组（balanced）**：`compensationGate=balanced`
  - 继承 A 组规则。
  - 额外允许“主链健康但本轮不覆盖 retrieval”触发补偿。

- **对照组（off）**：`compensationGate=off`
  - 补偿链禁用，仅保留主链。

## 3) 观测维度（MVP）

### 3.1 质量（路由语义一致性）

基于 `llm.test.ts`：

- strict：主链健康时补偿不触发（通过）
- balanced：主链不覆盖时补偿触发（通过）
- off：主链降级时补偿仍不触发（通过）
- 非法配置：fallback 到 `orchestrator_main`（通过）

### 3.2 成本（检索调用次数）

通过补偿调用次数断言：

- strict：主链健康场景调用 `0`
- balanced：不覆盖场景调用 `1`
- off：降级场景调用 `0`

结论：策略对检索调用数有可预测控制，符合“主链优先、补偿受门控”。

### 3.3 延迟（链路复杂度代理）

MVP 阶段以“是否新增并行主链”为延迟代理：

- 未新增第二主链执行路径；
- 仅在 gate 命中时触发补偿单次调用；
- 因此未引入同轮双主链竞争导致的额外并行开销。

## 4) 回退验证

回退触发条件（已验证）：

- strategy/gate/rollback 任一非法值。

回退结果：

- `source=fallback`
- `strategy=main_first`
- `compensationGate=strict`
- `rollback=orchestrator_main`

该结果满足卡片中的“失败时回退 orchestrator 主链”。

## 5) 结论

在 `P2-2` 最小验收范围内：

- A/B 行为已可区分且可测试。
- 回退链路显式且稳定。
- 架构仍是“单主链 + 补偿兜底”，无双主链竞争。

结论：`P2-2` MVP 达到 blocking 卡片签收条件。

## 6) 下一步（非本卡必需）

1. 将策略选择与结果沉淀到统一观测事件（线上看板）。
2. 扩展真实样本 A/B（质量、成本、延迟）统计口径。
3. 与 `P2-3` 自动调参阶段联动阈值策略。

