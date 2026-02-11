# V1.6 最终协作架构决策稿（Evidence-first）

> 日期：2026-02-10  
> 适用范围：`main brain + retrieval_planner + evidence_critic + patch_planner`（单 Session 协作）  
> 当前阶段：最终设计收敛（本稿不改业务代码）  
> 决策目标：在定版前把“主脑 + 2~3 小脑”从“能跑”升级为“稳定增益 + 可灰度 + 可回滚”

证据标注规则：
- **[事实]**：可被现有文档、代码或产物直接验证。
- **[推断]**：基于事实的工程推论，已给出补证路径。

---

## A. 决策摘要（结论先行）

1. **最终架构采用“Evidence Contract v2 + 单证据主链”**：保留单 Session，不引入多跳状态机；先修证据协议、载荷密度、守卫闭环。  
   - **[事实]** 现状已是单 Session 协作且链路可运行，但证据载荷不稳定（`docs/plans/2026-02-10-v1_6-worker-collab-diagnostic-report.md:12-16`，`docs/plans/2026-02-10-main-brain-worker-collab-architecture-review.md:252-263`）。

2. **职责边界定版：主脑负责结论，retrieval_planner 负责“找证据”，evidence_critic 负责“判证据”，patch_planner 仅负责“改动策略”**。  
   - **[事实]** 当前 worker 已分别落在这三个角色，但输出契约仍偏弱（`packages/opencode/src/session/orchestrator/workers/retrieval-planner.ts:115-145`，`packages/opencode/src/session/orchestrator/workers/evidence-critic.ts:116-146`，`packages/opencode/src/session/orchestrator/workers/patch-planner.ts:11-19`）。

3. **协作链路必须收敛，禁止同轮重复检索主链并行竞争**：orchestrator 检索链作为证据主链；LLM 侧独立检索链只保留为“补偿链”并受门控。  
   - **[事实]** 当前存在两条检索入口：`tool-broker -> runRetrieval` 与 `LLM.stream -> runRetrieval`（`packages/opencode/src/session/orchestrator/tool-broker.ts:274-279`，`packages/opencode/src/session/llm.ts:322-329`）。

4. **小脑是否“显著增强主脑”，以结构化判据为准，不以触发次数为准**：只要 critic 输出 `sufficient` 且 claims 可核验，才计为增强成功。  
   - **[事实]** 当前“触发成功 ≠ 增强成功”：同 message 触发多轮但 critic 仍 degraded，最终 secure-output degraded（`docs/plans/2026-02-10-v1_6-worker-collab-diagnostic-report.md:57-73`，`docs/plans/2026-02-10-v1_6-worker-collab-diagnostic-report.md:159-160`）。

5. **执行路线定为“7天止损 + 30天闭环 + 阈值回滚”**，并使用明确灰度门限：`critic_degraded_rate`、`secure_output_pass_rate`、`rerun_count_per_message` 为三条硬阈值。  
   - **[事实]** 阈值建议已在评审中出现并可复用（`docs/plans/2026-02-10-main-brain-worker-collab-architecture-review.md:166-170`，`docs/plans/2026-02-10-general-cognitive-architecture-and-llm-weaknesses-validated.md:195-199`）。

6. **`secure-output` 合同链路提级为 P0 已确认高风险项**：不是“可选优化”，而是发布阻断。  
   - **[事实]** 合同文本被拼到 `developerText`，但系统块打包路径未直接消费 `developerText`（`packages/opencode/src/session/llm.ts:111`，`packages/opencode/src/session/llm.ts:139-147`，`packages/opencode/src/session/llm.ts:697-710`）。

7. **将“工程化外置工作记忆机制（4+3）”纳入主脑+小脑主架构，而非旁路能力**：它是协作增强地基，不是独立子系统。  
   - **[事实]** 当前已具备 append-only 事件账本、上下文账本、检索缓存键、证据链校验等基础构件（`packages/opencode/src/evidence/writer.ts:380-405`，`packages/opencode/src/session/context-ledger.ts:33-46`，`packages/opencode/src/retrieval/cache.ts:11-20`，`packages/opencode/src/evidence/chain.ts:77-146`）。  
   - **[推断]** 仍缺“锚点快照标准集 + 进度单调性 + 可恢复检查点 + 失败分层回退图”，需在 V1/V2 按发布门禁补齐，避免做成半成品。

8. **商业化存储拓扑采用 `L0 临时层 + L1 用户态持久层 + L2 项目指针层`，本轮仅纳入路线图不执行**。  
   - **[事实]** 当前证据主存储位于项目目录 `.opencode/**`（`packages/opencode/src/util/tenant-context.ts:51-75`），且系统已具备全局路径能力（`packages/opencode/src/global/index.ts:8-25`）。  
   - **[推断]** 若长期仅依赖项目内落盘，商业化阶段会遇到跨项目追踪、权限最小化与清理策略不一致问题；需在 V2+ 完成分层迁移。

---

## B. 四份资料一致性/冲突矩阵（逐条）

> 对比对象：
> 1) 诊断报告 `docs/plans/2026-02-10-v1_6-worker-collab-diagnostic-report.md`  
> 2) 优化评审 `docs/plans/2026-02-10-v1_6-optimization-review.md`  
> 3) 架构评审 `docs/plans/2026-02-10-main-brain-worker-collab-architecture-review.md`  
> 4) 通用认知校正版 `docs/plans/2026-02-10-general-cognitive-architecture-and-llm-weaknesses-validated.md`

