# CARD-BLK-06 阻断执行看板（P0-A + I 前5，24h 卡化版）

- 日期：`2026-02-10`
- 执行代理：`Exec-AI-PMO`
- 范围：仅 `P0-A1~P0-A8` 与 `I.1/I.3/I.2/I.4/I.5`（对应 `CARD-BLK-01~05`）
- 依据：
  - `docs/plans/2026-02-10-v1_6-blocking-execution-cards.md`
  - `docs/plans/2026-02-10-v1_6-final-collab-architecture-decision.md`
- 约束：不改阈值，不改决策口径；仅做治理卡化与签收准备

## 0) Need-Decision（信息不足先升级）

| ID | Need-Decision | 建议负责人 | SLA | 若超时默认动作 |
|---|---|---|---|---|
| ND-01 | `P0-A1~P0-A8` 与 `I前5` 的实名 Owner 映射表拍板 | 架构总控 + PMO | `2026-02-11 12:00` | 全部任务保持“待签收”，阻断不解除 |
| ND-02 | `CARD-BLK-06` 架构总控实名签收人拍板 | 架构总控 | `2026-02-11 12:00` | 所有签收结论仅可标“预签收” |
| ND-03 | 首轮签收截止时间（D1→D2）拍板 | PMO | `2026-02-11 18:00` | 自动升级为 `Red`，暂停任何 Stage1 准备 |

## 1) 当前结论

- `P0-A + I前5` 已完成任务卡化，且每项均具备 `Owner/DoD/EvidencePath/ETA/RollbackAction`。
- 任务状态已达到“可签收输入完备”，可进入逐项签收流程。
- 因实名签收链路尚未闭环，当前总判定仍为：`阻断未解除`。

## 2) P0-A 阻断任务卡（可签收）

| Task | Owner | DoD | EvidencePath | ETA | RollbackAction | 签收状态 |
|---|---|---|---|---|---|---|
| P0-A1 修复 `secure-output` 合同到达链路 | `Exec-AI-SECURE`（首责） + 应用层负责人（待实名） | `prompt snapshot + 修复说明 + 回放证据` 可复核 | `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p0-a1/` | `2026-02-12` | 到达链路证据不成立则冻结上线，仅保留观测 | 待签收 |
| P0-A2 模式主路固化（`write/exec -> fork`） | `Exec-AI-ORCH`（首责） + orchestrator 负责人（待实名） | `路由决策表 + 门禁测试` 证明主路唯一 | `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p0-a2/` | `2026-02-11` | 门禁不稳定则回退既有路由并停止灰度准备 | 待签收 |
| P0-A3 claims 映射闭环（E# -> pointers） | `Exec-AI-SECURE`（首责） + 应用层负责人（待实名） | `claims map 规则 + 守卫前自检`，fact claims 可核验 | `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p0-a3/` | `2026-02-12` | 映射闭环失败则禁止“事实已确认”语气 | 待签收 |
| P0-A4 观测先行（埋点与聚合） | `Exec-AI-PMO`（首责） + 指标治理负责人（待实名） | `worker-turn-summary.json + 指标字段说明` 已落盘 | `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p0-a4/` | `2026-02-12` | 指标覆盖不全则暂停 Stage1 准备 | 待签收 |
| P0-A5 20 条回放门禁 | `Exec-AI-PMO`（首责） + 评测负责人（待实名） | `离线回放报告 + gate 结果`，20 条样本可追溯 | `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p0-a5/` | `2026-02-12` | 门禁未过则禁止进入 Stage1 | 待签收 |
| P0-A6 `anchor-snapshot/1.0` | `Exec-AI-SESSION`（首责） + session 负责人（待实名） | `anchor 协议产物 + 事件`，可回放一致 | `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p0-a6/` | `2026-02-13` | 锚点不一致则执行 fail-closed | 待签收 |
| P0-A7 `probe-journal/1.0` | `Exec-AI-RETRIEVAL`（首责） + retrieval 负责人（待实名） | `结构化 probe 账本 + dedupeKey 对齐报告` | `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p0-a7/` | `2026-02-13` | 重复探针不可控则暂停收敛策略切换 | 待签收 |
| P0-A8 `progress-ledger/1.0` | `Exec-AI-ORCH`（首责） + orchestrator 负责人（待实名） | `coverageGain/newEvidence/duplicateProbe` 事件可核验 | `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p0-a8/` | `2026-02-13` | 单调性无法验证则禁止放开 rerun | 待签收 |

## 3) I 前5补证任务卡（可签收）

| Task | Owner | DoD | EvidencePath | ETA | RollbackAction | 签收状态 |
|---|---|---|---|---|---|---|
| I.1 / CARD-BLK-01 `secure-output` 失配分层 | `Exec-AI-SECURE`（首责） + 应用层负责人（待实名） | `contract_delivery_vs_compliance.md`，可回答失配主链路 | `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-01/` | `2026-02-12` | 分层统计不收敛则冻结修复上线，仅保留观测 | 待签收 |
| I.3 / CARD-BLK-02 message 级重复 planned 根因 | `Exec-AI-ORCH`（首责） + orchestrator 负责人（待实名） | `planned-repeat-root-cause.md + planned-repeat-samples.json`，给出 Top1 根因占比 | `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-02/` | `2026-02-12` | 根因不明确则不收紧 breaker，仅增强观测 | 待签收 |
| I.2 / CARD-BLK-03 topK 噪声构成标注 | `Exec-AI-RETRIEVAL`（首责） + retrieval 负责人（待实名） | `topk-noise-breakdown.md + topk-noise-labeled.csv`，给出触发条件结论 | `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-03/` | `2026-02-13` | 标注冲突 `>15%` 则扩样后再决策 | 待签收 |
| I.4 / CARD-BLK-04 pointerContextOS 开关有效性 | `Exec-AI-SESSION`（首责） + session/processor 负责人（待实名） | `pointerContextOS-ab-report.md`，给出有效/无效/不稳定结论 | `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-04/` | `2026-02-12` | 若无效则开关任务降级 P1，避免误投 | 待签收 |
| I.5 / CARD-BLK-05 `patch_planner` lift 实证 | `Exec-AI-WORKER`（首责） + worker 协作负责人（待实名） | `patch-planner-lift-report.md + 原始对照数据`，给出保留策略建议 | `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-05/` | `2026-02-14` | lift 不显著则不提升 patch_planner 权重 | 待签收 |

## 4) 签收口径（冻结）

1. 任一任务缺失 `Owner/DoD/EvidencePath/ETA/RollbackAction`，直接判定 `阻断未解除`。
2. 不改 `P0` 与 `H.2` 阈值；Stage0 仅告警，Stage1+ 按既定阈值自动回滚。
3. `P0-A` 任一项未完成或未签收，不进入 Stage1。
