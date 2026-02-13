# P0-B1 V2 Round-Trip / Compatibility Report

- Card: `CARD-BLK-06 / P0-B1`
- Branch: `codex/v16-p0-b1-toolrequest-critic-v2`
- Workspace: `.worktrees/wt-v16-p0-b1-toolrequest-critic-v2`
- Strategy: `TDD RED -> GREEN`

## A) RED 证据

### A1. 先加失败测试
新增断言位置：
- `packages/opencode/test/session/orchestrator-tool-broker.test.ts`
- `packages/opencode/test/session/orchestrator-evidence-critic.test.ts`

覆盖点：
- ToolRequestV2 字段完整性 + schema round-trip
- CriticVerdictV2 字段完整性 + schema round-trip
- v1->v2 / v2->v1 兼容与降级行为
- broker 接受 v2 请求并降级执行
- evidence_critic 接受 v2 verdict 并映射为既有 v1 输出

### A2. RED 命令结果
```bash
bun test test/session/orchestrator-tool-broker.test.ts test/session/orchestrator-evidence-critic.test.ts --bail
# 结果：FAIL（初始缺少 ToolRequestV2/CriticVerdictV2 导出与桥接实现）
```

## B) GREEN 证据

### B1. 最小实现
变更文件：
- `packages/opencode/src/protocol/llm-worker-result.ts`
- `packages/opencode/src/session/orchestrator/tool-broker.ts`
- `packages/opencode/src/session/orchestrator/workers/evidence-critic.ts`

核心实现：
- 新增 `ToolRequestV2` + `CriticVerdictV2` schema
- 新增 v1/v2 双向桥接函数与降级口径
- broker 在入口统一兼容 v2 request
- evidence_critic 在 schema fallback 中兼容 v2 verdict

### B2. GREEN 命令结果
```bash
bun test test/session/orchestrator-tool-broker.test.ts test/session/orchestrator-evidence-critic.test.ts --bail
# 结果：PASS
```

## C) 兼容/降级矩阵

| 输入 | 解析策略 | 输出 | 降级口径 |
|---|---|---|---|
| ToolRequest v1 | 直接通过 v1 schema | v1 ToolRequest | 无 |
| ToolRequest v2 | 解析 v2 后降级 | v1 ToolRequest | `query[0]` 缺失时回退 `dedupeKey` |
| CriticVerdict v2 (sufficient) | 解析 v2 -> 映射 v1 | `status=ok` | notes 最小化保留 |
| CriticVerdict v2 (insufficient/conflict/degraded) | 解析 v2 -> 映射 v1 | `status=degraded` + retrieval toolRequests | 失败时回落 `schema invalid` degraded |
| Critic v1 | 直接通过 v1 schema | 既有流程 | 无 |

## D) 风险与后续

剩余风险（本卡不扩展）：
- v2 `coverage/missing/conflicts` 的语义消费仍是最小映射，尚未进入更细粒度策略决策。
- v2->v1 是兼容桥，不保证信息无损（符合桥接降级口径）。

建议后续（由后续卡承担）：
- `P0-B2`: EvidenceBundleV2 与密度字段联动。
- `P0-B3`: orchestrator_evidence_v2 注入模板主链落地。
- `P0-B5`: 双读双写迁移与灰度指标固化。