| 议题 | 四份资料方向是否一致 | 冲突点 | 最终收敛决策 | 证据 |
|---|---|---|---|---|
| 1) 小脑是否真的触发 | 一致（都认可“已触发”） | 无 | 不再争论“触发”，转向“有效载荷质量” | `docs/plans/2026-02-10-v1_6-worker-collab-diagnostic-report.md:12-15` |
| 2) 主问题是否在检索/证据载荷 | 一致 | 无 | P0先修 query 结构化 + topK 证据密度 + critic 输入契约 | `docs/plans/2026-02-10-v1_6-worker-collab-diagnostic-report.md:13-15,141-149`; `docs/plans/2026-02-10-v1_6-optimization-review.md:47-50`; `docs/plans/2026-02-10-main-brain-worker-collab-architecture-review.md:74-77`; `docs/plans/2026-02-10-general-cognitive-architecture-and-llm-weaknesses-validated.md:82-90` |
| 3) 是否需要结构化协议 | 一致 | 无 | 定版为 `RolePack/ToolRequest/EvidenceBundle/CriticVerdict` 四段强 schema | `docs/plans/2026-02-10-v1_6-optimization-review.md:64-66,77-81`; `docs/plans/2026-02-10-main-brain-worker-collab-architecture-review.md:232-244`; `docs/plans/2026-02-10-general-cognitive-architecture-and-llm-weaknesses-validated.md:106-110` |
| 4) 重跑/循环问题 | 一致（都认为有） | 根因定位不完全一致 | 采用“消息级幂等 + query去重 + 最大重跑次数”三重收敛 | `docs/plans/2026-02-10-v1_6-worker-collab-diagnostic-report.md:68-72,153-155`; `docs/plans/2026-02-10-v1_6-optimization-review.md:51`; `docs/plans/2026-02-10-general-cognitive-architecture-and-llm-weaknesses-validated.md:99,126` |
| 5) secure-output 降级问题 | 一致（都观察到） | “合同未进入最终 system” vs “模型执行不一致”存在分歧 | 提级为 P0 已确认高风险，先修合同到达链路 + claims 自检，再做机理分层补证 | `docs/plans/2026-02-10-v1_6-worker-collab-diagnostic-report.md:159-160`; `docs/plans/2026-02-10-main-brain-worker-collab-architecture-review.md:77,199-201`; `packages/opencode/src/session/llm.ts:111,139-147,697-710`; `packages/opencode/src/secure-output/worker.ts:110-157` |
| 6) 提示词策略 | 一致（都建议多层） | 无 | 角色/约束/输出/评估四层模板并版本化 | `docs/plans/2026-02-10-v1_6-worker-collab-diagnostic-report.md:230-231`; `docs/plans/2026-02-10-v1_6-optimization-review.md:83-85`; `docs/plans/2026-02-10-main-brain-worker-collab-architecture-review.md:239-246` |
| 7) 观测能力判断 | 部分一致 | “观测不足”与“有原始事件但无聚合视图”表述冲突 | 统一口径：不是没观测，是缺 message 级摘要件；P0 前置埋点落盘 | `docs/plans/2026-02-10-v1_6-worker-collab-diagnostic-report.md:156-157`; `docs/plans/2026-02-10-main-brain-worker-collab-architecture-review.md:186-188`; `packages/opencode/src/session/orchestrator/worker-runner.ts:151-190` |
| 8) 三小脑理论结论强度 | 不一致 | 原稿存在绝对化表述，validated 明确降级为“可检验假设” | 以 validated 为准：工程假设 + 评测验证，不使用“唯一最优”表述 | `docs/plans/2026-02-10-general-cognitive-architecture-and-llm-weaknesses.md:11-21,78`; `docs/plans/2026-02-10-general-cognitive-architecture-and-llm-weaknesses-validated.md:15-23,57-70` |
| 9) 默认参数口径 | 不一致 | 设计文档与当前实现存在 topK/timeout 口径漂移 | 统一由协议配置中心管理并落盘版本 | `docs/plans/2026-01-25-opencode-sandbox-context-design.md:263-267,463-467`; `packages/opencode/src/session/orchestrator/plan.ts:378-383`; `packages/opencode/src/retrieval/runner.ts:263-267,696-699` |
| 10) A/B/C 路由模型与当前 worker 栈关系 | 部分一致 | 老设计是 A/B/C（LSP/KB/Graph），现实现是 retrieval/critic/patch | 采用“语义映射 + 不并栈”：A=检索规划，C=证据审计，B=改动策略（仅写入场景） | `docs/plans/2026-01-25-opencode-sandbox-context-design.md:181-203`; `packages/opencode/src/session/orchestrator/plan.ts:138-145` |
| 11) 外置工作记忆机制（append-only + anchor replay + delta probe + reference check） | 部分一致 | 评审材料强调“协议/观测”，但未把“压缩恢复一致性与进度单调性”写成主协议 | 定版并入主架构：作为主脑+小脑共享地基，扩展为“4+3”生产级机制 | `packages/opencode/src/evidence/writer.ts:380-405`; `packages/opencode/src/session/context-ledger.ts:68-120`; `packages/opencode/src/session/compaction.ts:405-417`; `packages/opencode/src/retrieval/runner.ts:357-365,724-745`; `packages/opencode/src/evidence/chain.ts:77-146` |

补充冲突说明（必须显式记录）：
- **[事实]** 优化评审称 patch planner 是 stub（`docs/plans/2026-02-10-v1_6-optimization-review.md:52`），但当前代码已是结构化输出并有可执行内容拦截（`packages/opencode/src/session/orchestrator/workers/patch-planner.ts:11-19,186-199`）。该结论属于“阶段性过时”。
- **[推断]** 仍需用离线回放验证 patch_planner 是否真正提升复杂任务成功率（待补证项见 Section I）。

---

## C. 最终职责边界（主脑 + 3小脑）

### C.1 最终角色定义（定版）

| 角色 | 必做职责 | 禁做职责 | 输入 | 输出（强制） |
|---|---|---|---|---|
| 主脑（Main Brain） | 组织最终答复、生成用户可读结论、输出 claims block | 直接定义证据充分性结论（该职责属于 critic） | 用户问题 + `orchestrator_evidence_v2` 注入 | `final_answer` + `assistant_claims_json` |
| retrieval_planner | 把 intent 转为结构化检索任务（query/filters/expected evidence） | 输出最终业务结论 | role pack + evidence requirements | `ToolRequestV2[]` |
| evidence_critic | 审查证据充分性、冲突性、时效性，给出 retry 建议 | 直接给最终用户下结论 | evidence bundle + requirement checklist | `CriticVerdictV2` |
| patch_planner | 在写入/执行场景输出变更策略（Step/Check/Rollback） | 直接执行命令、直接写代码 | critic verdict + confirmed evidence | `PatchPlanV2` |

### C.2 触发与编组规则（2~3 小脑）

- **Assist 模式（证据优先）**：默认 `retrieval_planner + evidence_critic`（2小脑）。  
  - **[事实]** 当前 assist 已是此组合（`packages/opencode/src/session/orchestrator/plan.ts:139-141`）。
- **Heavy 模式（高复杂分析，不直接写入）**：`retrieval_planner + evidence_critic + patch_planner`（3小脑）。  
  - **[事实]** 当前 heavy 是 retrieval+patch，critic 需要靠自适应追加，不稳定（`packages/opencode/src/session/orchestrator/plan.ts:142-166`）。
  - **[决策]** 自 2026-02-10 定版会起，heavy 模式强制常驻 `evidence_critic`，不得退回“按需追加”策略。
