# CARD-BLK-01 合同到达率 vs 合同遵守率（统计草案，已做仓内最大化回填）

- 日期：2026-02-11
- 阶段：统计草案（非 Final 主因签收）
- 范围约束：不扩题到 P1/P2；不改阈值；不改决策口径；不改业务代码
- 角色：`Exec-AI-SECURE`（仅 `CARD-BLK-01`）

## 1) 当前结论（草案）

- 当前结论（到达/遵守/混合）：**遵守链路主导（compliance）**
- 是否可 Final 主因签收：**否（本轮仅统计草案）**
- 结论说明：仓内证据已将 `prompt_hash/contract_present` 从 unknown 最大化回填；`claims_block_present=no(20/20)`，失配集中在遵守链路。

## 2) 冻结口径（沿用，不改口径）

- `contract_delivery_rate = N_contract_present / N_total_fail`
- `contract_compliance_rate = N_claims_block_present / N_contract_present`（仅 `N_contract_present > 0` 时计算）
- `end_to_end_claims_rate = N_claims_block_present / N_total_fail`
- 分层归因：
  - `delivery`：`contract_present=no`
  - `compliance`：`contract_present=yes` 且 `claims_block_present=no`
  - `mixed`：证据显示到达且 claims 成立但存在冲突信息
  - `unknown`：证据不足/关键字段未知，不强行归因

## 3) 统计摘要（基于 20 条闭环样本）

### 3.1 基础计数

- `N_total_fail = 20`
- `N_contract_present(yes) = 20`
- `N_contract_absent(no) = 0`
- `N_contract_unknown = 0`
- `N_claims_block_present(yes) = 0`
- `N_claims_block_absent(no) = 20`
- `N_claims_block_unknown = 0`
- `N_degraded = 20`（均为 `missing_claims_block`）

### 3.2 分层结果

- `N_layer_delivery = 0`
- `N_layer_compliance = 20`
- `N_layer_mixed = 0`
- `N_layer_unknown = 0`

### 3.3 指标结果（冻结公式）

- `contract_delivery_rate = 20/20 = 100.0%`
- `contract_compliance_rate = 0/20 = 0.0%`
- `end_to_end_claims_rate = 0/20 = 0.0%`

## 4) unknown_set（本轮回填后）

- `unknown_set`（按 `prompt_hash/contract_present`）：`无`
- `prompt_hash` 分布：`31cdbe970e26...=3; 048aba22be5e...=17`
- `contract_present` 分布：`yes=20, no=0, unknown=0`
- 可追溯证据来源：`context.pack_built.blockFingerprints.block:developer_instructions` + `block_developer_instructions.json` 中 `<secure_output_contract>` 标记。
- 残余缺失：`provider_wire_prompt_snapshot_missing`（外部侧请求线证据尚未回填）。

## 5) unknown 清除方案与 24h 计划

- 执行矩阵：`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-01/unknown-clearance-matrix-2026-02-11.md`
- 24h 内动作：请求 provider-wire prompt 快照/哈希 -> 对账 -> 出具签收建议。
- 若 24h 内仍缺失 provider-wire 证据：维持 `No-Go（Final 主因签收）`，仅保留统计草案。

## 6) 证据路径（绝对路径）

- 样本对账：`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-01/samples-20-reconcile.csv`
- 三联样本目录：`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-01/runtime-samples`
- 运行态事件：`/Users/muqihang/chelingxi_workspace/test/.opencode/evidence/local/default/*/events.jsonl`
- artifact：`/Users/muqihang/chelingxi_workspace/test/.opencode/artifacts/local/default/*`

## 7) 本轮签收边界

- 本轮输出为“unknown 清除 + 统计草案更新”，不构成 Final 主因签收。
- Final 仍需 provider-wire 请求线证据补齐后再判定。


## 8) wire 证据到位后的 Final 判定条件

- 适用范围：仅 `CARD-BLK-01`，用于“是否允许 Final 主因签收”的证据门禁，不改变任何既有阈值/决策口径。
- 固定时限：`2026-02-12 12:00 CST`。

1. 完整性条件（20/20）：`provider-wire-intake-2026-02-11.csv` 的 20 条样本均非 `pending_provider`，且必填字段非 `unknown`。
2. 一致性条件（20/20）：每条 `provider_prompt_hash` 可与样本侧 `prompt_hash` 做一一对账并形成可追溯结果（一致/不一致）。
3. 可判别条件（20/20）：每条都有可审计 `provider_prompt_snapshot_ref` 或等价签名审计日志，不允许“仅口头确认”。
4. 口径保持条件：分层计算继续沿用冻结公式（delivery/compliance/end_to_end），不得改阈值、不得改判定规则。
5. 签收边界条件：满足 1~4 才能进入 Final 主因签收；任一不满足即维持 `No-Go（Final）`。

- 回填入口：`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-01/provider-wire-intake-2026-02-11.csv`
- 请求单：`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-01/provider-wire-request-pack-2026-02-11.md`

## 9) Provider-Wire 回填轮次判定（仅门禁就绪度）

- 检查点：`2026-02-11 20:00:00 CST`。
- 严格缺失规则：`unknown/na/n/a/tbd` 均计入缺失。
- 本轮状态：`pending_provider=20`，`partial=0`，`complete=0`。
- 本轮 delta：新增完成 ` 0 ` 条；剩余 ` 20 ` 条。
- 本轮 Final 门禁判定：`Final No-Go`。
- 说明：本节只做门禁判定，不做 Final 主因签收。
- 轮次报告：`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-01/provider-wire-progress-report-2026-02-11.md`

## 10) 醒目标注：Exception Waiver 不等于 Final 签收

- 治理决策：`Conditional Go (Exception)` 仅用于 `D2` 统计执行推进。
- Final 门禁状态：`No-Go（unchanged）`，`CARD-BLK-01` 不得标记为 Final Go。
- 唯一阻断保持：`ND-I1-PROVIDER-WIRE-01（open）`。
- 到期复核：`2026-02-12 12:00:00 CST`；若 provider-wire 未 `20/20 complete`，维持 `Red + Final No-Go`。
- 决策主文档：`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-01/exception-waiver-2026-02-11.md`

