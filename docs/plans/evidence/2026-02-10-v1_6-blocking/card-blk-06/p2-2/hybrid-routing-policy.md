# P2-2 Hybrid Routing Policy（LC/RAG）

- 日期：2026-02-12
- 卡片：`CARD-BLK-06 / P2-2`
- Owner：`P2-2-HYBRID-ROUTING-01`
- 状态：最小可验收（MVP）已实现

## 1) 目标与约束

本实现仅完成 `P2-2` 最小可验收：

1. 增加显式、可配置的 LC/RAG 混合路由策略（不依赖隐式字符串匹配）。
2. 在策略失效或非法时，强制回退到 `orchestrator_main`。
3. 维持“主链优先 + 补偿链兜底”，不引入双主链竞争。

## 2) 显式策略契约

策略对象定义为 `hybrid-routing-policy/1.0`：

- `strategy`: `main_first`（当前仅允许该值）
- `compensationGate`: `strict | balanced | off`
- `rollback`: `orchestrator_main`（当前仅允许该值）
- `source`: `default | config | env | fallback`

实现位置：

- `packages/opencode/src/session/hybrid-routing-policy.ts`

## 3) 路由判定规则（MVP）

### 3.1 主链判定输入

`LLM.runCompensationRetrieval()` 接收 `retrievalRoute.main`：

- `source: "orchestrator"`
- `enabled: boolean`
- `mode: OrchestratorMode`
- `coversRetrieval?: boolean`
- `degraded: boolean`

### 3.2 触发补偿链规则

由 `shouldRunCompensationByPolicy()` 决策：

- `gate=off`：补偿链永不触发。
- `gate=strict`：仅在主链不可用时触发（未启用/降级/无主链）。
- `gate=balanced`：除 strict 条件外，当主链“健康但本轮不覆盖 retrieval”时也触发。

### 3.3 回退规则

`resolveHybridRoutingPolicy()` 对配置做显式解析：

- env 优先于 config。
- 任一字段非法（strategy/gate/rollback）=> `source=fallback`。
- fallback 固定：
  - `strategy=main_first`
  - `compensationGate=strict`
  - `rollback=orchestrator_main`

该路径确保故障时“回退 orchestrator 主链”，避免路由进入未定义状态。

## 4) 配置入口

新增实验配置字段（`config.experimental`）：

- `retrieval_hybrid_strategy`
- `retrieval_hybrid_compensation_gate`
- `retrieval_hybrid_rollback`

新增环境变量读取：

- `OPENCODE_RETRIEVAL_HYBRID_STRATEGY`
- `OPENCODE_RETRIEVAL_HYBRID_COMPENSATION_GATE`
- `OPENCODE_RETRIEVAL_HYBRID_ROLLBACK`

实现位置：

- `packages/opencode/src/config/config.ts`
- `packages/opencode/src/flag/flag.ts`

## 5) 主链优先与非双主链证明

- 主检索链仍由 orchestrator tool-broker 驱动（既有主链不变）。
- LLM 侧检索仅作为补偿链，且由显式 gate 控制。
- 当主链可覆盖 retrieval 时（assist/heavy 或显式 `coversRetrieval=true`），补偿链被抑制。
- 故未引入“主链并发竞争”或“同轮双主链”。

## 6) TDD 证据（RED → GREEN）

测试文件：`packages/opencode/test/session/llm.test.ts`

- RED：先添加新断言（strict/balanced/off + fallback/config/env 优先级）。
- GREEN：实现 `hybrid-routing-policy.ts` 并接入 `LLM`、`SessionProcessor` 后通过。

关键新增用例：

1. `strict` 在主链健康时抑制补偿链。
2. `balanced` 在主链不覆盖检索时触发补偿链。
3. `off` 即使主链降级也不触发补偿链。
4. 非法 gate / 非法 env strategy 触发 fallback（`orchestrator_main`）。
5. config 显式策略与 env 覆盖优先级。

## 7) 变更清单（P2-2 范围）

- `packages/opencode/src/session/hybrid-routing-policy.ts`（新增）
- `packages/opencode/src/session/llm.ts`
- `packages/opencode/src/session/processor.ts`
- `packages/opencode/src/config/config.ts`
- `packages/opencode/src/flag/flag.ts`
- `packages/opencode/test/session/llm.test.ts`