- **Fork 模式（写入/执行主路径）**：本轮拍板为写入/执行任务主路径，fork 前允许走一轮 assist 取证，fork 后结果仍回主链判定。  
  - **[事实]** 当前写入/执行意图会优先转入 fork（`packages/opencode/src/session/orchestrator/plan.ts:113`; `packages/opencode/src/session/processor.ts:674-717`）。

### C.2.1 模式主路拍板（P0 阻断已拍板）

| 场景 | 主路径（拍板） | 次路径 | 备注 |
|---|---|---|---|
| `hasWriteIntent=true` 或 `hasExecIntent=true` | `fork` | `assist`（仅前置取证） | 避免 heavy/fork 并行双栈冲突 |
| 非写入/执行，但高复杂度 | `heavy` | `assist` | heavy 负责“分析+策略”，不直接执行 |
| 证据优先问答/判定 | `assist` | `heavy`（仅当复杂度升级） | 默认 2小脑低成本路径 |
| 任一路径出现协议故障 | `assist + unknown-first` | 无 | fail-closed，禁止确定性事实输出 |


### C.3 进入/退出条件（任务化）

1. retrieval_planner 进入条件：`requiresCitation=true` 或 `evidencePolicy.enabled=true`。
2. evidence_critic 进入条件：存在 evidence bundle 或主脑将产生 fact claims。
3. patch_planner 进入条件：`orchestratorMode=="heavy"` 或 `fork_preflight=true`；不得作为写入执行器使用。
4. fork 进入条件：`hasWriteIntent || hasExecIntent`，并且若涉及事实断言需先完成 `assist` 前置取证。
5. 主脑退出条件：若 critic=`insufficient`，只能输出 unknown-first 模板，不得输出确定性 fact claims。

### C.4 与“主脑 + 2~3 小脑”是否同类任务（定版结论）

结论：**同类任务，且必须同一套地基承接**。外置工作记忆不是附加功能，而是主脑与小脑的协作底座。

| 外置机制能力 | 在主架构中的承接角色 | 为什么属于同类任务 | 现状 |
|---|---|---|---|
| 命令证据账本（append-only） | `retrieval_planner/tool_broker/evidence_critic/secure_output` 统一写入 | 主脑最终断言依赖可追溯证据；无账本则无法核验 | **已具备基础**（`packages/opencode/src/evidence/writer.ts:380-405`） |
| 状态锚点重放（anchor replay） | `main brain + session layer` 在压缩恢复后重建上下文 | 防止压缩后“任务断裂/重扫” | **部分具备**（`ContextLedger` + `compaction.report`），但锚点集合不完整（`packages/opencode/src/session/context-ledger.ts:33-46`; `packages/opencode/src/session/compaction.ts:405-417`） |
| 增量取证（delta probes） | `retrieval_planner -> tool_broker -> retrieval` | 小脑增益来自新增证据，而非重复执行 | **部分具备**（有 cache/dedupe），但 query 仍 string-only（`packages/opencode/src/retrieval/runner.ts:269-283`; `packages/opencode/src/protocol/llm-worker-result.ts:6-11`） |
| 完整性校验（reference check） | `evidence_critic + verification + secure_output` | 保障“事实断言可核验” | **已具备主链**（`packages/opencode/src/evidence/chain.ts:77-146`; `packages/opencode/src/verification/worker.ts:246-269`; `packages/opencode/src/secure-output/worker.ts:110-157`） |
| 进度单调性（新增） | `evidence_critic + orchestrator breaker` | 防止重跑无增益导致循环体感 | **缺失**（需新增） |
| 可恢复检查点（新增） | `compaction/context-pack/orchestrator` | 压缩后 deterministic resume | **缺失**（需新增） |
| 失败分层回退图（新增） | `patch_planner + orchestrator` | 防止失败后随机重试 | **缺失**（需新增） |

- **[推断]** 若不把 4+3 当作同类地基统一设计，主脑与小脑会继续出现“各自正确、整体失真”的状态噪音。

### C.5 地基评估：当前是否具备承接能力

- **[事实] 具备的地基**：
  1) 证据写入与事件日志（`evidence/events/artifacts`）；
  2) 上下文账本与压缩产物（`context-ledger`、`compaction.report`）；
  3) 检索缓存与指针完整性校验；
  4) secure-output + verification 门禁链。  
- **[事实] 缺失的地基**：
  1) 标准化 `anchor-snapshot` 协议；
  2) `probe-journal` 的 query 结构化与去重键统一；
  3) `progress-ledger` 的增益门禁与停止规则；
  4) resume checkpoint 与 fallback DAG 的可执行协议。  
- **[结论]** 当前架构“可承接但不够生产级”；需按 V1/V2 补齐后再称商业级。

---

## D. 最终协议草案（输入/输出 schema、注入规范）

> 目标：把“自然语言协作”变成“可解析、可回放、可门禁”的协议协作。

### D.1 `llm-worker-role-pack/2.0`（草案）

```json
{
  "specVersion": "llm-worker-role-pack/2.0",
  "task": {
    "sessionId": "<session>",
    "messageId": "<message>",
    "intent": "<normalized intent>",
    "mode": "assist|heavy",
    "requiresCitation": true
  },
  "policy": { "mode": "strict|balanced|loose", "unknown": "deny" },
  "budget": { "timeoutMs": 12000, "maxOutputTokens": 32000, "maxToolCalls": 4, "maxRerun": 1 },
  "evidenceRequirements": [
    {
      "id": "req_rule_1",
      "kind": "rule|fact|conflict",
      "mustFields": ["path", "sha256", "anchor", "quote"],
      "recency": "as_of:2026-02-10"
    }
  ],
  "workingSet": {
    "pointers": ["artifact path..."],
    "retrievalDigestHash": "sha256(...)"
  }
}
```

- **[事实]** 当前 role pack 只有 `planPointer + pointers`，缺 requirement 结构（`packages/opencode/src/protocol/llm-worker-role-pack.ts:36-44`）。
- **[推断]** v2 增加 `evidenceRequirements` 可直接约束 critic 判定口径。

### D.2 `tool-request/2.0`（retrieval_planner -> tool broker）

```json
{
  "specVersion": "tool-request/2.0",
  "kind": "retrieval",
  "queries": [
    {
      "id": "q1",
      "type": "symbol|path|text",
      "query": "UserService.updatePolicy",
      "pathHints": ["packages/opencode/src/session"],
      "why": "验证 claims#2"
    }
  ],
  "filters": { "extensions": [".ts", ".md"], "exclude": [".opencode/**", ".git/**"] },
  "expectedEvidence": ["req_rule_1"],
  "dedupeKey": "sha256(intent+queries+filters)"
}
```

