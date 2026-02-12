# P3-8 / I.8 通用认知方案跨领域有效性补证（cross-domain）

- Date: 2026-02-12
- Scope: docs/csv only（不改 `packages/app/**`）
- Mode: local-only, fail-fast, no-push
- EvidencePath: `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-8/`

## 1) 验证目标与统一判定口径

目标：验证“通用认知方案”在至少 2 个外部业务领域上的稳健性，并给出 `继续沿用 / 收缩适用面` 的明确结论。

统一判定口径（对齐 `I.6 + I.7` 与 offline gate）：

1. 质量门禁（`offline-eval/1.0`）
   - `unsupportedClaimRate <= 0.05`
   - `unknownPrecision >= 0.85`
   - `citationIntegrity >= 0.95`
   - `keyClaimEvidenceIntegrity >= 1.0`
   - `cacheHitRatio >= 0.70`
   - `taskCompletion >= baseline - 0.03`
2. 运行稳定性门禁（沿用 `I.6`）
   - `cost/req <= +3%`
   - `p95 latency <= +8%`
   - `fallback rate <= +1.0pp`
3. 风险门禁（沿用 `I.7`）
   - `critic verdict` 仅作辅助信号，不作为单一硬门禁。

判定规则：

- 若跨域样本（>=2 领域）同时满足质量门禁 + 稳定性门禁，且无“硬门禁误判扩散”证据，可判为“继续沿用（条件）”。
- 若虽通过局部门禁，但缺乏更广外部 benchmark 复核，则必须“收缩适用面”，禁止外推为“通用最优”。

## 2) 跨域样本与数据来源

本轮使用已落盘离线评测工件，覆盖 2 个外部业务领域：

- 法律事实核验：`legal_facts_v1`
- 销售推理：`sales_reasoning_v1`

数据与工件：

- `packages/opencode/eval/suites/legal_facts_v1.json`
- `packages/opencode/eval/suites/sales_reasoning_v1.json`
- `packages/opencode/offline-eval-report.json`
- `packages/opencode/offline-eval-summary.md`

样本规模：

- 总任务数：`500`（`300 + 200`）
- 满足 nightly 最小样本门槛：`>=50`

## 3) 跨域结果（按统一口径）

### 3.1 领域内指标结果

| Suite | Domain | Tasks | unsupportedClaimRate | unknownPrecision | citationIntegrity | keyClaimEvidenceIntegrity | cacheHitRatio | taskCompletion | baseline | Gate |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `legal_facts_v1` | 法律 | 300 | 0.03 | 0.90 | 0.98 | 1.00 | 0.80 | 0.88 | 0.90 | pass |
| `sales_reasoning_v1` | 销售 | 200 | 0.04 | 0.875 | 0.96 | 1.00 | 0.72 | 0.86 | 0.88 | pass |

观测：

- 两个领域均通过 `offline-eval/1.0` 全量门禁。
- 两领域 `taskCompletion` 均为 `baseline - 0.02`，在允许回撤 `0.03` 内。

### 3.2 稳定性与 fail-fast 约束（I.6）

沿用 `I.6` 既有 canary：

- `cost/req = +2.0%`（阈值 `<= +3%`）
- `p95 latency = +4.3%`（阈值 `<= +8%`）
- `fallback rate = +0.60pp`（阈值 `<= +1.0pp`）

结论：运行稳定性门禁未越界。

### 3.3 风险代理信号（I.7）

`I.7` 已给出：`critic_status=completed` 与任务完成正相关，但当前仅可作为辅助门禁，不可单独硬门禁。

结论：跨域有效性判读可参考 verdict 方向，但不能把 verdict 当成唯一跨域充分证据。

## 4) 缺口与外推风险

尽管法律/销售两个领域在现有离线门禁下通过，但仍存在以下缺口：

1. 当前跨域样本主要来自仓库内套件，尚未完成公共 benchmark 的同口径回放；
2. `validated` 文档已明确“通用最优”属于证据不足命题，需 A/B 与 benchmark 补证；
3. `I.7` 的统计证据强度仍不足以支撑“跨领域通吃”的强结论。

## 5) 结论（I.8）

**判定：收缩适用面（Shrink）。**

执行口径：

1. `继续沿用` 仅限已验证领域切片：`legal_facts_v1`、`sales_reasoning_v1`；
2. 对“通用认知方案可跨任意领域稳定生效”的表述，降级为“工程假设”，禁止外推；
3. 新领域接入前，必须先在 `external-benchmark-manifest.md` 中登记并通过同口径门禁。

## 6) 扩面准入条件（下轮）

满足以下条件后，才可从“收缩适用面”升级为“继续沿用（扩面）”：

1. 至少新增 2 个公共 benchmark 领域并完成同口径离线回放；
2. 各领域样本数 `>=50`（建议 `>=100`）且门禁全绿；
3. 连续 2 个采样周期稳定性护栏不越界（`cost/req`、`p95`、`fallback`）；
4. `critic verdict` 仍仅作为辅助信号，直到统计证据达到可升级门槛。

## 7) 证据索引

- `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-6/dual-retrieval-recall-cost-report.md`
- `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-7/critic-verdict-completion-regression.md`
- `docs/plans/evidence/2026-02-10-v1_6-blocking/p3-wave-plan-2026-02-12.md`
- `docs/plans/2026-02-10-general-cognitive-architecture-and-llm-weaknesses-validated.md`
- `packages/opencode/src/eval/offline-gate.ts`
- `packages/opencode/eval/suites/legal_facts_v1.json`
- `packages/opencode/eval/suites/sales_reasoning_v1.json`
- `packages/opencode/offline-eval-report.json`
- `packages/opencode/offline-eval-summary.md`
