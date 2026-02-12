# CARD-BLK-06 / P3-6 双检索链收敛召回/成本补证报告（I.6，fail-fast）

- 日期：2026-02-12
- 任务：`P3-6-CONVERGENCE-01`
- 范围：docs-only（未改 `packages/app/**`，未做路由实现变更）
- 结论摘要：当前证据支持继续维持“单主链优先 + 受控补偿链”收敛策略；`I.7` 可条件进入，`I.10` 需等待 `I.7` 产物后再进入。

## 1) 取证口径（先声明边界）

本轮未新增线上 AB 流量实验，采用“代码契约 + 既有 canary + 既有离线标注”三源补证。

- 召回代理信号：
  1. 补偿链触发边界是否正确（该触发时触发，不该触发时抑制）。
  2. retrieval 输出 `topK` 指针是否可消费（citation-check 可通过）。
  3. 既有 `I.2` 的 topK 正文占比结果（识别召回质量外生风险）。
- 成本/延迟代理信号：
  1. 补偿链调用次数差异（strict vs balanced）。
  2. 既有 canary 对成本/延迟/fallback 护栏是否越界。
  3. fail-fast 机制（bounce、timeout、degraded）是否可阻断失控扩散。

## 2) 证据清单与观测结果

### 2.1 路由边界与收敛语义

1) 策略默认与回退

- 默认策略是 `compensationGate=balanced`，非法配置回退到 `fallback + strict + orchestrator_main`。
- 证据：
  - `packages/opencode/src/session/hybrid-routing-policy.ts:69`
  - `packages/opencode/src/session/hybrid-routing-policy.ts:75`
  - `packages/opencode/src/session/hybrid-routing-policy.ts:83`

2) 触发判定（是否运行补偿链）

- `off`：直接关闭补偿链。
- 主链缺失/未启用/降级：允许补偿链。
- 主链健康且可覆盖 retrieval：抑制补偿链。
- 主链健康但不覆盖 retrieval：仅 `balanced` 触发，`strict` 不触发。
- 证据：
  - `packages/opencode/src/session/hybrid-routing-policy.ts:131`
  - `packages/opencode/src/session/hybrid-routing-policy.ts:136`
  - `packages/opencode/src/session/hybrid-routing-policy.ts:143`
  - `packages/opencode/src/session/hybrid-routing-policy.ts:144`

3) LLM 执行入口确实遵守该判定

- `LLM.runCompensationRetrieval()` 在执行前调用 `shouldRunCompensationRetrieval()`，未命中即直接返回。
- 证据：
  - `packages/opencode/src/session/llm.ts:92`
  - `packages/opencode/src/session/llm.ts:101`
  - `packages/opencode/src/session/llm.ts:111`

4) 单测覆盖收敛语义

- `assist + coversRetrieval + balanced`：补偿链不触发（0 次）。
- `degraded + balanced`：补偿链触发（1 次）。
- `chat + strict + not covers`：补偿链不触发（0 次）。
- `chat + balanced + not covers`：补偿链触发（1 次）。
- `off` 即使降级也不触发。
- 证据：
  - `packages/opencode/test/session/llm.test.ts:93`
  - `packages/opencode/test/session/llm.test.ts:122`
  - `packages/opencode/test/session/llm.test.ts:150`
  - `packages/opencode/test/session/llm.test.ts:178`
  - `packages/opencode/test/session/llm.test.ts:206`

### 2.2 召回侧补证（代理）

1) retrieval 结果可消费性

- e2e 验证 `topK.length > 0` 且 pointer 可通过 `citation-check.py`。
- 证据：
  - `packages/opencode/test/retrieval/e2e.test.ts:26`
  - `packages/opencode/test/retrieval/e2e.test.ts:45`
  - `packages/opencode/test/retrieval/e2e.test.ts:67`

2) 召回质量外生风险（非 I.6 新引入）

- `I.2` 样本显示 `top5 snippet_valid = 0.0%`、`path_noise = 100.0%`，问题集中在检索命中质量（tree 通道噪声），不是路由语义错误本身。
- 证据：
  - `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-2/topk-noise-breakdown.md:21`
  - `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-2/topk-noise-breakdown.md:54`
  - `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-2/topk-noise-breakdown.md:55`

### 2.3 成本/延迟与 fail-fast 收敛补证

1) 成本代理：补偿调用次数可控

- 既有 `P2-2` A/B 结论：
  - strict：调用 `0`
  - balanced：调用 `1`
  - off：调用 `0`
- 证据：
  - `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p2-2/routing-ab-report.md:42`
  - `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p2-2/routing-ab-report.md:46`
  - `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p2-2/routing-ab-report.md:47`
  - `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p2-2/routing-ab-report.md:48`

2) 运行预算硬边界存在

