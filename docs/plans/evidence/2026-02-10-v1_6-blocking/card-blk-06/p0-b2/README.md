# CARD-BLK-06 / P0-B2 执行卡（F4 / V1-V2 Bridge）

- Owner: `Exec-AI-RETRIEVAL` + 证据包负责人（待实名）
- 当前状态: `todo`
- 任务目标: 固化 `EvidenceBundleV2`（含 density）并打通 rerank 口径
- 是否仅补证/可能需要最小实现: `需要最小实现`
- EvidencePath: `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p0-b2/`

## DoD

1. 输出结构化 `EvidenceBundleV2`，包含 snippet/density 与来源字段。
2. 提供 v1/v2 对照统计：token 成本、证据密度、可判定率。
3. 明确 rerank 规则与回退条件。

## 依赖关系

- 依赖 `P0-B1` schema 稳定。

## RollbackAction

- 若 token 成本或密度收益不达标，回退旧注入路径。

## 验收命令

```bash
bun --cwd packages/opencode run typecheck \
  && bun --cwd packages/opencode test test/retrieval/code.test.ts test/retrieval/runner.test.ts test/retrieval/e2e.test.ts --bail
```
