# CARD-BLK-06 / P2-2 执行卡

- Owner: TBD
- 当前状态: todo
- ETA: Wave-2（在 `P2-1` 完成后，与 `P2-4` 并行）
- EvidencePath: /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p2-2/

## DoD

1. 产出 `hybrid-routing-policy.md`，明确路由输入、决策规则、失败回退路径。
2. 产出 `routing-ab-report.md`，给出 LC/RAG 对照结果（质量、成本、延迟）。
3. 形成“主链优先 + 补偿链兜底”一致策略，不引入同轮双主链竞争。

## 依赖关系

- 依赖 `P2-1` freshness metadata 可用。

## 并行性判断

- 可与 `P2-4` 并行推进；不可与 `P2-3` 并行签收。

## RollbackAction

- 路由强制回退为 orchestrator 主链，LC 仅保留诊断模式。

## 验收命令

```bash
test -s docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p2-2/hybrid-routing-policy.md \
  && test -s docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p2-2/routing-ab-report.md \
  && bun --cwd packages/opencode test test/session/llm.test.ts test/session/orchestrator-tool-broker.test.ts test/retrieval/e2e.test.ts
```

