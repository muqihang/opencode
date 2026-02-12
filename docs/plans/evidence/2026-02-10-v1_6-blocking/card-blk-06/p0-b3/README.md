# CARD-BLK-06 / P0-B3 执行卡（F4 / V1-V2 Bridge）

- Owner: `Exec-AI-ORCH` + 提示注入负责人（待实名）
- 当前状态: `todo`
- 任务目标: 固化 `orchestrator_evidence_v2` 注入模板与预算约束
- 是否仅补证/可能需要最小实现: `需要最小实现`
- EvidencePath: `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p0-b3/`

## DoD

1. 注入模板最少包含 3 条可核验证据摘要。
2. 预算裁剪规则可执行，超预算时稳定降级。
3. 保证不破坏 secure-output 语义与引用一致性。

## 依赖关系

- 依赖 `P0-B1/P0-B2` 完成。

## RollbackAction

- 若注入预算失控或质量下降，回退 v1 注入模板。

## 验收命令

```bash
bun --cwd packages/opencode run typecheck \
  && bun --cwd packages/opencode test test/session/llm.test.ts test/session/orchestrator-integration-v2.test.ts --bail
```
