# V1.5 收口审计报告（WS-05）

- 日期：2026-02-08
- 分支：`codex/v15-closeout-audit`
- 审计脚本：`packages/opencode/script/v15-checklist-audit.ts`
- 审计结论：14/14 已满足，门禁通过（exit code = 0）

## 清单与状态

| ID | 核心不变量 | 状态 | 自动校验方式 | 证据路径 |
| --- | --- | --- | --- | --- |
| I1 | `orchestratorMode=chat` 必须 0 worker | 已满足 | 静态探针 + 单测回放 | `src/session/orchestrator/plan.ts`; `test/session/orchestrator-plan.test.ts` |
| I2 | worker 不得直连工具，只能经 broker | 已满足 | 静态探针 + 单测回放 | `src/protocol/llm-worker-result.ts`; `src/session/orchestrator/index.ts` |
| I3 | tool broker 必须 non-interactive | 已满足 | 离线评测契约 + 单测回放 | `src/eval/offline.ts`; `test/eval/offline-regression.test.ts` |
| I4 | `bounceMax <= 1`，禁止递归回填循环 | 已满足 | 静态探针 + 单测回放 | `src/session/orchestrator/plan.ts`; `test/session/orchestrator-tool-broker-policy.test.ts` |
| I5 | 所有工具结果必须 pointerize 落 artifacts | 已满足 | 静态探针 + 单测回放 | `src/session/orchestrator/tool-broker.ts`; `test/session/orchestrator-tool-broker.test.ts` |
| I6 | `mainTools` 三态语义不变（`null/[]/allowlist`） | 已满足 | 静态探针 + 单测回放 | `src/session/orchestrator/index.ts`; `test/session/orchestrator-main-tools.test.ts` |
| I7 | `unknown-first` 为全阶段最小底线 | 已满足 | 静态探针 + 单测回放 | `src/verification/claim-graph.ts`; `test/session/claim-graph-gate.test.ts` |
| I8 | claim 无证据不得“确定性陈述” | 已满足 | 静态探针 + 单测回放 | `src/verification/worker.ts`; `test/session/claim-graph-gate.test.ts` |
| I9 | 插件不能替换 core 主控制流 | 已满足 | 静态探针 + 单测回放 | `src/plugin/index.ts`; `test/plugin/plugin-contract.test.ts` |
| I10 | core policy 优先级高于 plugin policy | 已满足 | 静态探针 + 单测回放 | `src/session/orchestrator/policy.ts`; `test/session/orchestrator-policy-precedence.test.ts` |
| I11 | side-effect 任务必须 fork 子 session | 已满足 | 静态探针 + 单测回放 | `src/session/orchestrator/plan.ts`; `test/session/orchestrator-plan.test.ts` |
| I12 | 缓存 key 含 schema/version/policy 关键维度 | 已满足 | 静态探针 + 单测回放 | `src/session/context-pack-cache.ts`; `test/session/context-os-cache-key.test.ts` |
| I13 | 每 turn 必须有 `traceId` 且事件可回放 | 已满足 | 静态探针 + 单测回放 | `src/evidence/writer.ts`; `test/evidence/evidence-writer.test.ts`; `test/evidence/dual-pass-citation-integrity.test.ts` |
| I14 | plugin 启用前必须通过兼容性矩阵校验 | 已满足 | 静态探针 + 单测回放 | `src/plugin/contract.ts`; `test/plugin/plugin-contract.test.ts` |

## 证据索引

- `src/session/orchestrator/plan.ts`
- `test/session/orchestrator-plan.test.ts`
- `src/protocol/llm-worker-result.ts`
- `src/session/orchestrator/index.ts`
- `src/eval/offline.ts`
- `test/eval/offline-regression.test.ts`
- `test/session/orchestrator-tool-broker-policy.test.ts`
- `src/session/orchestrator/tool-broker.ts`
- `test/session/orchestrator-tool-broker.test.ts`
- `test/session/orchestrator-main-tools.test.ts`
- `src/verification/claim-graph.ts`
- `test/session/claim-graph-gate.test.ts`
- `src/verification/worker.ts`
- `src/plugin/index.ts`
- `test/plugin/plugin-contract.test.ts`
- `src/session/orchestrator/policy.ts`
- `src/session/context-pack-cache.ts`
- `test/session/context-os-cache-key.test.ts`
- `src/evidence/writer.ts`
- `test/evidence/evidence-writer.test.ts`
- `test/evidence/dual-pass-citation-integrity.test.ts`
- `src/plugin/contract.ts`

## 未满足项

无
