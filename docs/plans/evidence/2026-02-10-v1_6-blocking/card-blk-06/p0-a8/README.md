# CARD-BLK-06 / P0-A8 执行卡（F4 / V1）

- Owner: `Exec-AI-ORCH` + orchestrator 负责人（待实名）
- 当前状态: `todo`
- 任务目标: 落地 `progress-ledger/1.0` 与单调性判定字段
- 是否仅补证/可能需要最小实现: `需要最小实现`
- EvidencePath: `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p0-a8/`

## DoD

1. 产出 `progress-ledger/1.0` 结构，至少含 `coverageGain/newEvidenceCount/duplicateProbeRate/decision`。
2. 将 `evidence_gain_per_cycle` 从代理口径升级为原生落盘字段。
3. 输出 message-cycle 级继续/停止决策依据，支持审计回放。

## 依赖关系

- 依赖 `P0-A6/P0-A7` 事件链基础。

## RollbackAction

- 若单调性判定误伤任务成功率，回退到仅观测不自动断路模式。

## 验收命令

```bash
bun --cwd packages/opencode run typecheck \
  && bun --cwd packages/opencode test test/session/orchestrator-turn.test.ts test/session/adaptive-ttc-policy.test.ts test/session/adaptive-ttc-breaker.test.ts --bail
```
