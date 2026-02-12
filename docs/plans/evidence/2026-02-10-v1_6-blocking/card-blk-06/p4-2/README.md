# CARD-BLK-06 / P4-2 执行卡（I.11 deferred 治理）

- Owner: `Exec-AI-PMO` + 架构总控（待实名）
- 当前状态: `todo`
- 任务属性: `deferred 治理卡`
- 任务目标: 补齐 `I.11` deferred 决议与启动门禁，仅治理不实现
- EvidencePath: `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p4-2/`

## DoD

1. deferred 决议完整（范围、边界、触发条件、责任人）。
2. 启动前置条件完整（进入实现前 Gate/Checklist）。
3. 资源口径与回滚口径完整（人力/窗口/风险回退）。

## 证据产物

- `i11-deferred-decision.md`
- `i11-start-gate-checklist.md`

## 约束声明

- 本波次不做 `I.11` 代码实现。

## RollbackAction

- 若治理项不完整，维持 `I.11 deferred` 状态并禁止转入实现。

## 验收命令

```bash
test -s docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p4-2/i11-deferred-decision.md \
  && test -s docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p4-2/i11-start-gate-checklist.md
```
