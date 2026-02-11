# CARD-BLK-06 治理口径 Canonical Index

- 日期：`2026-02-10`
- 目的：收敛并行看板/日报口径，固定后续执行与检查的唯一依据
- 范围：仅 `CARD-BLK-06` 执行治理，不跨卡改口径

## 1) 结论（口径收敛）

- 后续治理判定采用“`6张卡进度` + `13项任务进度` 双维显示”，但判定规则仅认 canonical 文档集合。
- 阈值、门禁、回滚触发一律以决策稿冻结口径为准；任何日报/兼容文档不得改写。

## 2) 唯一主文档集合（Canonical）

1. 决策口径与阈值：
   - `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/2026-02-10-v1_6-final-collab-architecture-decision.md`
2. 执行卡定义（Owner/DoD/EvidencePath/ETA/RollbackAction）：
   - `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/2026-02-10-v1_6-blocking-execution-cards.md`
3. 执行看板（13项任务卡化状态）：
   - `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/blocking-execution-board.md`
4. 阻断解除检查表（字段完整性与签收判定）：
   - `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/blocking-clearance-checklist.md`
5. 实名催办与截止追踪：
   - `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/owner-signoff-naglist-13.md`
   - `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/owner-signoff-tracker-2026-02-11.md`
6. CARD-BLK-01 20条失败样本权威来源清单：
   - `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-01/runtime-sample-source-20.md`
7. 每日报告模板（双指标口径）：
   - `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/templates/2026-02-10-v1_6-blocking-daily-template.md`

## 3) 兼容文档集合（Compatible，非判定主依据）

- `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/blocking-execution-board.md`
- `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/unblock-checklist.md`
- `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/daily-tracking-table.md`
- `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/daily-report-2026-02-10.md`
- `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/daily-status-2026-02-10.md`（用于每日快照；判定须回指 canonical）

## 4) 冲突处理规则

1. 若“日报口径”与“检查表口径”冲突，以 canonical 检查表判定为准。
2. 若“执行看板任务定义”与“兼容文档描述”冲突，以执行卡定义为准。
3. 若任一文档试图调整阈值/决策口径，视为无效并登记 `Need-Decision`。

## 5) 模板升级记录（双指标）

- 变更项：日报模板新增并固定 `card_progress（x/6）` 与 `task_progress（x/13）`。
- 兼容策略：保留“阻断解除进度（x/6）”作为旧字段兼容，不改变原结构章节。
- 生效时间：`2026-02-11 11:48:01 CST`
- 执行要求：后续日报必须同时填写 `x/6` 与 `x/13`。

## 6) 生效声明

- 自本文件落盘起，后续日报与检查结论必须显式声明“以 canonical-index 为准”。

## 7) ND-SAMPLE-20 闭环同步记录（CARD-BLK-06）

- 同步时间：`2026-02-11 13:45:10 CST`
- 证据来源：
  - `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-01/runtime-sample-source-20.md`
  - `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-01/runtime-sample-source-closure-report.md`
- 同步结论：`ND-SAMPLE-20 = closed (20/20)`。
- 生效口径：`可进入统计前置门槛`。
- 状态声明：`CARD-BLK-01 处于统计中，未Final签收`。
- 报表要求不变：后续日报必须同时填 `card_progress(x/6)` 与 `task_progress(x/13)`。

## 8) I.1 治理阻断点纠偏口径（CARD-BLK-06）

- 同步时间：`2026-02-11 14:09:44 CST`
- 决策单：`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-01/nd-i1-unknown-governance-need-decision.md`
- 依据：`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-01/contract_delivery_vs_compliance.md`、`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-01/samples-20-reconcile.csv`
- 纠偏结论：仓内证据 `contract_present/prompt_hash unknown` 已清零（`0/20`）。
- 治理 Need-Decision 状态：
  - `ND-I1-UNKNOWN-01`：`closed`（仓内可判别证据已补齐）
  - `ND-I1-UNKNOWN-02`：`closed`（仓内可判别证据已补齐）
  - `ND-I1-PROVIDER-WIRE-01`：`open`（`provider_wire_prompt_snapshot_missing 20/20`）
- 执行/签收/SLA：Owner `Exec-AI-SECURE`；签收 `应用层负责人（实名）`；SLA `2026-02-12 12:00 CST`
- 升级链路统一：`Exec-AI-PMO -> 架构总控 -> Red 升级并维持 No-Go`。
- 门禁声明：未补齐 provider-wire 前，`CARD-BLK-01` 仅统计草案，禁止 Final 主因签收。
- 报表要求不变：后续日报继续双指标 `card_progress(x/6)+task_progress(x/13)`。

## 9) Provider-Wire 可执行催收口径（CARD-BLK-06）