- **[事实]** 当前 ToolRequest 仅 `kind + input:string`（`packages/opencode/src/protocol/llm-worker-result.ts:6-11`）。
- **[事实]** 当前 runRetrieval 以归一化 intent 直接建 query，语义粒度不足（`packages/opencode/src/retrieval/runner.ts:269-278`）。

### D.3 `evidence-bundle/2.0`（tool broker -> evidence_critic）

```json
{
  "specVersion": "evidence-bundle/2.0",
  "retrievalId": "<id>",
  "summary": { "total": 20, "code": 18, "workbench": 2 },
  "hits": [
    {
      "id": "E1",
      "pointer": { "path": ".../snippets/0001.txt", "sha256": "...", "anchor": { "lineStart": 1, "lineEnd": 8 } },
      "origin": { "path": "packages/opencode/src/...", "lineStart": 120, "lineEnd": 127 },
      "snippet": "...正文片段...",
      "source": "lsp|rg|workbench|tree",
      "score_bps": 9000,
      "densityScore": 0.86
    }
  ],
  "topEvidence": ["E1", "E2", "E3", "E4", "E5"],
  "dedupe": { "method": "hash+overlap", "report": ".../dedupe.report.json" }
}
```

- **[事实]** 当前 code retrieval 会把 `tree` 路径项作为 hit（`packages/opencode/src/retrieval/code.ts:125-136`），并且最终 topK 固定取前 5（`packages/opencode/src/retrieval/runner.ts:696-699`）。
- **[推断]** v2 必须显式引入 `densityScore`，防止“路径噪声挤占正文证据”。

### D.4 `critic-verdict/2.0`（evidence_critic 输出）

```json
{
  "specVersion": "critic-verdict/2.0",
  "status": "sufficient|insufficient|conflict|degraded",
  "coverage": [
    { "requirementId": "req_rule_1", "evidenceIds": ["E1"], "pass": true }
  ],
  "missing": [
    { "requirementId": "req_fact_2", "reason": "missing rule quote", "suggestedQuery": "..." }
  ],
  "conflicts": [
    { "left": "E3", "right": "E9", "reason": "same symbol different semantics" }
  ],
  "confidence": 0.78,
  "retry": {
    "allowed": true,
    "newQueries": ["..."],
    "stopReason": "coverage_below_threshold"
  }
}
```

- **[事实]** 当前 critic 输出仍是 `status + notes + toolRequests`，没有 coverage 结构（`packages/opencode/src/session/orchestrator/workers/evidence-critic.ts:9-24`）。

### D.5 主脑注入规范（`orchestrator_evidence_v2`）

```text
<orchestrator_evidence_v2>
verdict_json: { ...CriticVerdictV2... }
evidence_digest:
- [E1] path=... sha=... anchor=... summary=...
- [E2] ...
missing_digest:
- req_fact_2: missing rule quote
instruction_to_main_brain:
- fact claims MUST map to evidence ids
- if verdict=insufficient, answer with unknown-first
</orchestrator_evidence_v2>
```

注入约束：
1. 证据摘要优先于状态摘要（至少 3 条证据摘要，notes 放后）。
2. 不注入路由调试词（`from_model/to_model/gate_reason`）。
3. 注入总预算建议 `< 900 tokens`，超限先裁 notes，再裁低密度证据。

- **[事实]** 当前 `renderInjection` 仅保留 `notes(2) + pointers(3)`，易信息不足（`packages/opencode/src/session/orchestrator/index.ts:215-224`）。

### D.6 `assistant_claims_json` 映射规范（主脑 -> secure-output）

- 每条 `kind=fact` claim 必须引用 `evidence_digest` 中的 `E#`，并展开为 `path + sha256 + anchor`。
- `verdict=insufficient` 时不得输出 `fact` claim；只能输出 `plan/opinion` + 不确定性声明。

- **[事实]** secure-output 对 claims block 缺失会直接降级（`packages/opencode/src/secure-output/worker.ts:110-157`）。
- **[事实]** 当前合同文本已进入 `developerText`，但 system 打包路径未直接消费 `developerText`（`packages/opencode/src/session/llm.ts:111,139-147,697-710`）。
- **[推断]** 合同“到达链路”与“模型遵守链路”需拆分治理：先修到达链路（P0 阻断），再做遵守率优化。

### D.7 协议迁移顺序（v1/v2，避免切流混乱）

1. **阶段 0：双读准备**  
   - 读取端同时兼容 `v1` 和 `v2`，写入仍保持 `v1`。
2. **阶段 1：双写灰度**  
   - 写入端同时产出 `v1 + v2`（artifact 与 event 均带 `schema_version`）。
3. **阶段 2：读 v2 优先**  
   - 读取优先 `v2`，解析失败回退 `v1` 并记录 `protocol.violation`。
4. **阶段 3：单写 v2**  
   - 当离线与灰度指标连续达标后，关闭 `v1` 写入，仅保留 `v1` 读取回退。
5. **阶段 4：退役 v1**  
   - 经过一个稳定窗口（建议 2 周）后移除 `v1` 读取回退。

迁移门禁：
- `v2_parse_success_rate >= 99.5%`
- `secure_output_pass_rate` 不低于基线 -3pp
- `critic_degraded_rate` 不恶化超过 +5pp

### D.8 外置工作记忆协议（4+3）草案

> 目标：让“压缩可恢复、重跑可收敛、证据可追责”成为硬协议，而非经验做法。

1. `anchor-snapshot/1.0`（每轮固定锚点）
```json
{
  "specVersion": "anchor-snapshot/1.0",
  "sessionId": "<session>",
  "messageId": "<message>",
  "planId": "<plan>",
  "repo": { "head": "<sha>", "dirty": true },
  "model": { "providerId": "<provider>", "modelId": "<model>" },
  "context": { "lastContextPackId": "<id>", "orchestratorMode": "assist|heavy|fork" },
  "toolsetFingerprint": "sha256(...)"
}
```

2. `probe-journal/1.0`（增量探针账本）
```json
{
  "specVersion": "probe-journal/1.0",
  "messageId": "<message>",
  "probeId": "<ulid>",
  "dedupeKey": "sha256(query+filters+intent)",
  "why": "验证 claims#2",
  "queries": [{ "type": "symbol|path|text", "q": "..." }],
  "expectedEvidence": ["req_rule_1"]
}
```

3. `progress-ledger/1.0`（进度单调性）
```json
{
  "specVersion": "progress-ledger/1.0",
  "messageId": "<message>",
  "cycle": 2,
  "coverageGain": 0.18,
  "newEvidenceCount": 3,
  "duplicateProbeRate": 0.11,
  "decision": "continue|stop",
  "stopReason": "no_new_evidence"
}
```

