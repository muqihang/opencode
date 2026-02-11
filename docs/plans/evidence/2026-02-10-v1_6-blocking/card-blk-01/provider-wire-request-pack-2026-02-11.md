# CARD-BLK-01 Provider-Wire 请求单（20条逐条）

- 日期：`2026-02-11`
- 范围：仅 `CARD-BLK-01`；不跨卡；不改阈值、不改决策口径、不改业务代码
- 目的：向应用层负责人发起 `S01~S20` 的 provider-wire 证据补齐请求（用于 Final 前证据齐套）
- 固定 SLA：`2026-02-12 12:00 CST`

## 1) 统一请求口径

- 需要字段：`provider_request_id; provider_prompt_hash; provider_prompt_snapshot_ref(可脱敏); provider_sent_at_utc; provider_model_id; provider_audit_log_ref; receiver_signoff_name; receiver_signoff_at_cst`
- 接收人：`应用层负责人（实名）`
- 升级链路：`Exec-AI-SECURE -> Exec-AI-PMO -> 架构总控（逾期即No-Go）`

## 2) 20条逐条请求清单

| sample_id | message_id | session_id | 需要字段 | 接收人 | SLA | 升级链路 |
|---|---|---|---|---|---|---|
| S01 | `msg_c46bc6a4c001nkCj9853ZDTii3` | `ses_3b94395d0ffeC634iIBFEBTwWj` | `provider_request_id; provider_prompt_hash; provider_prompt_snapshot_ref(可脱敏); provider_sent_at_utc; provider_model_id; provider_audit_log_ref; receiver_signoff_name; receiver_signoff_at_cst` | 应用层负责人（实名） | 2026-02-12 12:00 CST | Exec-AI-SECURE -> Exec-AI-PMO -> 架构总控（逾期即No-Go） |
| S02 | `msg_c469dda90001QKDQjpou3Fpgk0` | `ses_3b9622573ffejMRJFrytlZ5nbO` | `provider_request_id; provider_prompt_hash; provider_prompt_snapshot_ref(可脱敏); provider_sent_at_utc; provider_model_id; provider_audit_log_ref; receiver_signoff_name; receiver_signoff_at_cst` | 应用层负责人（实名） | 2026-02-12 12:00 CST | Exec-AI-SECURE -> Exec-AI-PMO -> 架构总控（逾期即No-Go） |
| S03 | `msg_c4af69bdb001pDTy8nBnuEro6Y` | `ses_3b51283d0ffeWbeAOjPM3NUMPy` | `provider_request_id; provider_prompt_hash; provider_prompt_snapshot_ref(可脱敏); provider_sent_at_utc; provider_model_id; provider_audit_log_ref; receiver_signoff_name; receiver_signoff_at_cst` | 应用层负责人（实名） | 2026-02-12 12:00 CST | Exec-AI-SECURE -> Exec-AI-PMO -> 架构总控（逾期即No-Go） |
| S04 | `msg_c4af8e8d1001wANN6RfrFWoXsZ` | `ses_3b51283d0ffeWbeAOjPM3NUMPy` | `provider_request_id; provider_prompt_hash; provider_prompt_snapshot_ref(可脱敏); provider_sent_at_utc; provider_model_id; provider_audit_log_ref; receiver_signoff_name; receiver_signoff_at_cst` | 应用层负责人（实名） | 2026-02-12 12:00 CST | Exec-AI-SECURE -> Exec-AI-PMO -> 架构总控（逾期即No-Go） |
| S05 | `msg_c4afccdd70015wpQNZI5xYT5R7` | `ses_3b51283d0ffeWbeAOjPM3NUMPy` | `provider_request_id; provider_prompt_hash; provider_prompt_snapshot_ref(可脱敏); provider_sent_at_utc; provider_model_id; provider_audit_log_ref; receiver_signoff_name; receiver_signoff_at_cst` | 应用层负责人（实名） | 2026-02-12 12:00 CST | Exec-AI-SECURE -> Exec-AI-PMO -> 架构总控（逾期即No-Go） |
| S06 | `msg_c4b10fc95001F75HfPAhR5167o` | `ses_3b4f22623ffe5MZHLFRUupYZZl` | `provider_request_id; provider_prompt_hash; provider_prompt_snapshot_ref(可脱敏); provider_sent_at_utc; provider_model_id; provider_audit_log_ref; receiver_signoff_name; receiver_signoff_at_cst` | 应用层负责人（实名） | 2026-02-12 12:00 CST | Exec-AI-SECURE -> Exec-AI-PMO -> 架构总控（逾期即No-Go） |
| S07 | `msg_c4b12f36b001dBksp3t7aGx8U5` | `ses_3b4f22623ffe5MZHLFRUupYZZl` | `provider_request_id; provider_prompt_hash; provider_prompt_snapshot_ref(可脱敏); provider_sent_at_utc; provider_model_id; provider_audit_log_ref; receiver_signoff_name; receiver_signoff_at_cst` | 应用层负责人（实名） | 2026-02-12 12:00 CST | Exec-AI-SECURE -> Exec-AI-PMO -> 架构总控（逾期即No-Go） |
| S08 | `msg_c4b140720001aoHswvVc3oIswN` | `ses_3b4f22623ffe5MZHLFRUupYZZl` | `provider_request_id; provider_prompt_hash; provider_prompt_snapshot_ref(可脱敏); provider_sent_at_utc; provider_model_id; provider_audit_log_ref; receiver_signoff_name; receiver_signoff_at_cst` | 应用层负责人（实名） | 2026-02-12 12:00 CST | Exec-AI-SECURE -> Exec-AI-PMO -> 架构总控（逾期即No-Go） |
| S09 | `msg_c4b2210b0001GFBAvzP56zqJKN` | `ses_3b4f22623ffe5MZHLFRUupYZZl` | `provider_request_id; provider_prompt_hash; provider_prompt_snapshot_ref(可脱敏); provider_sent_at_utc; provider_model_id; provider_audit_log_ref; receiver_signoff_name; receiver_signoff_at_cst` | 应用层负责人（实名） | 2026-02-12 12:00 CST | Exec-AI-SECURE -> Exec-AI-PMO -> 架构总控（逾期即No-Go） |
| S10 | `msg_c4b2661fd001ROME876qiAbbzY` | `ses_3b4f22623ffe5MZHLFRUupYZZl` | `provider_request_id; provider_prompt_hash; provider_prompt_snapshot_ref(可脱敏); provider_sent_at_utc; provider_model_id; provider_audit_log_ref; receiver_signoff_name; receiver_signoff_at_cst` | 应用层负责人（实名） | 2026-02-12 12:00 CST | Exec-AI-SECURE -> Exec-AI-PMO -> 架构总控（逾期即No-Go） |
| S11 | `msg_c4b2768ff001BvRzXy7K55qGGS` | `ses_3b4f22623ffe5MZHLFRUupYZZl` | `provider_request_id; provider_prompt_hash; provider_prompt_snapshot_ref(可脱敏); provider_sent_at_utc; provider_model_id; provider_audit_log_ref; receiver_signoff_name; receiver_signoff_at_cst` | 应用层负责人（实名） | 2026-02-12 12:00 CST | Exec-AI-SECURE -> Exec-AI-PMO -> 架构总控（逾期即No-Go） |
| S12 | `msg_c4b27c85d001Bl3S5s0sM2fpAA` | `ses_3b4f22623ffe5MZHLFRUupYZZl` | `provider_request_id; provider_prompt_hash; provider_prompt_snapshot_ref(可脱敏); provider_sent_at_utc; provider_model_id; provider_audit_log_ref; receiver_signoff_name; receiver_signoff_at_cst` | 应用层负责人（实名） | 2026-02-12 12:00 CST | Exec-AI-SECURE -> Exec-AI-PMO -> 架构总控（逾期即No-Go） |
| S13 | `msg_c4b2841e1001o35rbn8yRfGmo6` | `ses_3b4f22623ffe5MZHLFRUupYZZl` | `provider_request_id; provider_prompt_hash; provider_prompt_snapshot_ref(可脱敏); provider_sent_at_utc; provider_model_id; provider_audit_log_ref; receiver_signoff_name; receiver_signoff_at_cst` | 应用层负责人（实名） | 2026-02-12 12:00 CST | Exec-AI-SECURE -> Exec-AI-PMO -> 架构总控（逾期即No-Go） |
| S14 | `msg_c4b287b20001rwu1r63uDcyXvI` | `ses_3b4f22623ffe5MZHLFRUupYZZl` | `provider_request_id; provider_prompt_hash; provider_prompt_snapshot_ref(可脱敏); provider_sent_at_utc; provider_model_id; provider_audit_log_ref; receiver_signoff_name; receiver_signoff_at_cst` | 应用层负责人（实名） | 2026-02-12 12:00 CST | Exec-AI-SECURE -> Exec-AI-PMO -> 架构总控（逾期即No-Go） |
| S15 | `msg_c4b2929c9001G8XXgvRqnR6kxx` | `ses_3b4f22623ffe5MZHLFRUupYZZl` | `provider_request_id; provider_prompt_hash; provider_prompt_snapshot_ref(可脱敏); provider_sent_at_utc; provider_model_id; provider_audit_log_ref; receiver_signoff_name; receiver_signoff_at_cst` | 应用层负责人（实名） | 2026-02-12 12:00 CST | Exec-AI-SECURE -> Exec-AI-PMO -> 架构总控（逾期即No-Go） |
| S16 | `msg_c4b2976b8001VOqXtPBaS222FI` | `ses_3b4f22623ffe5MZHLFRUupYZZl` | `provider_request_id; provider_prompt_hash; provider_prompt_snapshot_ref(可脱敏); provider_sent_at_utc; provider_model_id; provider_audit_log_ref; receiver_signoff_name; receiver_signoff_at_cst` | 应用层负责人（实名） | 2026-02-12 12:00 CST | Exec-AI-SECURE -> Exec-AI-PMO -> 架构总控（逾期即No-Go） |
| S17 | `msg_c4b2aa656001Cor2tUPAYb08wB` | `ses_3b4f22623ffe5MZHLFRUupYZZl` | `provider_request_id; provider_prompt_hash; provider_prompt_snapshot_ref(可脱敏); provider_sent_at_utc; provider_model_id; provider_audit_log_ref; receiver_signoff_name; receiver_signoff_at_cst` | 应用层负责人（实名） | 2026-02-12 12:00 CST | Exec-AI-SECURE -> Exec-AI-PMO -> 架构总控（逾期即No-Go） |
| S18 | `msg_c4b2aebce001kpqNSdafGmM3mj` | `ses_3b4f22623ffe5MZHLFRUupYZZl` | `provider_request_id; provider_prompt_hash; provider_prompt_snapshot_ref(可脱敏); provider_sent_at_utc; provider_model_id; provider_audit_log_ref; receiver_signoff_name; receiver_signoff_at_cst` | 应用层负责人（实名） | 2026-02-12 12:00 CST | Exec-AI-SECURE -> Exec-AI-PMO -> 架构总控（逾期即No-Go） |
| S19 | `msg_c4b2b4028001yHg89O6GVXYuhe` | `ses_3b4f22623ffe5MZHLFRUupYZZl` | `provider_request_id; provider_prompt_hash; provider_prompt_snapshot_ref(可脱敏); provider_sent_at_utc; provider_model_id; provider_audit_log_ref; receiver_signoff_name; receiver_signoff_at_cst` | 应用层负责人（实名） | 2026-02-12 12:00 CST | Exec-AI-SECURE -> Exec-AI-PMO -> 架构总控（逾期即No-Go） |
| S20 | `msg_c4b2edcdb0015Yn6v7Z6HfbOwz` | `ses_3b4f22623ffe5MZHLFRUupYZZl` | `provider_request_id; provider_prompt_hash; provider_prompt_snapshot_ref(可脱敏); provider_sent_at_utc; provider_model_id; provider_audit_log_ref; receiver_signoff_name; receiver_signoff_at_cst` | 应用层负责人（实名） | 2026-02-12 12:00 CST | Exec-AI-SECURE -> Exec-AI-PMO -> 架构总控（逾期即No-Go） |

## 3) 回填说明

- 回填入口文件：`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-01/provider-wire-intake-2026-02-11.csv`
- 回填时禁止私自假设；拿不到字段则保留 `unknown` 并给出缺失原因。
