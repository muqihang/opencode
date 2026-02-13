# P0-B2 Density / Rerank / V1-V2 Compat 报告

- Card: `CARD-BLK-06 / P0-B2`
- Branch: `codex/v16-p0-b2-evidence-bundle-v2`
- Workspace: `.worktrees/wt-v16-p0-b2-evidence-bundle-v2`
- Strategy: `TDD RED -> GREEN`

## 1) RED 证据

### 1.1 新增断言点

测试文件：
- `packages/opencode/test/retrieval/runner.test.ts`
- `packages/opencode/test/retrieval/e2e.test.ts`

覆盖目标：
- `EvidenceBundleV2` 字段存在且可解析
- `densityScore` 字段真实落盘到 `hits.json`/`evidence.bundle.v2.json`
- `compat` 对照字段可核验 `v1/v2`
- `rerank.fallback` 条件可判定

### 1.2 RED 命令与结果

命令：
```bash
cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-p0-b2-evidence-bundle-v2/packages/opencode \
  && bun test test/retrieval/code.test.ts test/retrieval/runner.test.ts test/retrieval/e2e.test.ts --bail
```

结果：
- `exit code: 1`
- 关键失败：`TypeError: undefined is not an object (evaluating 'run.evidencePointers.bundle.specVersion')`

## 2) GREEN 实现摘要

代码改动：
- 新增 schema：`packages/opencode/src/protocol/evidence-bundle.ts`
- 最小实现：`packages/opencode/src/retrieval/runner.ts`

实现要点：
- 新增 `EvidenceBundleV2` 与 `EvidenceBundleCompatV2` 结构并在 runner 中落盘
- `hits.json` 增加 `densityScore`
- 引入 `density_first` rerank 与 `score_only` 回退口径
- 输出 `evidencePointers.bundle / compat / rerank`

### 2.1 GREEN 命令与结果

命令：
```bash
cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-p0-b2-evidence-bundle-v2/packages/opencode \
  && bun test test/retrieval/code.test.ts test/retrieval/runner.test.ts test/retrieval/e2e.test.ts --bail
```

结果：
- `exit code: 0`
- `6 pass / 0 fail`

## 3) 字段映射（v1/v2 对照）

- `v1.topK` -> `evidencePointers.topK`
- `v2.topEvidence` -> `evidencePointers.bundle.topEvidence`
- `v1.summary.total` -> `evidencePointers.summary.total`
- `v2.summary.total` -> `evidencePointers.bundle.summary.total`
- `compat` 用于核验：`v1TopK/v2TopEvidence`、`v1Total/v2Total`、`densityMean`

## 4) 最小验收命令与 exit code

> 说明：以下为 A6 指定命令，exit code 在 A6 完成后回填。

1. `cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-p0-b2-evidence-bundle-v2/packages/opencode && bun run typecheck`
   - `exit code: 0`
2. `cd /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-p0-b2-evidence-bundle-v2/packages/opencode && bun test test/retrieval/code.test.ts test/retrieval/runner.test.ts test/retrieval/e2e.test.ts --bail`
   - `exit code: 0`
3. `test -s /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-p0-b2-evidence-bundle-v2/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p0-b2/evidence-bundle-v2-spec.md`
   - `exit code: 0`
4. `test -s /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-p0-b2-evidence-bundle-v2/docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p0-b2/density-rerank-compat-report.md`
   - `exit code: 0`

## 5) 风险与回滚动作

风险：
- rerank 新口径可能改变 topK 顺序，影响部分历史样本复现。
- 若输入 hit 结构异常，`score_only` 回退可能频繁触发。

回滚动作：
- 回退 runner 中 `topK` 计算到旧逻辑（按原 hits 顺序取前 5）。
- 保留 `evidence.bundle.v2.json` 仅作观测，不作为注入排序依据。
- 若稳定性下降，退回 `v1 summary/topK` 主口径并记录对账样本。
