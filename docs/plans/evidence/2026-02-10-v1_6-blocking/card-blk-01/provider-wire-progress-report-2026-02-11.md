# CARD-BLK-01 Provider-Wire 回填进度报告（20:00检查点）

- 检查点：`2026-02-11 20:00:00 CST`
- 范围：仅 `CARD-BLK-01`，不跨卡；不改阈值、不改决策口径、不改业务代码
- 严格缺失规则：`unknown/na/n/a/tbd` 一律按缺失处理
- 依据：`provider-wire-intake-2026-02-11.csv` + `contract_delivery_vs_compliance.md` 第8/9节

## 1) 状态重算

- `pending_provider=20`
- `partial=0`
- `complete=0`

## 2) 本轮 Delta

- 新增完成：`0`
- 剩余未完成：`20`

## 3) 8个必填字段缺失 TOP

| field | missing_count |
|---|---|
| `provider_audit_log_ref` | 20 |
| `provider_model_id` | 20 |
| `provider_prompt_hash` | 20 |
| `provider_prompt_snapshot_ref` | 20 |
| `provider_request_id` | 20 |
| `provider_sent_at_utc` | 20 |
| `receiver_signoff_at_cst` | 20 |
| `receiver_signoff_name` | 20 |

## 4) Final 门禁重判（仅判定）

- 判定：`Final No-Go`
- 规则：`complete<20` 或必填字段未齐 => `Final No-Go`；仅 `complete=20` 且字段齐 => `ready for final review（建议）`。
- 边界：本轮仅门禁判定，不做 Final 主因签收。

## 5) 样本状态快照

| sample_id | wire_status | missing_evidence_type |
|---|---|---|
| S01 | `pending_provider` | `provider_wire_not_submitted;missing_fields:provider_request_id|provider_prompt_hash|provider_prompt_snapshot_ref|provider_sent_at_utc|provider_model_id|provider_audit_log_ref|receiver_signoff_name|receiver_signoff_at_cst` |
| S02 | `pending_provider` | `provider_wire_not_submitted;missing_fields:provider_request_id|provider_prompt_hash|provider_prompt_snapshot_ref|provider_sent_at_utc|provider_model_id|provider_audit_log_ref|receiver_signoff_name|receiver_signoff_at_cst` |
| S03 | `pending_provider` | `provider_wire_not_submitted;missing_fields:provider_request_id|provider_prompt_hash|provider_prompt_snapshot_ref|provider_sent_at_utc|provider_model_id|provider_audit_log_ref|receiver_signoff_name|receiver_signoff_at_cst` |
| S04 | `pending_provider` | `provider_wire_not_submitted;missing_fields:provider_request_id|provider_prompt_hash|provider_prompt_snapshot_ref|provider_sent_at_utc|provider_model_id|provider_audit_log_ref|receiver_signoff_name|receiver_signoff_at_cst` |
| S05 | `pending_provider` | `provider_wire_not_submitted;missing_fields:provider_request_id|provider_prompt_hash|provider_prompt_snapshot_ref|provider_sent_at_utc|provider_model_id|provider_audit_log_ref|receiver_signoff_name|receiver_signoff_at_cst` |
| S06 | `pending_provider` | `provider_wire_not_submitted;missing_fields:provider_request_id|provider_prompt_hash|provider_prompt_snapshot_ref|provider_sent_at_utc|provider_model_id|provider_audit_log_ref|receiver_signoff_name|receiver_signoff_at_cst` |
| S07 | `pending_provider` | `provider_wire_not_submitted;missing_fields:provider_request_id|provider_prompt_hash|provider_prompt_snapshot_ref|provider_sent_at_utc|provider_model_id|provider_audit_log_ref|receiver_signoff_name|receiver_signoff_at_cst` |
| S08 | `pending_provider` | `provider_wire_not_submitted;missing_fields:provider_request_id|provider_prompt_hash|provider_prompt_snapshot_ref|provider_sent_at_utc|provider_model_id|provider_audit_log_ref|receiver_signoff_name|receiver_signoff_at_cst` |
| S09 | `pending_provider` | `provider_wire_not_submitted;missing_fields:provider_request_id|provider_prompt_hash|provider_prompt_snapshot_ref|provider_sent_at_utc|provider_model_id|provider_audit_log_ref|receiver_signoff_name|receiver_signoff_at_cst` |
| S10 | `pending_provider` | `provider_wire_not_submitted;missing_fields:provider_request_id|provider_prompt_hash|provider_prompt_snapshot_ref|provider_sent_at_utc|provider_model_id|provider_audit_log_ref|receiver_signoff_name|receiver_signoff_at_cst` |
| S11 | `pending_provider` | `provider_wire_not_submitted;missing_fields:provider_request_id|provider_prompt_hash|provider_prompt_snapshot_ref|provider_sent_at_utc|provider_model_id|provider_audit_log_ref|receiver_signoff_name|receiver_signoff_at_cst` |
| S12 | `pending_provider` | `provider_wire_not_submitted;missing_fields:provider_request_id|provider_prompt_hash|provider_prompt_snapshot_ref|provider_sent_at_utc|provider_model_id|provider_audit_log_ref|receiver_signoff_name|receiver_signoff_at_cst` |
| S13 | `pending_provider` | `provider_wire_not_submitted;missing_fields:provider_request_id|provider_prompt_hash|provider_prompt_snapshot_ref|provider_sent_at_utc|provider_model_id|provider_audit_log_ref|receiver_signoff_name|receiver_signoff_at_cst` |
| S14 | `pending_provider` | `provider_wire_not_submitted;missing_fields:provider_request_id|provider_prompt_hash|provider_prompt_snapshot_ref|provider_sent_at_utc|provider_model_id|provider_audit_log_ref|receiver_signoff_name|receiver_signoff_at_cst` |
| S15 | `pending_provider` | `provider_wire_not_submitted;missing_fields:provider_request_id|provider_prompt_hash|provider_prompt_snapshot_ref|provider_sent_at_utc|provider_model_id|provider_audit_log_ref|receiver_signoff_name|receiver_signoff_at_cst` |
| S16 | `pending_provider` | `provider_wire_not_submitted;missing_fields:provider_request_id|provider_prompt_hash|provider_prompt_snapshot_ref|provider_sent_at_utc|provider_model_id|provider_audit_log_ref|receiver_signoff_name|receiver_signoff_at_cst` |
| S17 | `pending_provider` | `provider_wire_not_submitted;missing_fields:provider_request_id|provider_prompt_hash|provider_prompt_snapshot_ref|provider_sent_at_utc|provider_model_id|provider_audit_log_ref|receiver_signoff_name|receiver_signoff_at_cst` |
| S18 | `pending_provider` | `provider_wire_not_submitted;missing_fields:provider_request_id|provider_prompt_hash|provider_prompt_snapshot_ref|provider_sent_at_utc|provider_model_id|provider_audit_log_ref|receiver_signoff_name|receiver_signoff_at_cst` |
| S19 | `pending_provider` | `provider_wire_not_submitted;missing_fields:provider_request_id|provider_prompt_hash|provider_prompt_snapshot_ref|provider_sent_at_utc|provider_model_id|provider_audit_log_ref|receiver_signoff_name|receiver_signoff_at_cst` |
| S20 | `pending_provider` | `provider_wire_not_submitted;missing_fields:provider_request_id|provider_prompt_hash|provider_prompt_snapshot_ref|provider_sent_at_utc|provider_model_id|provider_audit_log_ref|receiver_signoff_name|receiver_signoff_at_cst` |

