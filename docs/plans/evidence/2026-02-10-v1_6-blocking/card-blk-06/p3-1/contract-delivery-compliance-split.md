# CARD-BLK-06 / P3-1 合同“到达率 vs 遵守率”分层补证

- 日期：2026-02-12
- 执行分支：`codex/v16-p3-1-compliance-split`
- 执行约束：仅 I.1 分层补证；不扩题；不改阈值/判定口径；不改 `packages/app/**`
- 当前签收状态：`BLOCKED`（Final 主因签收仍不可放行）

## 1) 数据来源（既有样本 + 既有事件）

1. 样本总表：`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-01/samples-20-reconcile.csv`
2. Provider-Wire intake：`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-01/provider-wire-intake-2026-02-11.csv`
3. Provider-Wire 发送回执：`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-01/provider-wire-send-receipt-ledger-2026-02-11.csv`
4. 本轮对账落盘：`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-1/provider-wire-snapshot-ledger.csv`

## 2) 冻结口径（沿用 CARD-BLK-01，不改规则）

- `contract_delivery_rate = N_contract_present / N_total_fail`
- `contract_compliance_rate = N_claims_block_present / N_contract_present`（仅 `N_contract_present > 0`）
- `end_to_end_claims_rate = N_claims_block_present / N_total_fail`
- 分层归因：
  - `delivery`：`contract_present=no`
  - `compliance`：`contract_present=yes` 且 `claims_block_present=no`
  - `mixed`：到达且 claims 成立但有冲突证据
  - `unknown`：关键字段不足，无法归因

## 3) 分层统计结果（20 条闭环样本）

### 3.1 基础计数

- `N_total_fail = 20`
- `N_contract_present(yes) = 20`
- `N_contract_absent(no) = 0`
- `N_contract_unknown = 0`
- `N_claims_block_present(yes) = 0`
- `N_claims_block_absent(no) = 20`
- `N_claims_block_unknown = 0`
- `N_degraded = 20`（`missing_claims_block`）

### 3.2 分层计数

- `N_layer_delivery = 0`
- `N_layer_compliance = 20`
- `N_layer_mixed = 0`
- `N_layer_unknown = 0`

### 3.3 指标结果

- `contract_delivery_rate = 20/20 = 100.0%`
- `contract_compliance_rate = 0/20 = 0.0%`
- `end_to_end_claims_rate = 0/20 = 0.0%`

### 3.4 关键分布

- `prompt_hash` 分布：
  - `048aba22be5e0704578d51ac494faf65dba80417352d7198b54650e608a56e43 = 17`
  - `31cdbe970e261088eddeac48e03d7ba34c7d2ae5548e204f0f8900fc46fbf052 = 3`
- 统计层 `unknown`（合同到达/遵守字段）已清零：`0`

## 4) 到达率 vs 遵守率判定

- 到达链路：`contract_present=yes` 为 `20/20`，到达率 `100%`。
- 遵守链路：`claims_block_present=yes` 为 `0/20`，遵守率 `0%`。
- 判定结论：失配主因位于 `compliance`（遵守链路），非 `delivery`（到达链路）。

## 5) Provider/Model/Message/PromptHash 对账状态

基于 `provider-wire-snapshot-ledger.csv`（20 条）：

- `sample_id/message_id` 对齐：`20/20`（无 join 缺口）。
- `wire_status=pending_provider`：`20/20`。
- `provider_prompt_hash=unknown`：`20/20`。
- `provider_model_id=unknown`（映射到 `provider/model`）`20/20`。
- `provider_prompt_snapshot_ref=unknown`：`20/20`。
- `prompt_hash_match=blocked_missing_provider_prompt_hash`：`20/20`（因 provider 侧哈希缺失，无法做一致性判定）。

结论：统计分层闭环已完成，但 provider-wire 可审计链路未闭环。

## 6) 可签收结论（I.1）

- **可签收（统计层）**：`到达率 vs 遵守率` 已完成拆分，且主因归属 `compliance` 明确。
- **不可签收（Final 门禁）**：`BLOCKED`。
- **BLOCKED 原因（明确）**：
  1. `provider_prompt_hash` 全量缺失（20/20），无法完成 provider 侧与样本侧 `prompt_hash` 一致性对账。
  2. `provider_model_id` 与 `provider_prompt_snapshot_ref` 全量缺失（20/20），无法形成 `provider/model/message_id/prompt_hash` 的可审计证据链。
  3. `wire_status` 全量 `pending_provider`（20/20），不满足完整性与可判别性门禁。

## 7) 最小实现判定（Fail-Fast）

- 本轮缺口属于外部 provider-wire 回填字段，不是仓内缺字段。
- 因此**不做代码改动**（docs-only），避免扩题。
- 维持发布门禁：`Final No-Go`（直到 ND-I1-PROVIDER-WIRE-01 关闭）。
