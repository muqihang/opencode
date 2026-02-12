# CARD-BLK-06 / P0-B4 执行卡（F4 / V2）

- Owner: `Exec-AI-ORCH` + 收敛治理负责人（待实名）
- 当前状态: `todo`
- 任务目标: 完成 message 级重跑收敛（幂等键 + maxRerun + 自动断路）
- 是否仅补证/可能需要最小实现: `需要最小实现`
- EvidencePath: `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p0-b4/`

## DoD

1. message 级幂等键与 maxRerun 生效且可审计。
2. 断路决策和 fallback 路径可复现。
3. 输出误伤评估并给出回滚阈值。

## 依赖关系

- 依赖 `P0-B3` 注入稳定及 `P0-A8` 单调性字段。

## RollbackAction

- 若误伤召回或完成率，撤回参数收紧并回退到保守策略。

## 验收命令

```bash
bun --cwd packages/opencode run typecheck \
  && bun --cwd packages/opencode test test/session/adaptive-ttc-breaker.test.ts test/session/adaptive-ttc-policy.test.ts test/session/adaptive-ttc-budget.test.ts --bail
```