- 同步时间：`2026-02-11 14:12:00 CST`
- 证据包：
  - `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-01/provider-wire-request-sendout-2026-02-11.md`
  - `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-01/provider-wire-send-receipt-ledger-2026-02-11.csv`
- ND-I1-PROVIDER-WIRE-01 状态：`open`
- 当前 pending：`20/20`
- 状态定义：`open=20/20`、`partial=1~19/20`、`closed=0/20`
- 门禁结论：未 `20/20` 前，`CARD-BLK-01` 仅统计草案，禁止 Final 主因签收（`Final No-Go`）
- 执行节奏：固定 `2h` 催办到 `2026-02-12 12:00 CST`（以 tracker 检查点为执行基准）
- 双指标要求不变：后续日报继续填写 `card_progress(x/6)` + `task_progress(x/13)`

## 10) Provider-Wire 当前检查点口径回填（CARD-BLK-06）

- 同步时间：`2026-02-11 14:26:06 CST`
- 检查点：`T0 基线锁定（2026-02-11 14:00 CST）`
- ND-I1-PROVIDER-WIRE-01 状态：`open`
- 当前 pending：`20/20`
- 回执账本：`ack=0/20`，`pending=20/20`，`escalation=yes 为 0/20`
- 下一催办时间：`2026-02-11 16:00:00 CST`
- 门禁结论：未 `20/20` 前维持 `Final No-Go`；`CARD-BLK-01` 仅统计草案，禁止 Final 主因签收
- 报表要求不变：继续双指标 `card_progress(x/6)` + `task_progress(x/13)`

## 11) Provider-Wire T1检查点口径回填（CARD-BLK-06）

- 同步时间：`2026-02-11 16:00:00 CST`
- 检查点：`T1（2026-02-11 16:00:00 CST）`
- ND-I1-PROVIDER-WIRE-01 状态：`open`
- 当前 pending：`20/20`
- 回执账本状态：`ack=0/20`，`pending=20/20`，`escalation=yes 为 20/20`
- 本轮delta：`新增ack=0`，`新增升级=20`
- 下一检查点时间：`2026-02-11 18:00:00 CST`
- 门禁结论（仅判定）：`Final No-Go`（未 `20/20` 前仅统计草案，禁止 Final 主因签收）
- 双指标要求不变：继续 `card_progress(x/6)` + `task_progress(x/13)`

## 12) Provider-Wire T2检查点口径回填（CARD-BLK-06）

- 同步时间：`2026-02-11 18:00:00 CST`
- 检查点：`T2（2026-02-11 18:00:00 CST）`
- ND-I1-PROVIDER-WIRE-01 状态：`open`
- 当前 pending：`20/20`
- 回执账本状态：`ack=0/20`，`pending=20/20`，`escalation=yes 为 20/20`
- 本轮delta：`新增ack=0`，`新增升级=0`
- 下一检查点时间：`2026-02-11 20:00:00 CST`
- 门禁结论（仅判定）：`Final No-Go`（未 `20/20` 前仅统计草案，禁止 Final 主因签收）
- 双指标要求不变：继续 `card_progress(x/6)` + `task_progress(x/13)`

## 13) Provider-Wire T3检查点口径回填（CARD-BLK-06）

- 同步时间：`2026-02-11 20:00:00 CST`
- 检查点：`T3（2026-02-11 20:00:00 CST）`
- ND-I1-PROVIDER-WIRE-01 状态：`open`
- 当前 pending：`20/20`
- 回执账本状态：`ack=0/20`，`pending=20/20`，`escalation=yes 为 20/20`
- 本轮delta：`新增ack=0`，`新增升级=0`
- 升级记录：已按既定链路执行 `Exec-AI-PMO -> 架构总控`（T3轮）
- 下一检查点时间：`2026-02-11 22:00:00 CST`
- 门禁结论（仅判定）：`Final No-Go`（未 `20/20` 前仅统计草案，禁止 Final 主因签收）
- 双指标要求不变：继续 `card_progress(x/6)` + `task_progress(x/13)`

## 14) Exception Waiver 生效口径（CARD-BLK-06）

- 生效时间：`2026-02-11 20:30:00 CST`
- Decision：`Conditional Go (Exception)`
- D2执行门禁：`Go`（仅放行当前迭代统计推进）
- Final 门禁：`No-Go（unchanged）`
- 唯一阻断：`ND-I1-PROVIDER-WIRE-01（open）`
- 风险接受人：`muqihang`
- 到期复核：`2026-02-12 12:00:00 CST`
- 回退触发：到期未达到 provider-wire `20/20 complete` => 维持 `Red + Final No-Go`
- 口径边界：本例外放行不改变阈值/规则，不得将 `CARD-BLK-01` 标记为 Final Go
- Waiver 主文档：`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-01/exception-waiver-2026-02-11.md`

