# CARD-BLK-06 / P0-B1 执行卡（F4 / V1-V2 Bridge）

- Owner: `Exec-AI-WORKER` + 协议负责人（待实名）
- 当前状态: `todo`
- 任务目标: 固化 `ToolRequestV2 + CriticVerdictV2` schema 与 fixture
- 是否仅补证/可能需要最小实现: `需要最小实现`
- EvidencePath: `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p0-b1/`

## DoD

1. schema 可解析并通过 fixture round-trip。
2. v1/v2 兼容路径明确，失败时有稳定降级行为。
3. 输出协议字段映射说明与迁移风险清单。

## 依赖关系

- 无硬依赖；作为 `P0-B2/P0-B3/P0-B5` 前置。

## RollbackAction

- 若 v2 解析失败率高，维持 v1 主路径并冻结切流。

## 验收命令

```bash
bun --cwd packages/opencode run typecheck \
  && bun --cwd packages/opencode test test/session/orchestrator-tool-broker.test.ts test/session/orchestrator-evidence-critic.test.ts --bail
```