4. `resume-checkpoint/2.0`（V2 新增）
```json
{
  "specVersion": "resume-checkpoint/2.0",
  "sessionId": "<session>",
  "checkpointId": "<id>",
  "anchorHash": "sha256(anchor-snapshot)",
  "contextPackId": "<id>",
  "resumePolicy": "fail_closed"
}
```

5. `fallback-dag/2.0`（V2 新增）
```json
{
  "specVersion": "fallback-dag/2.0",
  "errorCode": "schema_invalid",
  "path": ["retry_once", "switch_to_unknown_first", "stop"],
  "maxRetry": 1
}
```

- **[事实]** 当前已有 `context-ledger/1.0` 与 `context-pack` delta 字段，可作为 V1 起点（`packages/opencode/src/session/context-ledger.ts:35`; `packages/opencode/src/session/context-pack.ts:128-132`）。
- **[推断]** V2 必须引入 `resume-checkpoint` 与 `fallback-dag`，否则无法达到商业级可恢复性。

### D.9 商业化存储拓扑协议（Deferred，防遗忘）

> 本节用于锁定未来实现边界；开发阶段不切换现有项目内落盘策略。

```json
{
  "specVersion": "memory-storage-policy/1.0",
  "tiers": {
    "L0": "tmp-spool (ephemeral)",
    "L1": "global-state-ledger (persistent)",
    "L2": "workspace-manifest-pointer (project-local)"
  },
  "security": {
    "dirPerm": "700",
    "filePerm": "600",
    "redaction": "enabled"
  },
  "retention": {
    "tmpHours": 24,
    "ledgerDays": 30,
    "manifestDays": 180
  }
}
```

- **[事实]** `.opencode` 项目内目录当前已承担 evidence/artifact 主落盘（`packages/opencode/src/util/tenant-context.ts:51-99`）。
- **[事实]** `Global.Path.data/cache/config/state` 已可承载 L1 用户态目录（`packages/opencode/src/global/index.ts:8-25`）。
- **[推断]** 商业化版本应采用 `L0/L1/L2` 分层并配套双写迁移窗口，避免一次性搬迁导致可追溯性断裂。

### D.10 单证据主链开关契约（防双链并行打架）

| 开关键 | 含义 | Stage0 | Stage1 | Stage2+ | 回退顺序 |
|---|---|---|---|---|---|
| `retrieval_chain.main.enabled` | orchestrator 检索主链 | `true` | `true` | `true` | 不回退（仅紧急故障关闭） |
| `retrieval_chain.compensation.enabled` | LLM 侧补偿检索链 | `true`（shadow only） | `true`（门控触发） | `false`（默认） | `true -> false` |
| `retrieval_chain.compensation.gate` | 补偿链触发条件 | `critic.insufficient OR retrieval.timeout OR retrieval.degraded` | 同左 | 同左（仅人工放开） | `strict -> balanced -> off` |
| `retrieval_chain.compensation.maxRuns` | 单消息补偿链最大次数 | `1` | `1` | `1` | `1 -> 0` |
| `retrieval_chain.rollback.order` | 回退执行顺序 | `compensation -> v2 parser -> v1 injection` | 同左 | 同左 | 固定顺序 |

- **[事实]** 当前存在 orchestrator 与 LLM 两条检索入口（`packages/opencode/src/session/orchestrator/tool-broker.ts:274-279`; `packages/opencode/src/session/llm.ts:322-329`）。
- **[决策]** Stage1 之后默认仅保留主链，补偿链只在 gate 命中时单次触发。
- **[任务化要求]** 上述开关必须写入 `orchestrator.features.json`，并记录每次变更的 `operator + reason + ts`。

---

## E. 最终链路时序（含降级与重跑策略）

### E.1 正常时序（定版）

1. `prepareOrchestratorPlan` 生成 plan + workers + budgets。  
2. retrieval_planner 输出 `ToolRequestV2`（禁止 string-only query）。  
3. tool broker 执行检索，生成 `EvidenceBundleV2`。  
4. evidence_critic 产出 `CriticVerdictV2(pass1)`。  
5. 若 `insufficient` 且 `retry.allowed=true`，执行一次定向补检索。  
6. evidence_critic 产出 `CriticVerdictV2(final)`。  
7. render 注入 `orchestrator_evidence_v2` 到主脑 system。  
8. 主脑生成回答 + `assistant_claims_json`。  
9. secure-output 校验 claims 与 pointers，输出 `ok/degraded`。

### E.2 收敛规则（避免重复检索/重复重跑）

- **消息级幂等键**：`sessionId:messageId:planId`，同键仅允许一次 orchestrator 主执行。
- **检索去重键**：`dedupeKey=sha256(queries+filters+intent)`，同键重复请求直接复用。
- **重跑预算**：每 message 最多 `1 次补检索 + 1 次 critic 重判`。
- **终止条件**：出现以下任一条件立即收敛：
  1) `status=sufficient`；
  2) `newQueries` 与上一轮 hash 相同；
  3) 达到 `maxRerun`；
  4) 达到 wall-clock 预算。

- **[事实]** 当前 broker `cycle` 固定 1，bounceMax 也是 1（`packages/opencode/src/session/orchestrator/index.ts:424`; `packages/opencode/src/session/orchestrator/tool-broker.ts:133-156`; `packages/opencode/src/session/orchestrator/plan.ts:394`）。
- **[推断]** 当前“多次 planned”更像 message/turn 级重复触发而非 broker 内循环，需在 orchestrator 外层加幂等与 breaker。

### E.3 降级策略（fail-closed）

- **降级 A（检索失败）**：critic 返回 `insufficient` + missing list；主脑必须 unknown-first，不给确定性事实。
- **降级 B（schema 失败）**：任何 v2 schema parse 失败触发 `protocol.violation` 事件并退回 v1（一次性回退）。
- **降级 C（claims 失败）**：secure-output degraded 时保留正文但阻断“事实已确认”语气。

### E.4 压缩/恢复时序（外置工作记忆专用）

1. 回合开始先写 `anchor-snapshot`，作为本轮恢复基准。  
2. 每次检索前写 `probe-journal`，检索后写 `progress-ledger`。  
3. 若触发 compaction，落 `resume-checkpoint`（V2）并写入 `ContextLedger`。  
4. 恢复时先比对 `anchorHash`：
   - 一致：允许 delta resume；
   - 不一致：`fail-closed`，主脑强制 unknown-first。  
5. 任一阶段报错按 `fallback-dag`（V2）执行，不允许自由重试。

