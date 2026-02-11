# CARD-BLK-01 失败样本待填清单（20 条框架）

- 日期：2026-02-10
- 作用：为 `contract_delivery_vs_compliance.md` 提供 20 条失败样本的统一记录模板
- 阶段：D1 启动（框架先行，数据后填）

## 字段说明（每条都要填）

- `sample_id`：固定 `S01`~`S20`
- `message_id`：失败消息唯一标识
- `session_id`：所属会话
- `occurred_at_utc`：失败发生时间（UTC）
- `prompt_hash`：输入快照哈希
- `contract_present`：`yes/no/unknown`
- `claims_block_present`：`yes/no/unknown`
- `degrade_reason`：降级原因原值
- `layer_judgement`：`delivery/compliance/mixed/unknown`
- `input_evidence_path`：输入证据绝对路径
- `output_evidence_path`：输出证据绝对路径
- `replay_evidence_path`：回放证据绝对路径
- `status`：`todo/in_progress/done`
- `owner_note`：执行备注（1 句）

## 20 条失败样本待填表

| sample_id | message_id | session_id | occurred_at_utc | prompt_hash | contract_present | claims_block_present | degrade_reason | layer_judgement | input_evidence_path | output_evidence_path | replay_evidence_path | status | owner_note |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| S01 | TODO | TODO | TODO | TODO | unknown | unknown | TODO | unknown | TODO | TODO | TODO | todo | TODO |
| S02 | TODO | TODO | TODO | TODO | unknown | unknown | TODO | unknown | TODO | TODO | TODO | todo | TODO |
| S03 | TODO | TODO | TODO | TODO | unknown | unknown | TODO | unknown | TODO | TODO | TODO | todo | TODO |
| S04 | TODO | TODO | TODO | TODO | unknown | unknown | TODO | unknown | TODO | TODO | TODO | todo | TODO |
| S05 | TODO | TODO | TODO | TODO | unknown | unknown | TODO | unknown | TODO | TODO | TODO | todo | TODO |
| S06 | TODO | TODO | TODO | TODO | unknown | unknown | TODO | unknown | TODO | TODO | TODO | todo | TODO |
| S07 | TODO | TODO | TODO | TODO | unknown | unknown | TODO | unknown | TODO | TODO | TODO | todo | TODO |
| S08 | TODO | TODO | TODO | TODO | unknown | unknown | TODO | unknown | TODO | TODO | TODO | todo | TODO |
| S09 | TODO | TODO | TODO | TODO | unknown | unknown | TODO | unknown | TODO | TODO | TODO | todo | TODO |
| S10 | TODO | TODO | TODO | TODO | unknown | unknown | TODO | unknown | TODO | TODO | TODO | todo | TODO |
| S11 | TODO | TODO | TODO | TODO | unknown | unknown | TODO | unknown | TODO | TODO | TODO | todo | TODO |
| S12 | TODO | TODO | TODO | TODO | unknown | unknown | TODO | unknown | TODO | TODO | TODO | todo | TODO |
| S13 | TODO | TODO | TODO | TODO | unknown | unknown | TODO | unknown | TODO | TODO | TODO | todo | TODO |
| S14 | TODO | TODO | TODO | TODO | unknown | unknown | TODO | unknown | TODO | TODO | TODO | todo | TODO |
| S15 | TODO | TODO | TODO | TODO | unknown | unknown | TODO | unknown | TODO | TODO | TODO | todo | TODO |
| S16 | TODO | TODO | TODO | TODO | unknown | unknown | TODO | unknown | TODO | TODO | TODO | todo | TODO |
| S17 | TODO | TODO | TODO | TODO | unknown | unknown | TODO | unknown | TODO | TODO | TODO | todo | TODO |
| S18 | TODO | TODO | TODO | TODO | unknown | unknown | TODO | unknown | TODO | TODO | TODO | todo | TODO |
| S19 | TODO | TODO | TODO | TODO | unknown | unknown | TODO | unknown | TODO | TODO | TODO | todo | TODO |
| S20 | TODO | TODO | TODO | TODO | unknown | unknown | TODO | unknown | TODO | TODO | TODO | todo | TODO |

## 汇总栏（样本填完后更新）

- `N_total_fail`：20（目标）
- `N_contract_present`：TODO
- `N_claims_block_present`：TODO
- `N_degraded`：TODO
- `N_unknown`：TODO
- `contract_delivery_rate`：TODO
- `contract_compliance_rate`：TODO
- `end_to_end_claims_rate`：TODO

## 启动阶段约束

- 不扩题到 P1/P2。
- 不改阈值，不改决策口径。
- 仅产出文档、证据、回放与分析结果。
