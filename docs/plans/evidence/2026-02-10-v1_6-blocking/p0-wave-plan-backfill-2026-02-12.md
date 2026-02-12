# V1.6 P0 Wave Plan Backfill（2026-02-12，append-only）

- 回填时间：`2026-02-12`
- 文档性质：`Backfill`（本文件为回填，不改历史执行事实，不改写既有执行结果与签收结论）
- 适用范围：`P0-A1~P0-A8`（阻断）与 `P0-B1~P0-B5`（增强）
- 口径边界：仅汇总既有决策与执行看板口径；不新增阈值、不改动历史门禁判定

## 0) 计划来源路径（冻结）

- Decision（阈值/阶段/任务定义来源）：
  - `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/2026-02-10-v1_6-final-collab-architecture-decision.md`
- Execution Board（执行治理来源，canonical）：
  - `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/blocking-execution-board.md`
- Execution Board（P0-A/P0-B 13 项卡化明细，历史兼容来源）：
  - `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/blocking-execution-board.md`

> 回填说明：本文件按上述来源做“汇总回填”，用于补齐 P0 波次计划索引，不替代原始执行证据链。

## 1) P0 波次总体依赖与门禁关系（回填）

- `P0-A` 为阻断链路：任一项未完成或未签收，保持 `阻断未解除`，不得进入 `Stage1`。
- `P0-B` 为并行增强链路：可与 `P0-A` 并行推进；未完成不阻断 `Stage1`，但影响协议升级与后续波次收益。
- `P0-A` 内部依赖（按决策与执行口径回填）：
  - `P0-A1 + P0-A3` 同属 secure-output 合同链路闭环。
  - `P0-A4`（观测先行）为 `P0-A5`（20 条回放门禁）的验收前置。
  - `P0-A6 -> P0-A7 -> P0-A8` 构成外置工作记忆 V1 基础三件套。
- `P0-B` 内部依赖（按协议演进顺序回填）：
  - `P0-B1`（v2 协议定义）为 `P0-B2/P0-B3/P0-B5` 的基础前提。
  - `P0-B2`（EvidenceBundleV2）与 `P0-B3`（注入模板）共同支撑可判定证据注入。
  - `P0-B4`（重跑收敛）依赖前述协议/注入稳定后再收口参数。

## 2) P0-A 阻断任务汇总（任务 / 依赖 / 验收口径 / 回滚动作）

| 任务 | 依赖（回填） | 验收口径（DoD） | 回滚动作 |
|---|---|---|---|
| P0-A1 修复 `secure-output` 合同到达链路 | 与 `P0-A3` 联动闭环 | `prompt snapshot + 修复说明 + 回放证据` 可复核 | 到达链路证据不成立则冻结上线，仅保留观测 |
| P0-A2 模式主路固化（`write/exec -> fork`） | 与 `P0-A5` 门禁联动验证 | `路由决策表 + 门禁测试` 证明主路唯一 | 门禁不稳定则回退既有路由并停止灰度准备 |
| P0-A3 claims 映射闭环（E# -> pointers） | 与 `P0-A1` 同链路 | `claims map 规则 + 守卫前自检`，fact claims 可核验 | 映射闭环失败则禁止“事实已确认”语气 |
| P0-A4 观测先行（埋点与聚合） | 为 `P0-A5` 前置 | `worker-turn-summary.json + 指标字段说明` 已落盘 | 指标覆盖不全则暂停 Stage1 准备 |
| P0-A5 20 条回放门禁 | 依赖 `P0-A1~P0-A4` 产物完备 | `离线回放报告 + gate 结果`，20 条样本可追溯 | 门禁未过则禁止进入 Stage1 |
| P0-A6 `anchor-snapshot/1.0` | 外置工作记忆三件套起点 | `anchor 协议产物 + 事件` 可回放一致 | 锚点不一致则执行 fail-closed |
| P0-A7 `probe-journal/1.0` | 依赖 `P0-A6` 锚点基线 | `结构化 probe 账本 + dedupeKey 对齐报告` | 重复探针不可控则暂停收敛策略切换 |
| P0-A8 `progress-ledger/1.0` | 依赖 `P0-A6/P0-A7` 事件链 | `coverageGain/newEvidence/duplicateProbe` 事件可核验 | 单调性无法验证则禁止放开 rerun |

## 3) P0-B 增强任务汇总（任务 / 依赖 / 验收口径 / 回滚动作）

| 任务 | 依赖（回填） | 验收口径（DoD） | 回滚动作 |
|---|---|---|---|
| P0-B1 `ToolRequestV2 + CriticVerdictV2` | 协议演进基座 | `schema 文档 + fixture`，v2 可解析 | v2 解析失败率高则维持 v1 主路径 |
| P0-B2 `EvidenceBundleV2`（含 density） | 依赖 `P0-B1` | `evidence-bundle 产物 + rerank 规则说明` | token/密度收益不达标则回退旧注入 |
| P0-B3 `orchestrator_evidence_v2` 注入模板 | 依赖 `P0-B1/P0-B2` | `注入模板 + 长度约束检查`，至少含 3 条证据摘要 | 注入超预算则先裁 notes 再降级 v1 |
| P0-B4 重跑收敛（幂等键 + maxRerun） | 依赖 `P0-B3` 注入稳定后收口 | `message-level breaker 方案 + 回放对照` | 若误伤召回则撤回 breaker 参数收紧 |
| P0-B5 协议迁移双读双写 | 依赖 `P0-B1~P0-B4` 的迁移窗口 | `v1/v2 迁移开关 + 切流记录` 可回退 | 切流异常则立即回退 `v1-only` 写入 |

## 4) 验收口径（回填冻结）

1. 任一任务缺失 `Owner/DoD/EvidencePath/ETA/RollbackAction`，直接判定 `阻断未解除`。
2. 不改 `P0` 与 `H.2` 阈值；`Stage0` 仅告警，`Stage1+` 按既定阈值自动回滚。
3. `P0-A` 任一项未完成或未签收，不进入 `Stage1`。
4. 本回填仅补齐“计划索引”，不覆盖历史 D1/D2/closeout 当时结论。

## 5) 已有关联 closeout（回指）

- 最终门禁闭环：`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/final-gate-closeout-2026-02-12.md`
- P1 波次闭环：`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/p1-wave-closeout-2026-02-12.md`
- P1 online-gate 闭环：`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/p1-wave-closeout-2026-02-12-online-gate.md`

## 6) append-only 生效声明

- 本文件自落盘起作为 `P0 wave` 计划回填索引使用。
- 本文件不删改任何历史正文，不重写任何已发生执行事实，仅做“来源回指 + 口径归档 + 路径补齐”。
