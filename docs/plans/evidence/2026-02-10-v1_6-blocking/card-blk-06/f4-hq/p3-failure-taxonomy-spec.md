# P3 Failure Taxonomy Spec（orchestrator.degraded）

## 1. 背景与目标

在 v1.6 的 P3 阶段，`orchestrator.degraded` 原先主要依赖 `reason` 字符串用于诊断。该口径可读但难以稳定回放。

本次新增统一结构化字段（保持 `reason` 向后兼容）：

- `reason_codes: string[]`
- `failure_class: string`
- `failure_code: string`
- `fallback_from: string`
- `fallback_to: string`
- `fallback_edge: string`
- `retryable: boolean`

## 2. 旧口径到新口径映射

| 旧口径（兼容保留） | 新口径（新增） | 说明 |
| --- | --- | --- |
| `reason: "adaptive.ttc.degrade_2_to_1,adaptive.ttc.breaker.active,adaptive.ttc.fallback.unknown_first"` | `reason_codes: ["adaptive.ttc.degrade_2_to_1","adaptive.ttc.breaker.active","adaptive.ttc.fallback.unknown_first"]` | 从原始 reason 拆分、去重并数组化 |
| `reason: "fallback=unknown-first; worker status degraded"` | `reason_codes: ["fallback.unknown_first","worker_status_degraded"]` | 分号分段 + 规范化 |
| `reason: "planner_degraded_fallback"` | `failure_class: "planner", failure_code: "planner_degraded_fallback"` | stage 驱动分类，code 继承首个 reason code |
| （无 DAG 字段） | `fallback_from/fallback_to/fallback_edge` | 直接编码 fallback DAG 边 |
| （无重试语义） | `retryable` | stage + reason 归一化后的重试判定 |

## 3. 归一化规则

### 3.1 reason_codes

1. 优先提取 `adaptive.ttc.*` 代码。
2. 若无 `adaptive.ttc.*`，按 `,`/`;` 分段。
3. 分段值标准化：小写、去空白、去重、`unknown-first -> unknown_first`。
4. 若仍为空，回退为 stage 派生 code（保证非空）。

### 3.2 failure_class / failure_code / retryable（按 stage）

| stage | failure_class | failure_code 规则 | retryable 规则 |
| --- | --- | --- | --- |
| `adaptive_ttc` / `adaptive_ttc_breaker` | `adaptive_ttc` | breaker code 优先，其次 stop code，再取首个 code | 命中 stop 集合则 `false`，否则 `true` |
| `dual_pass` | `dual_pass` | 首个 `reason_codes`，空则 `dual_pass_degraded` | `true` |
| `planner` | `planner` | 首个 `reason_codes`，空则 `planner_degraded_fallback` | `true` |
| `plan` | `plan` | 首个 `reason_codes`，空则 `plan_error` | `true` |
| `turn` | `turn` | 首个 `reason_codes`，空则 `turn_error` | `true` |
| `fork_task` | `fork_task` | 首个 `reason_codes`，空则 `fork_task_error` | `true` |
| 其它 | `stage` 规范化结果 | 首个 `reason_codes`，空则 `<stage>_degraded` | `true` |

其中 `adaptive_ttc` 的 stop 集合：

- `adaptive.ttc.early_stop`
- `adaptive.ttc.degrade_3_to_2`
- `adaptive.ttc.degrade_2_to_1`
- `adaptive.ttc.max_rerun.stop`
- `adaptive.ttc.breaker.active`
- `adaptive.ttc.breaker.trip`

### 3.3 fallback DAG 字段

| stage | fallback_from | fallback_to | fallback_edge |
| --- | --- | --- | --- |
| `adaptive_ttc`（breaker/unknown_first） | `adaptive_ttc_breaker` | `dual_pass_unknown_first` | `stop` |
| `adaptive_ttc`（非 stop） | `adaptive_ttc` | `dual_pass_draft` | `continue` |
| `dual_pass` | `dual_pass_critic` | 根据 `fallback=` 解析（如 `dual_pass_unknown_first` / `dual_pass_draft`） | `degrade` |
| `planner` | `planner` | `dual_pass_unknown_first` | `fallback` |
| `plan` | `plan_builder` | `orchestrator_bypass` | `error` |
| `turn` | `orchestrator_turn` | `pass_through` | `error` |
| `fork_task` | `fork_task` | `fork_notice_skip` | `error` |

## 4. 写入点覆盖范围

本卡仅覆盖以下 `orchestrator.degraded` 写入点，并统一注入结构化字段：

- `packages/opencode/src/session/orchestrator/writer.ts`
- `packages/opencode/src/session/orchestrator/index.ts`
- `packages/opencode/src/session/processor.ts`

## 5. 向后兼容

- 保留原有 `reason` 字段，不改变业务决策语义。
- 新增字段仅用于结构化观测、回放和诊断。
