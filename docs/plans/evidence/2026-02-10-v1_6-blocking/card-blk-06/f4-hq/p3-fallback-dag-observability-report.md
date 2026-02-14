# P3 Fallback DAG Observability Report

## 1. 变更摘要

本次在 `orchestrator.degraded` 事件增加结构化 taxonomy + fallback DAG 字段，实现“从事件反推失败路径”的稳定能力。

新增字段：

- `reason_codes`
- `failure_class`
- `failure_code`
- `fallback_from`
- `fallback_to`
- `fallback_edge`
- `retryable`

## 2. 回放方法（从事件恢复失败路径）

给定一条 `orchestrator.degraded` 事件，回放规则：

1. 读取 `stage` 和 `reason`（兼容老口径）。
2. 优先使用 `reason_codes` 作为机器可读诊断键。
3. 用 `failure_class/failure_code` 锚定故障类别。
4. 使用 `fallback_from -> fallback_to (edge=fallback_edge)` 还原 DAG 边。
5. 用 `retryable` 判断是否可以自动重试，还是进入人工/保守路径。

## 3. 回放示例

### 示例 A：adaptive_ttc breaker 停机路径

事件关键字段：

- `stage = adaptive_ttc`
- `reason_codes = ["adaptive.ttc.degrade_2_to_1", "adaptive.ttc.breaker.active", "adaptive.ttc.fallback.unknown_first"]`
- `failure_class = adaptive_ttc`
- `failure_code = adaptive.ttc.breaker.active`
- `fallback_from = adaptive_ttc_breaker`
- `fallback_to = dual_pass_unknown_first`
- `fallback_edge = stop`
- `retryable = false`

回放结论：

- 该失败属于 breaker stop，路径为：
  `adaptive_ttc_breaker -> dual_pass_unknown_first (stop)`
- 因 `retryable=false`，不应继续自动重试。

### 示例 B：dual_pass critic 降级路径

事件关键字段：

- `stage = dual_pass`
- `reason = "fallback=unknown-first; worker status degraded"`
- `reason_codes = ["fallback.unknown_first", "worker_status_degraded"]`
- `failure_class = dual_pass`
- `fallback_from = dual_pass_critic`
- `fallback_to = dual_pass_unknown_first`
- `fallback_edge = degrade`
- `retryable = true`

回放结论：

- 该失败不是硬 stop，而是 critic 降级：
  `dual_pass_critic -> dual_pass_unknown_first (degrade)`
- 可按策略继续重试或上抛至上层调度。

## 4. 验证证据

本卡测试覆盖要点：

- `adaptive-ttc-breaker.test.ts`：验证 degraded 事件必含结构化字段。
- `orchestrator-turn.test.ts`：验证 dual_pass degraded 事件结构化字段。
- `orchestrator-degraded-taxonomy.test.ts`：验证
  - adaptive breaker DAG 还原
  - reason 拆分去重
  - stage 级 failure/retryable 规则稳定。

## 5. 结论

`orchestrator.degraded` 已从“单字符串 reason”升级为“兼容 reason + 结构化 taxonomy + fallback DAG”双口径。

该改动不改变原有业务决策，仅增强观测、回放和诊断能力。