- **[推断]** 该时序将“压缩恢复”从最佳努力提升到可审计的一致性流程。

---

## F. P0/P1/P2 执行计划（每项含收益/风险/成本）

### F.1 P0（7天止损，含阻断项）

#### F.1-A P0-A（7天阻断，未完成不得进入 Stage1）

**P0-A 阻断项（必须全部达成）**：
1. `secure-output` 合同到达链路修复 + claims 映射闭环。  
2. 模式主路拍板并在代码路径强约束：`write/exec -> fork`。  
3. 指标可观测性就绪：灰度阈值指标必须有埋点和产物落盘。  
4. 外置工作记忆 V1 地基完成：`anchor-snapshot + probe-journal + progress-ledger` 三件套可回放。  
5. 20 条离线回放门禁通过。

| 任务 | 交付物 | 收益 | 风险 | 成本 |
|---|---|---|---|---|
| P0-A1（原 P0-1）修复 `secure-output` 合同到达链路 | prompt snapshot + 修复说明 + 回放证据 | 直接提升 claims 合同生效率 | provider 差异导致兼容成本 | 1.5 人日 |
| P0-A2（原 P0-2）模式主路固化（`write/exec -> fork`） | 路由决策表 + 门禁测试 | 消除 heavy/fork 双栈冲突 | 错配可能影响旧流程 | 1 人日 |
| P0-A3（原 P0-6）claims 映射闭环（E# -> pointers） | claims map 规则 + 守卫前自检 | 提升 secure_output 通过率 | 旧回答模板需适配 | 1.5 人日 |
| P0-A4（原 P0-8）观测先行（埋点与聚合） | `worker-turn-summary.json` + 指标事件字段 | 灰度可判定、回滚可自动化 | 事件字段一致性改造 | 1.5 人日 |
| P0-A5（原 P0-10）20 条回放门禁 | 离线报告 + gate 结果 | 上线前可证实收益 | 样本覆盖不足 | 1 人日 |
| P0-A6（原 P0-11）`anchor-snapshot/1.0` | 固定锚点协议 + 产物 + 事件 | 压缩后可恢复一致性基准 | 锚点字段不全会误判 | 1.5 人日 |
| P0-A7（原 P0-12）`probe-journal/1.0` | 结构化 probe 账本 + dedupeKey 对齐 | 消除“重复探针无感”问题 | 协议迁移成本 | 1.5 人日 |
| P0-A8（原 P0-13）`progress-ledger/1.0` | coverageGain/newEvidence/duplicateProbe 事件 | 把防循环从经验变门禁 | 早期阈值不稳 | 1.5 人日 |

#### F.1-B P0-B（7天增强，可并行；未完成不阻断 Stage1）

| 任务 | 交付物 | 收益 | 风险 | 成本 |
|---|---|---|---|---|
| P0-B1（原 P0-3）定义 `ToolRequestV2` 与 `CriticVerdictV2` | 协议文档 + schema + fixture | 统一协作语义，消除 string query 漂移 | 旧链路兼容复杂 | 2 人日 |
| P0-B2（原 P0-4）broker 产出 `EvidenceBundleV2`（含 snippet/density） | `evidence-bundle` 产物 + rerank 规则 | 直接提升 critic 可判定率 | token 增长 | 2 人日 |
| P0-B3（原 P0-5）注入模板升级为 `orchestrator_evidence_v2` | 注入渲染模板 + 长度约束 | 主脑读到“证据”而非“状态” | 注入过长影响 latency | 1.5 人日 |
| P0-B4（原 P0-7）重跑收敛（幂等键 + maxRerun） | message-level breaker | 降低循环体感和成本 | 过度收敛导致漏召回 | 1 人日 |
| P0-B5（原 P0-9）协议迁移双读双写 | v1/v2 迁移开关 + 切流脚本 | 降低发布风险 | 增加短期复杂度 | 1 人日 |

### F.2 P1（30天内做强闭环）

| 任务 | 交付物 | 收益 | 风险 | 成本 |
|---|---|---|---|---|
| P1-1 多层提示词模板版本化（Role/Constraint/Output/Eval） | prompt registry + version record | 稳定输出格式，减少解析失败 | 提示词维护成本上升 | 3 人日 |
| P1-2 检索链收敛（orchestrator 主链，LLM 检索改补偿链） | 单主链路由开关 +回退策略 | 去除同轮双检索重复成本 | 切换初期可能漏召回 | 3 人日 |
| P1-3 pointerContextOS 语义修复与回归 | 语义测试 + 开关验证 | 提升工作集指针有效性 | 涉及历史开关兼容 | 1.5 人日 |
| P1-4 评测体系扩展到 50 条样本 | replay suite + nightly gate | 可持续量化优化收益 | 标注成本 | 3 人日 |
| P1-5 线上灰度看板 | dashboard + alert | 实时判定是否回滚 | 指标噪声 | 2 人日 |

### F.3 P2（>30天体系化）

| 任务 | 交付物 | 收益 | 风险 | 成本 |
|---|---|---|---|---|
| P2-1 freshness 服务（时效性评分） | freshness metadata | 降低旧证据误用 | 数据治理复杂 | 高 |
| P2-2 LC/RAG 混合路由 | 自路由策略 | 质量/成本折中最优 | 路由误判 | 中-高 |
| P2-3 自动策略学习（基于指标调参） | auto-tuning pipeline | 长期性能上限提升 | 回归难度上升 | 高 |
| P2-4 存储分层迁移（`L0/L1/L2`） | storage adapter + dual-write 迁移手册 | 兼顾可调试性与商业化可治理性 | 迁移期间一致性风险 | 中-高 |
| P2-5 本地安全与留存治理 | 权限基线 + retention job + 导出审计策略 | 降低本地泄露与遗留数据风险 | 跨平台行为差异 | 中 |

### F.4 外置工作记忆 V1/V2（商业级路线，禁止半成品）

#### V1（生产可用地基，2~3 周）

- 目标：把 4 件套固化为主链协议，做到“可追溯、可恢复、可收敛”。
- 必交付：
  1) `anchor-snapshot/1.0`；
  2) `probe-journal/1.0`；
  3) `progress-ledger/1.0`；
  4) 双检索链收敛开关（主链+补偿链）；
  5) 20 条离线回放 + Stage0 shadow 24h 全通过。
- 商业门槛：未达 `metrics_coverage_rate=1.00` 与 `secure_output_pass_rate>=0.95` 不得进入 Stage1。

#### V2（商业级增强，4~6 周）