- retrieval 内置预算：`maxHits=40`、`topK=20`、`maxWallClockMs=8000`。
- 触发后会打 `retrieval.timeout/retrieval.degraded/retrieval.cancelled` 事件，便于 fail-fast 观测。
- 证据：
  - `packages/opencode/src/retrieval/runner.ts:263`
  - `packages/opencode/src/retrieval/runner.ts:345`
  - `packages/opencode/src/retrieval/runner.ts:717`
  - `packages/opencode/src/retrieval/runner.ts:719`
  - `packages/opencode/src/retrieval/runner.ts:730`

3) Orchestrator 层防抖闸门存在

- `bounceMax` 超限直接拒绝（`bounce_limit_v1`），`policy.allowed` 不匹配直接拒绝（`policy_kind_not_allowed_v1`）。
- 对应测试已覆盖两条拒绝路径。
- 证据：
  - `packages/opencode/src/session/orchestrator/tool-broker.ts:155`
  - `packages/opencode/src/session/orchestrator/tool-broker.ts:160`
  - `packages/opencode/src/session/orchestrator/tool-broker.ts:240`
  - `packages/opencode/src/session/orchestrator/tool-broker.ts:244`
  - `packages/opencode/test/session/orchestrator-tool-broker-policy.test.ts:6`
  - `packages/opencode/test/session/orchestrator-tool-broker-policy.test.ts:28`

4) 既有 canary 未显示成本失控

- `cost/req`：`+2.0%`（护栏 `<= +3%`）
- `p95 latency`：`+4.3%`（护栏 `<= +8%`）
- `fallback rate`：`+0.60pp`（护栏 `<= +1.0pp`）
- 证据：
  - `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p2-3/auto-tuning-canary-report.md:22`
  - `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p2-3/auto-tuning-canary-report.md:24`
  - `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p2-3/auto-tuning-canary-report.md:26`
  - `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p2-3/auto-tuning-runbook.md:39`
  - `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p2-3/auto-tuning-runbook.md:50`
  - `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p2-3/auto-tuning-runbook.md:52`

5) 重复 planned 风险与收敛关系

- `I.3` 显示重复 planned 的首因 `budget_rebound=100%`，说明必须保留 fail-fast 闸门，避免预算/降级路径回跳扩散。
- 证据：
  - `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-3/planned-repeat-root-cause.md:11`
  - `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-3/planned-repeat-root-cause.md:14`
  - `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-3/planned-repeat-root-cause.md:68`

## 3) 综合判读（I.6）

### 3.1 对“召回下降”的判读

- 现有证据未显示“由收敛策略导致的新增召回崩塌”。
- 当前召回主风险来自 `I.2` 已暴露的检索命中质量问题（top5 正文占比 0%），属于检索质量债，不是路由边界缺失。
- 因此 `I.6` 当前重点应是：保留受控补偿链 + fail-fast 防扩散，而非回到“无约束双主链”。

### 3.2 对“成本失控”的判读

- 调用次数、预算上限、bounce 限制、canary 护栏都显示成本可控（至少未越既有红线）。
- 现阶段不存在“必须立刻回退单主链”的硬证据。

## 4) 可执行结论（P3-6 输出）

1. **收敛策略结论：继续保持当前策略（Conditional Keep）**

- 保持 `main_first + balanced(default)`，保留 `fallback => strict + orchestrator_main`。
- 保持 fail-fast：`bounceMax` 拒绝、policy 白名单拒绝、retrieval timeout/degraded 事件持续观测。

2. **进入后续波次结论**

- `I.7`：**可进入（Conditional Go）**。
  - 依据：`I.7` 依赖 `I.6` 稳定后采样；当前可证明路由边界稳定、成本未失控。
  - 依赖锚点：`docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-7/README.md:17`
- `I.10`：**当前不直接进入（Hold）**，待 `I.7` 完成后进入。
  - 依据：`I.10` 明确依赖 `I.7` 结论。
  - 依赖锚点：`docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p3-10/README.md:17`

3. **回退触发条件（沿用既有口径）**

- 连续 2 个采样周期出现下列任一护栏超限，执行“回退单主链策略 + 冻结建议参数”：
  - `cost/req > +3%`
  - `p95 latency > +8%`
  - `fallback rate > +1.0pp`
- 口径锚点：
  - `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p2-3/auto-tuning-runbook.md:39`
  - `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p2-3/auto-tuning-runbook.md:50`
  - `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p2-3/auto-tuning-runbook.md:52`
  - `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/p2-3/auto-tuning-runbook.md:57`

## 5) 缺口与下一步（fail-fast）

- 缺口：尚无“同口径线上 recall@task”对照样本，本轮仅能给出工程代理结论。
- 下一步：进入 `I.7` 采样时同步记录 “主链覆盖率/补偿触发率/retrieval.timeout|degraded 比例”，以便 `I.10` 做阈值鲁棒性评估。

## 6) Need-Decision

- 无（按现有依赖链执行即可：`I.6 -> I.7 -> I.10`）。
