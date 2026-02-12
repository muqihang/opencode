# CARD-BLK-06 / P3-3：message 级重复 planned 根因补证（D2 实测）

- 日期：2026-02-12
- 目标：完成 I.3（Top1 根因 + 占比）
- 状态：`DONE`（非 BLOCKED）

## 1) 结论（Top1 + 占比）

- 重复样本数（`cycle>=2`）：`10`
- 有效样本数（`first_cause != unknown`）：`10`
- Top1 根因：`budget_rebound`
- Top1 占比：`100.00%`（`10/10`）

> 解释：10 条样本在首次进入重复态（cycle=2）前，均可观测到 `retrieval.degraded` 或 `orchestrator.degraded(stage=adaptive_ttc|dual_pass)`，与预算/退化回跳路径一致。

## 2) 取证口径与规则

### 2.1 样本来源

- 主来源（jsonl）：`/Users/muqihang/chelingxi_workspace/test/.opencode/evidence/local/default/**/events.jsonl`
- 覆盖文件数：`10`
- 输出样本：`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-3/planned-repeat-samples.json`
- 选样规则：按 `plannedCount` 降序取前 10 个 `messageId`（且满足重复 planned）

### 2.2 字段生成

- `messageId`：来自事件 `data.messageId/data.messageID`
- `planId`：来自 `orchestrator.planned.data.planId`
- `cycle`：同 `messageId` 的 `orchestrator.planned` 按时间顺序从 1 编号
- `trigger_source`（回放归因，不是事件原生字段）：
  - `protocol_reentry`：区间内出现 `protocol.violation` / `secure_output.degraded` / `secure_output.requested`
  - `budget_rebound`：区间内出现 `retrieval.degraded` 或 `orchestrator.degraded(stage=adaptive_ttc|dual_pass)` 或 reason 含 `adaptive.ttc`/`fallback=`
  - `outer_trigger`：区间内出现 `orchestrator.requested` / `chat.user` / `session.user_message`
  - 其余：`unknown`

## 3) Top1 统计明细

- 统计对象：每条样本的 `first_cause`（首次重复，即 `cycle=2` 的 `trigger_source`）
- 计数：
  - `budget_rebound`: 10
  - `protocol_reentry`: 0
  - `outer_trigger`: 0
  - `unknown`: 0

## 4) 样本快照（10/10）

| sampleId | messageId | planId | plannedCount | first_cause |
|---|---|---|---:|---|
| P3-3-001 | msg_c469dda90001QKDQjpou3Fpgk0 | 01KH39VSQHW69C3F3FF3DQNDA4 | 16 | budget_rebound |
| P3-3-002 | msg_c4afccdd70015wpQNZI5xYT5R7 | 01KH5FSN6ZFH20R6XJK180DK61 | 10 | budget_rebound |
| P3-3-003 | msg_c4b10fc95001F75HfPAhR5167o | 01KH5H1ZPKK6A41GRA5QMCSGX3 | 8 | budget_rebound |
| P3-3-004 | msg_c4af69bdb001pDTy8nBnuEro6Y | 01KH5FD8XV8XKEWG175DF9V7DV | 7 | budget_rebound |
| P3-3-005 | msg_c4b2661fd001ROME876qiAbbzY | 01KH5JCS00H62Q1DNCPA94EEGJ | 7 | budget_rebound |
| P3-3-006 | msg_c46bc6a4c001nkCj9853ZDTii3 | 01KH3BRWMHV5GHMAJ5MZXDX807 | 6 | budget_rebound |
| P3-3-007 | msg_c468eab4b001r6PuIIc11LJ3JC | 01KH38XCH2E9MNS80AA0CQSSJC | 4 | budget_rebound |
| P3-3-008 | msg_c4b2210b0001GFBAvzP56zqJKN | 01KH5J4640AXVHGFER2P6TCHJZ | 3 | budget_rebound |
| P3-3-009 | msg_c4b12f36b001dBksp3t7aGx8U5 | 01KH5H5XAFTYD5SN4Y137DKTRN | 2 | budget_rebound |
| P3-3-010 | msg_c4b140720001aoHswvVc3oIswN | 01KH5H8284E3BBRWPBA6TQ7FGM | 2 | budget_rebound |

## 5) 风险与缺口

1. `orchestrator.planned` 原始事件未直接带 `cycle/trigger_source`，当前依赖区间回放归因。
2. 个别样本在 `cycle>=3` 的区间可能无可匹配桥接事件（标为 `unknown`），但不影响本次 `first_cause` 统计。
3. 本批样本来自同一本地证据池（`/test/.opencode/evidence/local/default`），跨环境泛化需二次验证。

## 6) breaker 收紧可行性结论

- 结论：`可谨慎推进`（先小步收紧 + 持续观测）。
- 理由：本批重复 planned 首因高度集中在 `budget_rebound`，具备定向收紧依据。
- 前置保障：保留当前回放归因规则，且在后续迭代补齐 `message` 生命周期最小 trace 原生字段以降低人工归因成本。

## 7) Need-Decision

- 无