- 目标：把 4+3 完整闭环化，具备 deterministic resume 与失败分层回退能力。
- 必交付：
  1) `resume-checkpoint/2.0`（anchorHash 校验）；
  2) `fallback-dag/2.0`（错误码到回退路径）；
  3) 进度单调性自动断路（无增益停止）；
  4) 50 条 nightly 回放 + 线上自动回滚联动；
  5) `L0/L1/L2` 存储策略灰度 + 双写对账。
- 商业门槛：连续 2 个发布窗口满足所有灰度指标且无 P0 事故，才可认定“商业级生产”。

---

## G. 指标与门禁（离线+线上）

### G.1 离线门禁（发布前）

| 指标 | 定义 | 阈值 | 说明 |
|---|---|---|---|
| `evidence_density@5` | top5 中“正文型 snippet”占比 | >= 0.80 | 防止路径噪声 |
| `critic_degraded_rate` | critic degraded / critic total | <= 0.15 | 核心稳定性 |
| `claim_pointer_valid_rate` | fact claims 中可校验 pointer 占比 | >= 0.95 | 守卫闭环 |
| `rerun_count_per_message` | orchestrator.planned-1 | <= 2 | 收敛性 |
| `secure_output_pass_rate` | secure_output.completed / (completed+degraded) | >= 0.95 | 最终交付可靠性 |
| `metrics_coverage_rate` | 灰度阈值指标中“有埋点+有落盘”占比 | = 1.00 | 无观测不允许灰度 |
| `anchor_replay_match_rate` | 压缩恢复后锚点哈希一致率 | >= 0.99 | 保障恢复一致性 |
| `evidence_gain_per_cycle` | 每轮新增有效证据数（规范化） | > 0（均值） | 防止无效重跑 |
| `duplicate_probe_rate` | 重复 probe / 总 probe | <= 0.15 | 防止重复检索 |
| `resume_success_rate` | 压缩后一次恢复成功率 | >= 0.98 | 商业级稳定性 |
| `ledger_persist_success_rate` | L1 持久账本写入成功率（V2） | >= 0.999 | 商业化可靠性 |

补充基线（当前可见）：
- **[事实]** 最新离线汇总（2026-02-09）显示：`unsupportedClaimRate=0.0338`、`citationIntegrity=0.9725`、`cacheHitRatio=0.768`、`taskCompletion=0.872`（`packages/opencode/offline-eval-summary.md:1-31`）。
- **[推断]** 新协议上线后，`taskCompletion` 不应低于当前基线 -1pp。

### G.2 线上门禁（灰度期）

| 指标 | 观测窗口 | 阈值 |
|---|---|---|
| `worker_lift_rate` | 1h/24h | >= 0.70 |
| `duplicate_retrieval_rate` | 1h | <= 0.15 |
| `p95_latency` | 1h | 不高于基线 +20% |
| `secure_output_pass_rate` | 24h | >= 0.95 |
| `critic_degraded_rate` | 24h | <= 0.15 |
| `anchor_replay_mismatch_rate` | 24h | <= 0.01 |
| `resume_success_rate` | 24h | >= 0.98 |
| `evidence_gain_per_cycle` | 1h | > 0 |
| `ledger_write_fail_rate` | 1h（V2） | <= 0.5% |

### G.3 线上指标口径定义（防“同名不同义”）

1. `worker_lift_rate`（按 message 去重）
   - 公式：`lift = enhanced_messages / eligible_messages`。
   - `eligible_messages`：存在 `orchestrator.planned` 且 `orchestratorEnabled=true` 的 message 数。
   - `enhanced_messages`：同 message 同时满足：
     - `worker-turn-summary.criticFinalStatus == "sufficient"`；
     - 存在 `secure_output.completed` 事件。
2. `duplicate_retrieval_rate`（按 retrieval.started 去重）
   - 公式：`duplicate = duplicate_started / total_started`。
   - `total_started`：窗口内 `retrieval.started` 事件总数。
   - `duplicate_started`：同 `messageId + retrievalCacheKey` 在窗口内出现第 2 次及以上的 `retrieval.started` 计数。

事件来源（固定）：
- `orchestrator.planned`：`packages/opencode/src/session/orchestrator/writer.ts:49-57`
- `orchestrator.worker.lifecycle`：`packages/opencode/src/session/orchestrator/worker-runner.ts:151-190`
- `retrieval.started|retrieval.completed|retrieval.degraded`：`packages/opencode/src/retrieval/runner.ts:392-405,724-745`
- `secure_output.completed|secure_output.degraded`：`packages/opencode/src/secure-output/worker.ts:288-347`

---

## H. 灰度与回滚（触发阈值）

### H.1 灰度节奏

1. **Stage 0（shadow）**：0%用户曝光，跑并行评估 24h。  
2. **Stage 1**：10%流量，观察 48h。  
3. **Stage 2**：30%流量，观察 72h。  
4. **Stage 3**：50%流量，观察 72h。  
5. **Stage 4**：100%全量。

### H.2 自动回滚阈值（任一触发即回滚）

1. `critic_degraded_rate` 相对对照组恶化 **> 5pp**。  
2. `secure_output_pass_rate` 下降 **> 3pp**。  
3. `rerun_count_per_message` 连续 24h **> 2**。  
4. `duplicate_retrieval_rate` 连续 6h **> 15%**。  
5. `p95_latency` 连续 6h **> 基线 20%**。  
6. `anchor_replay_mismatch_rate` 连续 24h **> 1%**。  
7. `resume_success_rate` 连续 24h **< 98%**。  
8. `evidence_gain_per_cycle` 连续 6h **<= 0** 且 `rerun_count_per_message > 1`。  
9. （V2 启用后）`ledger_write_fail_rate` 连续 1h **> 0.5%**。

- **[事实]** 其中前 3 条阈值与既有评审建议一致（`docs/plans/2026-02-10-main-brain-worker-collab-architecture-review.md:166-170`; `docs/plans/2026-02-10-general-cognitive-architecture-and-llm-weaknesses-validated.md:195-199`）。
- **[推断]** 新增 6~9 条是外置工作记忆机制商业化门槛，缺失会导致“恢复失败不可见、循环不可控、持久账本失真”。

### H.3 回滚动作

- 关闭 `evidence_contract_v2`，回退到 v1 注入。
- 保留 `worker-turn-summary` 与新增观测字段（观测不回滚）。
- 触发“失败样本自动归档”进入离线回放池，48h 内完成复盘单。
- （V2 启用后）`ledger_write_fail_rate` 触发时，切回 `L2 manifest-only` 并暂停 L1 持久写入。

### H.4 定版会拍板结果（2026-02-10）

