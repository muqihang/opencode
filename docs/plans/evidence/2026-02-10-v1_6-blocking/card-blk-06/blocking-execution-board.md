> [!WARNING] DEPRECATED（仅保留历史记录，不作为执行判定依据）
> Canonical 指向：
> - `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/blocking-execution-board.md`
> - `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/governance-canonical-index.md`
> 执行约束：后续判定仅认 canonical 文档集合。

# CARD-BLK-06 阻断执行看板（D1）

- 版本：`v1`
- 日期：`2026-02-10`
- 范围：仅 `P0-A1~P0-A8`、`P0-B1~P0-B5`
- 规则：任一项缺失 `Owner/ETA/DoD/EvidencePath/RollbackAction` 即判定“阻断未解除”

| Task | Owner | ETA | DoD | EvidencePath | RollbackAction | Status |
|---|---|---|---|---|---|---|
| P0-A1 secure-output 合同到达链路修复 | Exec-AI-SECURE（待实名签收） | 2026-02-12 | 提交 `prompt snapshot + 修复说明 + 回放证据`，可复核合同到达链路 | `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p0-a1/` | 若到达链路证据不成立，冻结上线，仅保留观测 | D1-已卡化 |
| P0-A2 模式主路固化（write/exec -> fork） | Exec-AI-ORCH（待实名签收） | 2026-02-11 | 提交 `路由决策表 + 门禁测试结果`，证明主路唯一 | `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p0-a2/` | 若门禁不稳定，回退到既有路由并停止灰度准备 | D1-已卡化 |
| P0-A3 claims 映射闭环（E# -> pointers） | Exec-AI-SECURE（待实名签收） | 2026-02-12 | 提交 `claims map 规则 + 守卫前自检结果`，fact claims 可核验 | `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p0-a3/` | 若映射闭环失败，禁止宣称事实已确认 | D1-已卡化 |
| P0-A4 观测先行（埋点与聚合） | Exec-AI-PMO（待实名签收） | 2026-02-12 | 提交 `worker-turn-summary.json + 指标字段说明`，阈值指标可落盘 | `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p0-a4/` | 若指标未覆盖，暂停 Stage1 准备 | D1-已卡化 |
| P0-A5 20 条回放门禁 | Exec-AI-PMO（待实名签收） | 2026-02-12 | 提交 `离线回放报告 + gate 结果`，20 条样本全部可追溯 | `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p0-a5/` | 若门禁未过，禁止进入灰度阶段 | D1-已卡化 |
| P0-A6 anchor-snapshot/1.0 | Exec-AI-SESSION（待实名签收） | 2026-02-13 | 提交 `anchor-snapshot 协议产物 + 事件记录`，可回放锚点一致 | `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p0-a6/` | 若锚点不一致，恢复流程 fail-closed | D1-已卡化 |
| P0-A7 probe-journal/1.0 | Exec-AI-RETRIEVAL（待实名签收） | 2026-02-13 | 提交 `结构化 probe 账本 + dedupeKey 对齐报告` | `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p0-a7/` | 若重复探针不可控，暂停收敛策略切换 | D1-已卡化 |
| P0-A8 progress-ledger/1.0 | Exec-AI-ORCH（待实名签收） | 2026-02-13 | 提交 `coverageGain/newEvidence/duplicateProbe 事件`，可执行停止规则 | `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p0-a8/` | 若进度单调性无法验证，禁止放开 rerun | D1-已卡化 |
| P0-B1 ToolRequestV2 + CriticVerdictV2 | Exec-AI-WORKER（待实名签收） | 2026-02-14 | 提交 `schema 文档 + fixture`，v2 可解析 | `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p0-b1/` | 若 v2 解析失败率高，维持 v1 主路径 | D1-已卡化 |
| P0-B2 EvidenceBundleV2（含 density） | Exec-AI-RETRIEVAL（待实名签收） | 2026-02-14 | 提交 `evidence-bundle 产物 + rerank 规则说明` | `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p0-b2/` | 若 token/密度收益不达标，回退旧注入 | D1-已卡化 |
| P0-B3 orchestrator_evidence_v2 注入模板 | Exec-AI-ORCH（待实名签收） | 2026-02-13 | 提交 `注入模板 + 长度约束检查`，至少含 3 条证据摘要 | `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p0-b3/` | 若注入超预算，先裁 notes 再降级 v1 | D1-已卡化 |
| P0-B4 重跑收敛（幂等键 + maxRerun） | Exec-AI-ORCH（待实名签收） | 2026-02-12 | 提交 `message-level breaker 方案 + 回放对照` | `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p0-b4/` | 若误伤召回，撤回 breaker 参数收紧 | D1-已卡化 |
| P0-B5 协议迁移双读双写 | Exec-AI-PMO（待实名签收） | 2026-02-12 | 提交 `v1/v2 迁移开关 + 切流记录`，可回退 | `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p0-b5/` | 若切流异常，立即回退 v1-only 写入 | D1-已卡化 |

## 阻断状态判定（D1）

- 字段齐备性：`13/13` 任务已具备 `Owner/ETA/DoD/EvidencePath/RollbackAction`
- 实名签收状态：`0/13`（均为待实名签收）
- 当前判定：`阻断未解除`（原因：逐项签收未完成）
