# P0-B2 EvidenceBundleV2 字段规范（含 density）

- Card: `CARD-BLK-06 / P0-B2`
- Scope: `F4 / V1-V2 Bridge`
- Strategy: `fail-fast + local-only + no-push + TDD`

## 1) 字段定义与来源

实现文件：
- `packages/opencode/src/protocol/evidence-bundle.ts`
- `packages/opencode/src/retrieval/runner.ts`

### 1.1 `evidence-bundle/2.0`

结构：
- `specVersion: "evidence-bundle/2.0"`
- `retrievalId: string`
- `summary: { total, code, workbench }`
- `hits: Array<HitV2>`
- `topEvidence: string[]`（E1..E5）
- `dedupe: { method, report }`
- `rerank: { mode, fallback }`

`HitV2` 字段来源：
- `id`: `runner` 在 hits 序列上的稳定编号（`E${index+1}`）
- `pointer`: 来自 `pointerFromHit(...)`，保留 `path + sha256 + anchor`
- `origin`: 来自 hit 原始 `origin`（代码检索与 workbench 检索）
- `snippet`: 优先读取 `.../snippets/*.txt`，失败时降级为 origin/path 信息
- `source`: `lsp|rg|workbench|tree`
- `score_bps`: 命中分数（无值时回退 `0`）
- `densityScore`: 
  - 优先读取已有 `hit.densityScore`
  - 否则按来源推导：`lsp=0.95`、`rg=0.9`、`workbench=0.8`、`tree=0.25`

### 1.2 rerank 口径与回退条件

- 常规模式：`mode = "density_first"`
  - 先按 `densityScore` 降序，再按 `score_bps` 降序
- 回退模式：`mode = "score_only"`
  - 当任一 hit 缺失可判定 density（或 hit 结构不完整）时触发
- 固定回退条件字段：
  - `fallback.condition = "density_missing_or_invalid"`
  - `fallback.triggered: boolean`
  - `fallback.reason: string`

### 1.3 v1/v2 对照字段

`evidencePointers.compat`：
- `v1TopK`: v1 pointers 口径 `topK.length`
- `v2TopEvidence`: v2 口径 `topEvidence.length`
- `v1Total`: v1 口径 `summary.total`
- `v2Total`: v2 口径 `bundle.summary.total`
- `densityMean`: v2 hits 平均 density
- `densityPass`: `densityScore >= densityThreshold` 的命中数
- `densityThreshold`: 当前固定 `0.8`

## 2) 落盘路径

- `retrieval/<retrievalId>/hits.json`（已包含 `densityScore`）
- `retrieval/<retrievalId>/dedupe.report.json`
- `retrieval/<retrievalId>/evidence.bundle.v2.json`
- `retrieval/<retrievalId>/probe.journal.json`

## 3) RED -> GREEN 证据

- RED 触发点：新增断言访问 `run.evidencePointers.bundle`、`run.artifacts.bundle` 与 `densityScore`；实现前应失败。
- GREEN 收敛点：
  - `EvidenceBundleV2` schema 可解析
  - `hits.json` 持久化存在 `densityScore`
  - `compat` 可核验 v1/v2 对照字段
  - `rerank.fallback` 条件可判定

## 4) 最小验收命令与 exit code

> 说明：本节命令与 exit code 在 A6 运行后补齐。

- `cd packages/opencode && bun run typecheck` -> `exit code: 0`
- `cd packages/opencode && bun test test/retrieval/code.test.ts test/retrieval/runner.test.ts test/retrieval/e2e.test.ts --bail` -> `exit code: 0`

## 5) 风险与回滚动作

风险：
- `density` 规则偏置导致排序变化，可能影响历史样本稳定性。
- `score_only` 回退触发比例异常时，收益会被削弱。

回滚动作：
- 回退到旧 topK 口径（按原 hits 顺序）并关闭 v2 bundle 注入。
- 保留 `hits.json` 与 `probe.journal`，用于离线复盘 rerank 差异。
- 维持 `tool-broker` 与 `context-pack` 走 v1 summary/topK 主路径。