1. **范围冻结**：定版会只审 `P0 阻断 + H 回滚阈值 + I 前5补证优先级`，不扩展到 P1/P2 实现细节。  
2. **P0 阻断维持硬门禁**：四项阻断任一未完成，不进入 Stage1。  
3. **阈值冻结**：`H.2` 当前阈值原值生效；Stage0 仅告警不回滚，Stage1+ 按阈值自动回滚。  
4. **补证优先级拍板**：`I.1 -> I.3 -> I.2 -> I.4 -> I.5`。  
5. **会议产物标准化**：每项决议必须输出 `Owner + DoD + EvidencePath + ETA + RollbackAction`。  
   - 执行卡文件：`docs/plans/2026-02-10-v1_6-blocking-execution-cards.md`

变更规则：若需调整 `P0` 或 `H.2` 阈值，必须附 24h shadow 数据证据并经架构负责人签字。

---

## I. 仍待补证的关键问题清单（避免过度自信）

补证优先级（定版会拍板）：`I.1 -> I.3 -> I.2 -> I.4 -> I.5 -> 其余项`。

1. **`secure-output` 合同链路高风险已确认；待补证的是“失配机理分层”**。  
   - 现状：合同进入 `developerText`，但 system 打包路径未直接消费该块（`packages/opencode/src/session/llm.ts:111,139-147,697-710`）；同时运行态持续出现缺失 claims 的 degraded（`packages/opencode/src/secure-output/worker.ts:110-157`）。  
   - 待补证：区分“合同到达率”与“合同遵守率”的分层统计（prompt snapshot + output snapshot 对账）。

2. **“topK 噪声”的真实构成比例需要样本统计**。  
   - 现状：代码确有 tree/path 注入（`packages/opencode/src/retrieval/code.ts:125-136`）且 topK 最终只取 5（`packages/opencode/src/retrieval/runner.ts:696-699`）。  
   - 待补证：至少 50 条 hits 标注（正文/路径/无效）。

3. **重复 planned 的主因是否来自外层循环，而非 broker 内循环？**  
   - 现状：broker cycle=1（`packages/opencode/src/session/orchestrator/index.ts:424`），但日志里 message 级 planned 可达 6 次（`docs/plans/2026-02-10-v1_6-worker-collab-diagnostic-report.md:68-72`）。  
   - 待补证：message 生命周期级 trace 合并图。

4. **pointerContextOS 开关当前是否实际生效？**  
   - 现状：processor 传 `undefined`，orchestrator 侧 `?? []` 会归零（`packages/opencode/src/session/processor.ts:658`; `packages/opencode/src/session/orchestrator/index.ts:385`）。  
   - 待补证：开关 A/B 回放差异。

5. **patch_planner 是否实质提升复杂写入任务成功率？**  
   - 现状：已具结构化输出，但缺定量 lift 指标。  
   - 待补证：heavy 任务 30 条对照实验（有/无 patch_planner）。

6. **双检索链收敛后是否会带来召回下降？**  
   - 现状：当前确有双链并存（`packages/opencode/src/session/orchestrator/tool-broker.ts:274-279`; `packages/opencode/src/session/llm.ts:322-329`）。  
   - 待补证：召回率与成本双指标对照。

7. **critic 的“sufficient”与最终用户成功是否强相关？**  
   - 待补证：建立 `critic verdict -> task completion` 的相关性回归。

8. **通用认知方案的跨领域有效性仍需外部任务集验证**。  
   - 现状：validated 已将其降级为“工程假设”（`docs/plans/2026-02-10-general-cognitive-architecture-and-llm-weaknesses-validated.md:22-23,57-70`）。

9. **`anchor-snapshot` 的最小字段集合是否覆盖所有 provider 差异场景？**  
   - 待补证：至少 3 种 provider + 2 种 compaction 触发路径的恢复一致性测试。

10. **`evidence_gain_per_cycle` 阈值是否会误伤高难但必要重跑场景？**  
   - 待补证：建立“低增益但最终成功”样本集，评估断路器阈值鲁棒性。

11. **`L0/L1/L2` 双写迁移窗口是否会造成账本一致性撕裂？**  
   - 待补证：设计双写对账任务（同 message 在 L1 与 L2 的 hash 一致性）并做 7 天 shadow。

12. **本地持久层权限策略（700/600）在不同操作系统上的行为是否一致？**  
   - 待补证：macOS/Linux/WSL 三平台权限与可读性回归。

---

## J. 给产品经理的 10 条白话解释（非术语）

1. 现在的问题不是“小脑没干活”，而是“干了活但喂给主脑的证据太稀”。
2. 我们不再追求“多跑几轮”，而是追求“每轮都拿到能下判断的证据”。
3. 以后小脑输出必须是结构化数据，不再靠随意文本沟通。
4. 主脑只能负责说人话，不能自己决定“证据够不够”。
5. 一条消息最多允许有限次重跑，防止界面看起来像死循环。
6. 证据链会收敛成一条主链，避免同一问题重复检索两遍。
7. 最终回答必须附带可核验断言块，否则守卫会降级。
8. 我们先用 7 天止损把体验拉稳，再用 30 天把评测和灰度闭环做实。
9. 灰度不是拍脑袋：三条核心指标一超阈值就自动回滚。
10. 这套方案不是“理论最优”，而是“可验证、可迭代、可上线”的工程最优。

---

## 附：本稿关键代码/文档证据索引

- 诊断回放：`docs/plans/2026-02-10-v1_6-worker-collab-diagnostic-report.md`
- 优化评审：`docs/plans/2026-02-10-v1_6-optimization-review.md`
- 架构评审：`docs/plans/2026-02-10-main-brain-worker-collab-architecture-review.md`
- 通用认知校正版：`docs/plans/2026-02-10-general-cognitive-architecture-and-llm-weaknesses-validated.md`
- 旧总设计：`docs/plans/2026-01-25-opencode-sandbox-context-design.md`
- Orchestrator 主链：`packages/opencode/src/session/orchestrator/index.ts`
- Worker 协议与实现：`packages/opencode/src/protocol/llm-worker-role-pack.ts`、`packages/opencode/src/protocol/llm-worker-result.ts`、`packages/opencode/src/session/orchestrator/workers/`
- Retrieval：`packages/opencode/src/retrieval/code.ts`、`packages/opencode/src/retrieval/runner.ts`
- Secure-output：`packages/opencode/src/session/secure-output-contract.ts`、`packages/opencode/src/secure-output/worker.ts`
- Context Pack：`packages/opencode/src/session/context-pack.ts`、`packages/opencode/src/session/context-pack-cache.ts`
