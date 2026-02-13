# P0-B1 ToolRequestV2 / CriticVerdictV2 Schema 固化说明

- Card: `CARD-BLK-06 / P0-B1`
- Scope: `F4 / V1-V2 Bridge`
- Mode: `fail-fast + local-only + no-push`
- Branch: `codex/v16-p0-b1-toolrequest-critic-v2`

## 1) ToolRequestV2（`tool-request/2.0`）

实现位置：
- `packages/opencode/src/protocol/llm-worker-result.ts`

字段定义（最小可用）：
- `specVersion: "tool-request/2.0"`
- `kind: "retrieval" | "verification"`
- `queries: Array<{ id, type, query, pathHints?, why? }>`，其中 `type in ["symbol", "path", "text"]`
- `filters: { extensions?: string[]; exclude?: string[] }`
- `expectedEvidence: string[]`
- `dedupeKey: string`

兼容桥接：
- `toolRequestV1FromV2(v2) -> ToolRequest(v1)`
  - 规则：取 `queries` 首个有效 `query` 作为 v1 `input`
  - 降级：若 `queries` 不可用，回退 `dedupeKey`
- `toolRequestV2FromV1(v1) -> ToolRequestV2(v2)`
  - 规则：生成单条 `text` 查询（`id=q1`）
  - 默认 `filters`：`.ts/.md` + 排除 `.opencode/**/.git/**`
  - `dedupeKey`：`sha256(kind:input)`
- `toolRequestV1Compatible(v1|v2)`
  - 规则：优先按 v1 解析；失败时按 v2 解析并降级到 v1

## 2) CriticVerdictV2（`critic-verdict/2.0`）

实现位置：
- `packages/opencode/src/protocol/llm-worker-result.ts`

字段定义（最小可用）：
- `specVersion: "critic-verdict/2.0"`
- `status: "sufficient" | "insufficient" | "conflict" | "degraded"`
- `coverage: Array<{ requirementId, evidenceIds, pass }>`
- `missing: Array<{ requirementId, reason, suggestedQuery? }>`
- `conflicts: Array<{ left, right, reason }>`
- `confidence: number(0..1)`
- `retry: { allowed, newQueries, stopReason }`

兼容桥接：
- `criticVerdictV1FromV2(v2) -> LlmWorkerResult(v1)`
  - `status` 映射：`sufficient -> ok`，其他 -> `degraded`
  - `retry.newQueries` 映射为 v1 `toolRequests(retrieval)`
  - `missing/conflicts/stopReason` 映射为 v1 `notes`
  - 降级：无可用 note 时补 `verdict degraded:<status>`
- `criticVerdictV2FromV1(v1) -> CriticVerdictV2(v2)`
  - `status` 映射：`ok -> sufficient`，其他 -> `degraded`
  - `toolRequests.input` 映射到 `retry.newQueries`
  - v1 `notes` 映射为 `missing[]`（`requirementId=v1_note_n`）

## 3) Worker/Broker 兼容落点

- Tool Broker 入口支持 `Array<ToolRequest | ToolRequestV2>`
  - 文件：`packages/opencode/src/session/orchestrator/tool-broker.ts`
  - 处理：入口统一调用 `toolRequestV1Compatible(...)` 再执行既有 broker 逻辑
- Evidence Critic 支持 v2 verdict 输入
  - 文件：`packages/opencode/src/session/orchestrator/workers/evidence-critic.ts`
  - 处理：`Critic(v1)` 解析失败时尝试 `CriticVerdictV2`，再降级映射到既有 bounded 路径

## 4) 口径说明

- 本卡仅做 schema + 兼容解析最小实现，不改变业务决策语义。
- v2 parse 失败保持 fail-closed：回落既有 v1 degraded 输出。
- 该实现作为 `P0-B2/P0-B3/P0-B5` 前置协议稳定层。
