# CARD-BLK-06 Provider-Wire 对外发送版请求单（按接收人分组）

- 日期：`2026-02-11`
- 角色：`Exec-AI-PMO`（仅 CARD-BLK-06）
- 约束：不改阈值、不改决策口径、不改业务代码
- 来源：`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-01/provider-wire-request-pack-2026-02-11.md`、`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-01/provider-wire-intake-2026-02-11.csv`
- 总量校验：`20/20`（不丢失）
- 统一门禁：未补齐 provider-wire 前，`CARD-BLK-01` 仅统计草案，禁止 Final 主因签收

## 对外发送说明（可直接转发）

- 请求字段：`provider_request_id; provider_prompt_hash; provider_prompt_snapshot_ref(可脱敏); provider_sent_at_utc; provider_model_id; provider_audit_log_ref; receiver_signoff_name; receiver_signoff_at_cst`
- 截止时间：`2026-02-12 12:00 CST`
- 回执账本：`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-01/provider-wire-send-receipt-ledger-2026-02-11.csv`

## 接收人分组清单

### 接收人：应用层负责人（实名）（20/20）

| sample_id | message_id | session_id | 需回填字段 | SLA |
|---|---|---|---|---|
| S01 | `msg_c46bc6a4c001nkCj9853ZDTii3` | `ses_3b94395d0ffeC634iIBFEBTwWj` | `provider_request_id; provider_prompt_hash; provider_prompt_snapshot_ref(可脱敏); provider_sent_at_utc; provider_model_id; provider_audit_log_ref; receiver_signoff_name; receiver_signoff_at_cst` | `2026-02-12 12:00 CST` |
| S02 | `msg_c469dda90001QKDQjpou3Fpgk0` | `ses_3b9622573ffejMRJFrytlZ5nbO` | `provider_request_id; provider_prompt_hash; provider_prompt_snapshot_ref(可脱敏); provider_sent_at_utc; provider_model_id; provider_audit_log_ref; receiver_signoff_name; receiver_signoff_at_cst` | `2026-02-12 12:00 CST` |
| S03 | `msg_c4af69bdb001pDTy8nBnuEro6Y` | `ses_3b51283d0ffeWbeAOjPM3NUMPy` | `provider_request_id; provider_prompt_hash; provider_prompt_snapshot_ref(可脱敏); provider_sent_at_utc; provider_model_id; provider_audit_log_ref; receiver_signoff_name; receiver_signoff_at_cst` | `2026-02-12 12:00 CST` |
| S04 | `msg_c4af8e8d1001wANN6RfrFWoXsZ` | `ses_3b51283d0ffeWbeAOjPM3NUMPy` | `provider_request_id; provider_prompt_hash; provider_prompt_snapshot_ref(可脱敏); provider_sent_at_utc; provider_model_id; provider_audit_log_ref; receiver_signoff_name; receiver_signoff_at_cst` | `2026-02-12 12:00 CST` |
| S05 | `msg_c4afccdd70015wpQNZI5xYT5R7` | `ses_3b51283d0ffeWbeAOjPM3NUMPy` | `provider_request_id; provider_prompt_hash; provider_prompt_snapshot_ref(可脱敏); provider_sent_at_utc; provider_model_id; provider_audit_log_ref; receiver_signoff_name; receiver_signoff_at_cst` | `2026-02-12 12:00 CST` |
| S06 | `msg_c4b10fc95001F75HfPAhR5167o` | `ses_3b4f22623ffe5MZHLFRUupYZZl` | `provider_request_id; provider_prompt_hash; provider_prompt_snapshot_ref(可脱敏); provider_sent_at_utc; provider_model_id; provider_audit_log_ref; receiver_signoff_name; receiver_signoff_at_cst` | `2026-02-12 12:00 CST` |
| S07 | `msg_c4b12f36b001dBksp3t7aGx8U5` | `ses_3b4f22623ffe5MZHLFRUupYZZl` | `provider_request_id; provider_prompt_hash; provider_prompt_snapshot_ref(可脱敏); provider_sent_at_utc; provider_model_id; provider_audit_log_ref; receiver_signoff_name; receiver_signoff_at_cst` | `2026-02-12 12:00 CST` |
| S08 | `msg_c4b140720001aoHswvVc3oIswN` | `ses_3b4f22623ffe5MZHLFRUupYZZl` | `provider_request_id; provider_prompt_hash; provider_prompt_snapshot_ref(可脱敏); provider_sent_at_utc; provider_model_id; provider_audit_log_ref; receiver_signoff_name; receiver_signoff_at_cst` | `2026-02-12 12:00 CST` |
| S09 | `msg_c4b2210b0001GFBAvzP56zqJKN` | `ses_3b4f22623ffe5MZHLFRUupYZZl` | `provider_request_id; provider_prompt_hash; provider_prompt_snapshot_ref(可脱敏); provider_sent_at_utc; provider_model_id; provider_audit_log_ref; receiver_signoff_name; receiver_signoff_at_cst` | `2026-02-12 12:00 CST` |
| S10 | `msg_c4b2661fd001ROME876qiAbbzY` | `ses_3b4f22623ffe5MZHLFRUupYZZl` | `provider_request_id; provider_prompt_hash; provider_prompt_snapshot_ref(可脱敏); provider_sent_at_utc; provider_model_id; provider_audit_log_ref; receiver_signoff_name; receiver_signoff_at_cst` | `2026-02-12 12:00 CST` |
| S11 | `msg_c4b2768ff001BvRzXy7K55qGGS` | `ses_3b4f22623ffe5MZHLFRUupYZZl` | `provider_request_id; provider_prompt_hash; provider_prompt_snapshot_ref(可脱敏); provider_sent_at_utc; provider_model_id; provider_audit_log_ref; receiver_signoff_name; receiver_signoff_at_cst` | `2026-02-12 12:00 CST` |
| S12 | `msg_c4b27c85d001Bl3S5s0sM2fpAA` | `ses_3b4f22623ffe5MZHLFRUupYZZl` | `provider_request_id; provider_prompt_hash; provider_prompt_snapshot_ref(可脱敏); provider_sent_at_utc; provider_model_id; provider_audit_log_ref; receiver_signoff_name; receiver_signoff_at_cst` | `2026-02-12 12:00 CST` |
| S13 | `msg_c4b2841e1001o35rbn8yRfGmo6` | `ses_3b4f22623ffe5MZHLFRUupYZZl` | `provider_request_id; provider_prompt_hash; provider_prompt_snapshot_ref(可脱敏); provider_sent_at_utc; provider_model_id; provider_audit_log_ref; receiver_signoff_name; receiver_signoff_at_cst` | `2026-02-12 12:00 CST` |
| S14 | `msg_c4b287b20001rwu1r63uDcyXvI` | `ses_3b4f22623ffe5MZHLFRUupYZZl` | `provider_request_id; provider_prompt_hash; provider_prompt_snapshot_ref(可脱敏); provider_sent_at_utc; provider_model_id; provider_audit_log_ref; receiver_signoff_name; receiver_signoff_at_cst` | `2026-02-12 12:00 CST` |
| S15 | `msg_c4b2929c9001G8XXgvRqnR6kxx` | `ses_3b4f22623ffe5MZHLFRUupYZZl` | `provider_request_id; provider_prompt_hash; provider_prompt_snapshot_ref(可脱敏); provider_sent_at_utc; provider_model_id; provider_audit_log_ref; receiver_signoff_name; receiver_signoff_at_cst` | `2026-02-12 12:00 CST` |
| S16 | `msg_c4b2976b8001VOqXtPBaS222FI` | `ses_3b4f22623ffe5MZHLFRUupYZZl` | `provider_request_id; provider_prompt_hash; provider_prompt_snapshot_ref(可脱敏); provider_sent_at_utc; provider_model_id; provider_audit_log_ref; receiver_signoff_name; receiver_signoff_at_cst` | `2026-02-12 12:00 CST` |
| S17 | `msg_c4b2aa656001Cor2tUPAYb08wB` | `ses_3b4f22623ffe5MZHLFRUupYZZl` | `provider_request_id; provider_prompt_hash; provider_prompt_snapshot_ref(可脱敏); provider_sent_at_utc; provider_model_id; provider_audit_log_ref; receiver_signoff_name; receiver_signoff_at_cst` | `2026-02-12 12:00 CST` |
| S18 | `msg_c4b2aebce001kpqNSdafGmM3mj` | `ses_3b4f22623ffe5MZHLFRUupYZZl` | `provider_request_id; provider_prompt_hash; provider_prompt_snapshot_ref(可脱敏); provider_sent_at_utc; provider_model_id; provider_audit_log_ref; receiver_signoff_name; receiver_signoff_at_cst` | `2026-02-12 12:00 CST` |
| S19 | `msg_c4b2b4028001yHg89O6GVXYuhe` | `ses_3b4f22623ffe5MZHLFRUupYZZl` | `provider_request_id; provider_prompt_hash; provider_prompt_snapshot_ref(可脱敏); provider_sent_at_utc; provider_model_id; provider_audit_log_ref; receiver_signoff_name; receiver_signoff_at_cst` | `2026-02-12 12:00 CST` |
| S20 | `msg_c4b2edcdb0015Yn6v7Z6HfbOwz` | `ses_3b4f22623ffe5MZHLFRUupYZZl` | `provider_request_id; provider_prompt_hash; provider_prompt_snapshot_ref(可脱敏); provider_sent_at_utc; provider_model_id; provider_audit_log_ref; receiver_signoff_name; receiver_signoff_at_cst` | `2026-02-12 12:00 CST` |

## 完整性校验

- `sample_id` 覆盖：`S01~S20`
- 接收人分组数量：`1`
- 样本丢失：`0`
