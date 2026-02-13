# progress-ledger/1.0 最小规范（P0-A8）

- Card: `CARD-BLK-06 / P0-A8`
- 范围: `packages/opencode/src/session/orchestrator/writer.ts` + orchestrator/adaptive-ttc 测试链路
- 目标: 在不改业务策略语义前提下，补齐 progress-ledger 单调性审计字段，并将 `evidence_gain_per_cycle` 升级为原生落盘字段

## 1) 结构定义

`progress-ledger/1.0` 当前最小结构（落在 `orchestrator.planned` 事件 `data` 内）如下：

```json
{
  "specVersion": "progress-ledger/1.0",
  "messageId": "<message>",
  "cycle": 1,
  "coverageGain": 1,
  "newEvidenceCount": 1,
  "duplicateProbeRate": 0,
  "decision": "continue",
  "stopReason": "not_stopped",
  "evidence_gain_per_cycle": 1
}
```

当命中 `adaptive.ttc.early_stop / adaptive.ttc.degrade_* / adaptive.ttc.breaker.*` 等停机语义时，最小 stop 快照为：

```json
{
  "specVersion": "progress-ledger/1.0",
  "messageId": "<message>",
  "cycle": 1,
  "coverageGain": 0,
  "newEvidenceCount": 0,
  "duplicateProbeRate": 1,
  "decision": "stop",
  "stopReason": "no_new_evidence",
  "evidence_gain_per_cycle": 0
}
```

## 2) 字段定义与来源

| 字段 | 类型 | 来源 | 说明 |
|---|---|---|---|
| `specVersion` | string | 常量 | 固定 `progress-ledger/1.0` |
| `messageId` | string | `plan.messageId` | message-cycle 审计主键 |
| `cycle` | number | `sessionId+messageId` 计数器 | 同 message 连续写入递增 |
| `coverageGain` | number | 由当前最小 stop/continue 判定映射 | stop=0，continue=1 |
| `newEvidenceCount` | number | 由当前最小 stop/continue 判定映射 | stop=0，continue=1 |
| `duplicateProbeRate` | number | 由当前最小 stop/continue 判定映射 | stop=1，continue=0 |
| `decision` | enum | adaptive reason 归并 | `continue` / `stop` |
| `stopReason` | string | decision 结果 | stop=`no_new_evidence`；continue=`not_stopped` |
| `evidence_gain_per_cycle` | number | 原生字段（与 decision 同源） | stop=0，continue=1 |

## 3) 与 p3-10 代理口径对照（原生化说明）

在 `p3-10` 中，`evidence_gain_per_cycle` 依赖代理公式：

- cycle 按同 `messageId` 下 `orchestrator.planned` 时间序切分；
- 每轮增益按 `retrieval.started.retrievalCacheKey` 首次出现数估算；
- `evidence_gain_per_cycle_proxy = sum(new_unique_keys on cycle>=2) / rerun_count_planned`。

本卡完成后：

1. `orchestrator.planned.data` 直接落盘 `evidence_gain_per_cycle`（原生字段）；
2. 同时补齐单调性判定字段 `coverageGain/newEvidenceCount/duplicateProbeRate/decision/stopReason/cycle`；
3. 下游复盘不再需要先做 proxy 推导才能得到每轮增益口径（仍可并行保留 proxy 做交叉校验）。

## 4) DoD 映射

- DoD-1：`progress-ledger/1.0` 结构已落盘，包含 `coverageGain/newEvidenceCount/duplicateProbeRate/decision`。
- DoD-2：`evidence_gain_per_cycle` 已原生写入 `orchestrator.planned.data`。
- DoD-3：每次 `planned` 事件输出 `messageId/cycle/decision/stopReason`，支持审计回放与“无增益停止”依据追踪。

## 5) 风险与回滚动作

- 风险1：当前最小实现采用 stop/continue 映射值，尚未引入 retrieval 粒度增益细分。
  - 回滚动作：仅保留字段写入（观测模式），下游不基于该值做自动断路。
- 风险2：若后续消费者将 `decision=stop` 直接绑定自动动作，可能误伤高难重跑场景。
  - 回滚动作：按执行卡要求回退到“仅观测不自动断路”。
- 风险3：message-cycle 计数基于进程内内存 map，跨进程不连续。
  - 回滚动作：消费者以 `messageId + ts` 做补充排序，避免把 cycle 连续性作为硬门禁。

## 6) 最小验收命令（A6）

> 说明：以下是本卡规定命令；实际退出码在 `progress-ledger-monotonicity-report.md` 的“验收结果”章节记录。

```bash
cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-p0-a8-progress-ledger/packages/opencode && bun run typecheck
cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-p0-a8-progress-ledger/packages/opencode && bun test test/session/orchestrator-turn.test.ts test/session/adaptive-ttc-policy.test.ts test/session/adaptive-ttc-breaker.test.ts --bail
test -s /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-p0-a8-progress-ledger/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p0-a8/progress-ledger-spec.md
test -s /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-p0-a8-progress-ledger/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p0-a8/progress-ledger-monotonicity-report.md
```
