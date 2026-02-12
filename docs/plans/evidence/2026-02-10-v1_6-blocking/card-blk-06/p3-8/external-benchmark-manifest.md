# P3-8 / I.8 外部基准清单（external benchmark manifest）

- Date: 2026-02-12
- Scope: docs-only（不改 `packages/app/**`）
- Mode: local-only, fail-fast, no-push
- Spec: `offline-eval/1.0`（对齐现有 gate）

## 1) 目的

为“通用认知方案跨领域有效性”建立可追溯 benchmark 清单，统一记录：

1. 任务集来源（source）
2. 版本/快照（version）
3. 采样口径（sampling）
4. 与发布门禁指标映射（gate mapping）

## 2) 纳入与排除规则

纳入规则：

1. 能映射到 `offline-eval/1.0` 指标（claim/citation/cache/taskCompletion）。
2. 可固定版本或快照日期，支持复跑。
3. 领域覆盖满足“至少 2 个外部领域”或“至少 2 类外部能力维度”。

排除规则：

1. 无法追溯版本或来源；
2. 无法转换为结构化评测结果；
3. 仅含主观评语、无可核验标签。

## 3) Benchmark Manifest

| id | domain | source | version_or_snapshot | sampling_policy | gate_mapping | status |
| --- | --- | --- | --- | --- | --- | --- |
| `legal_facts_v1` | 法律（外部业务领域） | `packages/opencode/eval/suites/legal_facts_v1.json` | `offline-eval/1.0`（本地快照，access: 2026-02-12） | 全量 300 tasks；后续扩面时按“风险子类分层抽样”补齐 | 全量映射：unsupported/unknown/citation/key-claim/cache/taskCompletion | active |
| `sales_reasoning_v1` | 销售（外部业务领域） | `packages/opencode/eval/suites/sales_reasoning_v1.json` | `offline-eval/1.0`（本地快照，access: 2026-02-12） | 全量 200 tasks；后续扩面时按“场景（询盘/竞品/风险披露）分层抽样”补齐 | 全量映射：unsupported/unknown/citation/key-claim/cache/taskCompletion | active |
| `crag_retrieval_v1` | 检索鲁棒性（外部能力域） | https://arxiv.org/abs/2406.04744 | 论文版本：v2（2024-11-01），access: 2026-02-10 | 每轮抽样 >=50，按动态事实/长尾事实分层；保留固定随机种子 | 主映射：citationIntegrity、unsupportedClaimRate、taskCompletion | planned |
| `ruler_long_context_v1` | 长上下文定位（外部能力域） | https://arxiv.org/abs/2404.06654 | 论文版本：v3（2024-08-06），access: 2026-02-10 | 每轮抽样 >=50，按上下文长度桶（短/中/长）分层 | 主映射：taskCompletion、citationIntegrity | planned |
| `helm_multimetric_v1` | 多维评测基线（外部能力域） | https://arxiv.org/abs/2211.09110 | 论文版本：v2（2023-10-01），access: 2026-02-10 | 先选与当前产品相关子任务，保证每子任务 >=50 | 主映射：taskCompletion、unsupportedClaimRate；辅映射：unknownPrecision | planned |
| `openai_evals_harness_v1` | 评测执行框架（外部工具域） | https://github.com/openai/evals | repo snapshot（access: 2026-02-10） | 仅作为执行与复现框架，不直接提供分数；与上方任务集组合使用 | 框架映射：样本一致性、可复跑性、报告结构一致性 | planned |

## 4) 采样与复跑约束（统一）

1. 最小样本：每个新增基准集 `>=50`（建议 `>=100`）。
2. 分层采样：按领域风险切片做 strata，不做纯随机单桶采样。
3. 固定种子：同一轮评估固定随机种子，复跑仅允许替换模型版本。
4. 版本冻结：每轮报告必须写明 benchmark 版本与访问日期。
5. 失败优先：优先纳入历史误判高发切片，避免“只跑容易样本”。

## 5) 当前可执行结论

1. 已激活跨域集合为 `legal_facts_v1 + sales_reasoning_v1`，满足 I.8“至少 2 领域”最低要求。
2. 外部公共 benchmark（CRAG/RULER/HELM）已入 manifest，但当前状态为 `planned`，尚未形成同口径离线回放结果。
3. 在 `planned` 条目转 `active` 之前，不得将“通用认知方案”外推为跨任意领域稳定有效。

## 6) 升级条件（planned -> active）

每个 planned 条目升级为 active 需同时满足：

1. 产出同口径离线报告（包含六项 gate 指标）；
2. 当轮样本数达标（>=50）；
3. 至少一次复跑结果方向一致；
4. 在 `cross-domain-general-cognition-validation.md` 中追加结论并更新适用面判定。

## 7) 关联证据

- `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-8/cross-domain-general-cognition-validation.md`
- `docs/plans/2026-02-10-general-cognitive-architecture-and-llm-weaknesses-validated.md`
- `packages/opencode/eval/suites/legal_facts_v1.json`
- `packages/opencode/eval/suites/sales_reasoning_v1.json`
- `packages/opencode/offline-eval-report.json`
