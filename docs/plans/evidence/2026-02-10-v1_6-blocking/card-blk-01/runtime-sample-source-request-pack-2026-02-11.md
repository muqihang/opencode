# ND-SAMPLE-20-S03~S20 可执行采集包（CARD-BLK-06）

- 日期：`2026-02-11`
- 执行角色：`Exec-AI-PMO`（仅 CARD-BLK-06，禁止跨卡）
- 目标：将 S03~S20 从“请求描述”升级为“可执行采集包 + 可回填入口”
- 约束：不改阈值、不改决策口径、不改业务代码
- Canonical 指向：`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/governance-canonical-index.md`
- 回填入口（CSV）：`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-01/runtime-sample-source-intake-2026-02-11.csv`
- 生成时间：`2026-02-11 12:06:06 CST`

## 执行说明（固定）

1. 本包覆盖样本：`S03~S20`（18条，逐条独立回填）。
2. 回填人需在 intake CSV 对应 sample 行回填真实 `message_id/session_id` 以及三联绝对路径。
3. 任一条缺 `message_id/session_id` 或三联路径，`status=blocked`，并执行该条升级动作。

## 18条逐条执行卡（不得合并）

| sample_id | 当前状态 | 缺失项 | provider_owner | SLA | 升级动作 | 回填入口 |
|---|---|---|---|---|---|---|
| S03 | blocked | message_id/session_id + input/output/replay 三联路径 | 应用层负责人+Exec-AI-SECURE(待实名) | 2026-02-11 18:00 | 该条未闭环 -> Exec-AI-PMO 升级架构总控，并在日报标记 Red 风险 | /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-01/runtime-sample-source-intake-2026-02-11.csv（sample_id=S03） |
| S04 | blocked | message_id/session_id + input/output/replay 三联路径 | 应用层负责人+Exec-AI-SECURE(待实名) | 2026-02-11 18:00 | 该条未闭环 -> Exec-AI-PMO 升级架构总控，并在日报标记 Red 风险 | /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-01/runtime-sample-source-intake-2026-02-11.csv（sample_id=S04） |
| S05 | blocked | message_id/session_id + input/output/replay 三联路径 | 应用层负责人+Exec-AI-SECURE(待实名) | 2026-02-11 18:00 | 该条未闭环 -> Exec-AI-PMO 升级架构总控，并在日报标记 Red 风险 | /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-01/runtime-sample-source-intake-2026-02-11.csv（sample_id=S05） |
| S06 | blocked | message_id/session_id + input/output/replay 三联路径 | 应用层负责人+Exec-AI-SECURE(待实名) | 2026-02-11 18:00 | 该条未闭环 -> Exec-AI-PMO 升级架构总控，并在日报标记 Red 风险 | /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-01/runtime-sample-source-intake-2026-02-11.csv（sample_id=S06） |
| S07 | blocked | message_id/session_id + input/output/replay 三联路径 | 应用层负责人+Exec-AI-SECURE(待实名) | 2026-02-11 18:00 | 该条未闭环 -> Exec-AI-PMO 升级架构总控，并在日报标记 Red 风险 | /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-01/runtime-sample-source-intake-2026-02-11.csv（sample_id=S07） |
| S08 | blocked | message_id/session_id + input/output/replay 三联路径 | 应用层负责人+Exec-AI-SECURE(待实名) | 2026-02-11 18:00 | 该条未闭环 -> Exec-AI-PMO 升级架构总控，并在日报标记 Red 风险 | /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-01/runtime-sample-source-intake-2026-02-11.csv（sample_id=S08） |
| S09 | blocked | message_id/session_id + input/output/replay 三联路径 | 应用层负责人+Exec-AI-SECURE(待实名) | 2026-02-11 18:00 | 该条未闭环 -> Exec-AI-PMO 升级架构总控，并在日报标记 Red 风险 | /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-01/runtime-sample-source-intake-2026-02-11.csv（sample_id=S09） |
| S10 | blocked | message_id/session_id + input/output/replay 三联路径 | 应用层负责人+Exec-AI-SECURE(待实名) | 2026-02-11 18:00 | 该条未闭环 -> Exec-AI-PMO 升级架构总控，并在日报标记 Red 风险 | /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-01/runtime-sample-source-intake-2026-02-11.csv（sample_id=S10） |
| S11 | blocked | message_id/session_id + input/output/replay 三联路径 | 应用层负责人+Exec-AI-SECURE(待实名) | 2026-02-11 18:00 | 该条未闭环 -> Exec-AI-PMO 升级架构总控，并在日报标记 Red 风险 | /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-01/runtime-sample-source-intake-2026-02-11.csv（sample_id=S11） |
| S12 | blocked | message_id/session_id + input/output/replay 三联路径 | 应用层负责人+Exec-AI-SECURE(待实名) | 2026-02-11 18:00 | 该条未闭环 -> Exec-AI-PMO 升级架构总控，并在日报标记 Red 风险 | /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-01/runtime-sample-source-intake-2026-02-11.csv（sample_id=S12） |
| S13 | blocked | message_id/session_id + input/output/replay 三联路径 | 应用层负责人+Exec-AI-SECURE(待实名) | 2026-02-11 18:00 | 该条未闭环 -> Exec-AI-PMO 升级架构总控，并在日报标记 Red 风险 | /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-01/runtime-sample-source-intake-2026-02-11.csv（sample_id=S13） |
| S14 | blocked | message_id/session_id + input/output/replay 三联路径 | 应用层负责人+Exec-AI-SECURE(待实名) | 2026-02-11 18:00 | 该条未闭环 -> Exec-AI-PMO 升级架构总控，并在日报标记 Red 风险 | /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-01/runtime-sample-source-intake-2026-02-11.csv（sample_id=S14） |
| S15 | blocked | message_id/session_id + input/output/replay 三联路径 | 应用层负责人+Exec-AI-SECURE(待实名) | 2026-02-11 18:00 | 该条未闭环 -> Exec-AI-PMO 升级架构总控，并在日报标记 Red 风险 | /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-01/runtime-sample-source-intake-2026-02-11.csv（sample_id=S15） |
| S16 | blocked | message_id/session_id + input/output/replay 三联路径 | 应用层负责人+Exec-AI-SECURE(待实名) | 2026-02-11 18:00 | 该条未闭环 -> Exec-AI-PMO 升级架构总控，并在日报标记 Red 风险 | /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-01/runtime-sample-source-intake-2026-02-11.csv（sample_id=S16） |
| S17 | blocked | message_id/session_id + input/output/replay 三联路径 | 应用层负责人+Exec-AI-SECURE(待实名) | 2026-02-11 18:00 | 该条未闭环 -> Exec-AI-PMO 升级架构总控，并在日报标记 Red 风险 | /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-01/runtime-sample-source-intake-2026-02-11.csv（sample_id=S17） |
| S18 | blocked | message_id/session_id + input/output/replay 三联路径 | 应用层负责人+Exec-AI-SECURE(待实名) | 2026-02-11 18:00 | 该条未闭环 -> Exec-AI-PMO 升级架构总控，并在日报标记 Red 风险 | /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-01/runtime-sample-source-intake-2026-02-11.csv（sample_id=S18） |
| S19 | blocked | message_id/session_id + input/output/replay 三联路径 | 应用层负责人+Exec-AI-SECURE(待实名) | 2026-02-11 18:00 | 该条未闭环 -> Exec-AI-PMO 升级架构总控，并在日报标记 Red 风险 | /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-01/runtime-sample-source-intake-2026-02-11.csv（sample_id=S19） |
| S20 | blocked | message_id/session_id + input/output/replay 三联路径 | 应用层负责人+Exec-AI-SECURE(待实名) | 2026-02-11 18:00 | 该条未闭环 -> Exec-AI-PMO 升级架构总控，并在日报标记 Red 风险 | /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-01/runtime-sample-source-intake-2026-02-11.csv（sample_id=S20） |

## 校验门禁

- [ ] S03~S20 共18条均已逐条写入 intake CSV。
- [ ] `verify_exists` 已按 yes/no 填写。
- [ ] 任一 blocked 条目均有升级动作（逐条）。
- [ ] 回填后同步更新 `runtime-sample-source-20.md` 与 tracker 状态。
