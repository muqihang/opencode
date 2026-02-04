# 单会话内协作专项：Single‑Session Orchestration（主 LLM + Workers + Tool Broker）设计稿（可落地）

> **定位**：这是一个“避免遗忘”的专项设计稿，用于把 **同一个会话窗口内**的系统内部协作做成“世界级可控”。  
> **对用户呈现**：用户仍然感知为“一个代理”；内部是 **主 LLM（总控）+ 若干小 LLM/worker + 沙盒工具执行器** 的编排。  
> **与并发多会话的关系**：主会话可派发多个子会话并发；但每个子会话内部仍然遵循本稿的单会话协作纪律。  
> **不在本稿实现**：只固化机制、DoD 与可回归指标；实施计划另写。

---

## 0) First Principle（你关心的“质的飞跃”来自哪里）

你强调“哪怕主 LLM 能力一般、上下文只有 128K，也要靠工程手段让质量飞跃”。这类飞跃通常来自 **系统工程纪律**，而不是“再换更强模型”：

1) **把长内容外置为可回放资产**（artifacts/manifest/events），运行时上下文只注入“短且可信的状态 + 指针”  
2) **把事实输出变成可核验的声明**（claims + pointers；缺证据就 unknown/unsupported）  
3) **把重复重活变成可命中缓存**（SSOT cache + provider caching：稳定前缀/差分注入）  
4) **把复杂任务拆成可并行、可审计、可降级的工作单**（orchestrator plan）

因此，本稿不追求“更多 worker”，而追求：

> **Compile once, consume many**：每轮最多编译一次会话状态（capsule/context pack），所有 worker 消费同一份最小输入包（Role Pack），避免重复压缩与漂移。

### 0.1 术语表（避免“同名不同物”导致实现偏差）

为避免实现时把概念混在一起，这里把本稿的关键词先“对齐语义”：

- **Turn（轮次）**：以“用户一条消息”为输入，到“系统产出最终答复（含 tool/worker 过程）”为止的一次处理单元。
- **System modules / Deterministic workers（确定性模块）**：不调用 LLM 的模块（例如 RoutingRunner / RetrievalRunner / CacheStore / Verification 的脚本链路），特点是可回归、可缓存、可审计。
- **LLM workers（模型 worker）**：额外的模型调用（agent-as-tool），用于补主模型短板（不会检索/不会自检/不会收敛范围）。本稿限制它的并发与工具面。
- **Tool Broker（工具代理层）**：不是“又一个工具”，而是 orchestrator/workers 调用工具时的 **统一执行与证据化层**：做白名单校验、预算校验、pointerize 输出、事件化审计。
- **Artifact（产物）**：落盘可回放的数据文件（建议统一进 `.opencode/artifacts/<sessionId>/...`），由 EvidenceWriter 进入 manifest。
- **Pointer（指针）**：引用 artifact 的最小引用单元，至少包含 `path + sha256`，可选 `anchor`（行号/页码/区间）与 `kind`。
- **Capsule**：本仓库里至少存在两类：
  - `<routing>...</routing>`：**路由 capsule（指针清单）**，由 `packages/opencode/src/session/routing-injection.ts` 注入，是“本轮可用线索”的 pointers。
  - `compaction capsule`：**历史压缩 capsule（结构化摘要）**，由 `packages/opencode/src/session/compaction.ts` 产出，用于长会话收敛。
- **Mode 命名注意**：仓库里 `Agent.Info.mode` 是 `primary|subagent|all`（谁能被调用的身份属性）；本稿的 `orchestratorMode` 是 `chat|assist|heavy|fork`（本轮协作策略）。两者不要复用同名字段。

### 0.2 一句话版本（给产品经理/负责人）

- 我们现在要做的是：在“一个聊天窗口”里，助手先用几个“后台小脑”快速把问题拆清楚、补齐证据缺口、输出一个可执行计划；但这些“小脑”不允许直接动手（不跑命令不改代码），所以成本低、速度快、结果稳定。
- 真正需要动手（改文件/跑测试/高风险操作）时，才把任务派到“子会话窗口/工单窗口”去执行，保证隔离与审计。

### 0.3 与 `oh-my-opencode` 的兼容策略（先基座、后插件）

本专项会同时提到两种“协作”，它们不是同一个概念，也不是二选一：

- **单会话内协作**：主 LLM + 内部 workers + Tool Broker（同一会话/同一沙盒）。worker 只负责“拆解/补证据/出计划”，**不允许直接动手**（不跑命令不改代码、不 ask 权限、不直接用工具）。
- **多会话派工（子会话执行）**：通过 `tool:task` 创建子会话/子沙盒去执行写入/运行/长耗时链路，获得更强隔离与审计。这是 `orchestratorMode=fork` 的核心落地点：父会话做计划与验收，子会话做执行。

为了与 `oh-my-opencode` 这类“上层多智能体编排插件”兼容，我们采用 **先基座、后插件** 的路线：

1) `opencode` 基座先把 SSOT 的协议/产物/事件链路做稳（可回放、可回归、可灰度）。  
2) 插件后续再针对性适配这些“稳定接口”，而不是反过来让基座追着插件策略漂移。

同时，为避免出现“双重派工/抢方向盘”（基座与插件都尝试创建子会话），基座必须提供一个显式开关来决定“fork 时由谁负责实际派工”：

- `forkStrategy=auto`：基座在 `orchestratorMode=fork` 时自动调用 `tool:task`（必须走 `PermissionNext.ask`；失败/拒绝则降级为“提示式派工”短模板 + `orchestrator.degraded` 事件，不中断主流程）。
- `forkStrategy=suggest`：基座只产出“提示式派工”+ plan/evidence 的结构化指针，不自动 `tool:task`；由插件（如 `oh-my-opencode`）接管派工与多会话编排。
- `forkStrategy=off`：禁用 fork 派工（调试/灰度用）。

落地建议：先用 env/flag 承载（例如 `OPENCODE_ORCHESTRATOR_FORK_STRATEGY=auto|suggest|off`），默认 `auto` 跑通闭环；当插件要接管多会话编排时切到 `suggest`。

---

## 1) 仓库现状（P3 之后已具备的“地基”）

> 以代码事实为准：我们不是从 0 开始，而是在已存在的 SSOT/事件链路上把“协作控制平面”系统化。

已经具备（或近似等价）的能力：

- **Context Pack 确定性**：ContextBlocks → ContextPack，稳定 fingerprint/cacheKey、事件化 `context.pack_built`。
- **SSOT CacheStore**：本地 memory+disk、TTL/LRU、可解释命中原因、事件闭环 `cache.*`。
- **Secure-by-default 输出门禁**：结构化 claims（side-channel）+ verifier；缺证据明确降级。
- **Verification / Toolbelt**：可执行核验链（证据断链/引用锚点/策略）。
- **RoutingRunner**：可并行 worker A/B/C（repo/kb/graph），有预算、timeout、cache key 与 capsule artifact 注入（注意：这里的 `<routing>...</routing>` capsule 是“路由指针”，不是“历史压缩 capsule”）。
- **Compaction（结构化产物）**：已有 `compaction.*` 事件与 artifacts（capsule/facts/report），可回放。
- **Offline evals**：最小离线回归护栏（routing/retrieval/证据断链）。

缺口：这些“模块能力”已经很强，但“单会话内如何按需启用、如何控预算、如何控并发、如何保证输入稳定”仍然依赖隐式逻辑/经验。

### 1.1 “Workers”有两类：Routing Workers ≠ LLM Workers（避免概念冲突）

你提到的“Worker 1/2/3 可插拔”“pdf 解析/rg 搜索/py 执行”等，在仓库里确实已经存在，但**它们分属两条线**：

1) **Routing Workers（确定性/系统模块）**  
`packages/opencode/src/routing/runner.ts` 会并行跑 `worker_a_repo / worker_b_kb / worker_c_graph`，产出 routing capsule artifacts 与 cache key。  
它们的特点是：**不调用 LLM、可回归、可缓存、成本可控**，更像“确定性 worker/模块”，不是“LLM 小模型 worker”。

2) **LLM Workers（模型调用/agent-as-tool）**  
本稿第 5/6 节定义的 Retrieval Planner / Evidence Critic / Patch Planner 属于这一类。  
它们的特点是：**会增加额外模型调用**，因此必须严格 gating、预算、一次回填、只读工具白名单。

> 结论：两类 workers 不冲突，反而是互补：  
> **确定性 worker 负责“稳定输入与证据化产物”**，LLM worker 负责“补弱模型短板（不会问/不会检索/不会自检）”。

### 1.2 你看到的“设计了但没实现”不是遗漏：是“可插拔能力”未配置/未落地

以 routing 的三个 worker 为例（代码事实）：

- `worker_a_repo`：已实现，但目前是 **repo 文件树扫描**（Bun.Glob），尚未达到老设计稿里“LSP/symbol/snippet 指针化”的完整形态。
- `worker_b_kb`：目前明确返回 `unavailable("kb not configured")`（需要 KB 数据源/索引才能启用）。
- `worker_c_graph`：目前明确返回 `unavailable("graph not configured")`（需要 graph 数据源/索引才能启用）。

这属于**工程上的刻意取舍**：先把协议/缓存/证据链跑通，预留接口；没有 KB/Graph 的运行环境时就不强行“伪实现”。

### 1.3 为了愿景目标，本专项是否要“把 B/C 也实现”？

按“质量/性能/稳定第一”最佳实践，我建议**把目标拆成两层**，都写进调优增强阶段（不与本稿冲突）：

- **层 1（必须做，低风险高收益）**：升级 `worker_a_repo` 的产物质量  
  - 增加“指针化 snippets（artifact + sha256 + anchor）”的输出能力（不再只给 file list）  
  - 能用 LSP 就补充 symbol 线索；没有 LSP 就退化为 tree/rg（仍然指针化）

- **层 2（可选但建议做，保持无外部依赖）**：提供 `worker_b_kb` / `worker_c_graph` 的 “lite” 版本  
  - `worker_b_kb`（KB-lite）：不依赖外部 KB，先用现有 RetrievalRunner 对 `docs/`、workbench 派生资产与计划文档做“本地 KB”检索；未来再接入真正的 KB（pgroonga/qdrant/rrf）  
  - `worker_c_graph`（Graph-lite）：不依赖 Neo4j，先做“本地依赖/影响图（import graph）”近似（以 JS/TS import/exports 与文件路径为节点），并严格预算/超时降级

这样能满足你“做完、不遗留”的心智模型，同时不会把本专项绑死在重型基础设施（KB/Graph 服务）上。

---

## 2) 目标与非目标

### 2.1 目标（DoD 方向）

- **默认轻量**：闲聊/轻任务不启用 LLM worker，不引入额外模型调用与延迟。
- **按需增强**：复杂/高风险/工具密集任务，按可解释规则启用 1–2 个 LLM worker（只读），并写入审计事件。
- **稳定优先**：不允许 LLM worker 自行 compaction；不允许 LLM worker 随意拼 prompt；不允许无限回合的“worker↔工具↔worker”循环。
- **可审计/可回放**：每次协作都能导出证据包说明“系统做了什么、为什么这么做、失败如何降级”。
- **可回归**：有离线 eval 与 deterministic tests，避免迭代后悄悄变慢/变宽松/变不可信。

### 2.2 非目标（避免范围失控）

- 不在本稿引入跨会话长期记忆（memory）与训练数据治理（另立专题）。
- 不承诺所有任务都“更快更省 token”；目标是 **平均更稳、更可信**，并对高价值任务提供可解释增强。
- 不让 **LLM worker** 获得写权限（文件写入/执行高风险命令）作为默认能力。

---

## 3) 核心设计：Orchestrator Control Plane（每轮一张可审计工作单）

### 3.1 Orchestrator Plan（结构化 + versioned）

每次用户消息进入主流程前，系统生成一个 `orchestrator.plan.json`，并写事件 `orchestrator.planned`：

- `specVersion: orchestrator-plan/1.0`
- `orchestratorMode`: `chat | assist | heavy | fork`
- `uxMode`（会话级偏好）：`fast | auto | deep`（决定 gating 的“偏好/阈值”，但不直接等同于 `orchestratorMode`）
- `workers[]`: 本轮要启用哪些 **LLM worker**（最多 2 个）
- `budgets`: `maxWallClockMs` / `workerTimeoutMs` / `maxOutputTokens` / `maxToolCalls`
- `mainTools`（可选）：本轮允许主 LLM 直接调用的 tool ids  
  - `mainTools: null` 或缺省：不覆写当前默认工具集（避免“chat 变弱”造成行为回退）  
  - `mainTools: []`：强制本轮主 LLM 不用工具（只做对话/总结），由系统模块先行完成检索/核验等  
  - `mainTools: ["read","glob",...]`：显式允许子集（实际生效应与 user/agent permission 做交集）
- `evidencePolicy`（可选）：本轮输出门禁/核验策略（示例）  
  - `enabled: boolean`（是否启用门禁；chat 默认不额外启用）  
  - `mode: strict | balanced | loose`
- `toolPolicy`: **LLM worker** 可用的只读工具白名单（详见 5）
- `reasons[]`: 可解释理由（来自确定性信号，或来自 LLM triage 的结构化理由）
- `inputsFingerprint`: stableJson + sha256（可用于 cache/回归）

> 关键点：plan 是 SSOT。没有 plan 就不“偷偷启用 worker”。出问题时能复盘“为什么派工”。

建议在落地时补齐两个“工程必需字段”，让回放与回归更稳：

- `orchestratorPlanId`：ULID（用于事件串联、UI 展示、日志检索）
- `inputsFingerprint` 的 payload 里显式包含：`sessionId/messageId/workspaceFingerprint/toolsetFingerprint/uxMode/evidencePolicy`（避免同 hash 不同语义）

> 设计原则：**plan 可以是“建议”，但必须可解释且可复现**。  
> “可复现”的最低门槛：同一输入特征 → 同一 plan（或同一 plan 的 hash）。

示例（精简版，便于实现对齐）：

```json
{
  "specVersion": "orchestrator-plan/1.0",
  "orchestratorPlanId": "01J...ULID",
  "sessionId": "<sessionId>",
  "messageId": "<messageId>",
  "uxMode": "auto",
  "orchestratorMode": "assist",
  "workers": [
    { "id": "retrieval_planner", "model": "small", "budget": { "timeoutMs": 1500 } }
  ],
  "budgets": {
    "maxWallClockMs": 8000,
    "workerTimeoutMs": 1500,
    "maxOutputTokens": 32000,
    "maxToolCalls": 4
  },
  "mainTools": ["read", "glob"],
  "evidencePolicy": { "enabled": true, "mode": "balanced" },
  "toolPolicy": { "allowed": ["retrieval", "read", "glob", "verification"], "bounceMax": 1 },
  "reasons": [{ "code": "needs_retrieval", "message": "问题涉及仓库事实，需要检索与引用指针" }],
  "inputsFingerprint": { "sha256": "sha256(stableJson(features))" }
}
```

### 3.2 默认并发策略（质量/性能/稳定第一）

对 “LLM workers（模型调用）” 的并发上限建议定死为：

- **默认并发上限：2 个 LLM worker/turn**（不含主 LLM 本身）
- **默认 0 LLM worker**：`orchestratorMode=chat` 时永不派工
- **允许临时升到 3**：仅当 `orchestratorMode=heavy` 且明确是“研究/多源对账/大量证据核验”类任务，并且必须写明 `reasons[]`（否则拒绝）

理由（务实）：你们已经存在并行模块（routing A/B/C、retrieval、verification、cache/compaction）。如果再把 LLM workers 并发开太大，会出现“并行越多越慢”的反效果。

---

### 3.3 主 LLM 的 Tool Gating（同样按需，避免“工具越多越乱”）

本专项的一个核心观点是：**不仅 worker 要受限，主 LLM 的工具面板也要按需缩小**。否则在通用场景里，主 LLM 很容易“为了图省事”走捷径（例如直接 grep 粘贴结果），反而破坏证据链与长会话稳定性。

推荐默认策略（可落地且可回归）：

- `orchestratorMode=chat`：默认 **不覆写**（`mainTools: null`），保持现有体验；但在实现上把“更强约束”留给 assist/heavy/fork（避免无 UI 时 chat 直接变弱）
- `orchestratorMode=assist`：`mainTools` 只允许“读侧/解释侧”工具（例如 read/glob）；检索与核验优先由系统模块先做，然后把 pointers 回填给主 LLM
- `orchestratorMode=heavy`：仍以“系统模块先行”为主；只有当确实需要主 LLM 交互式探索时才开放更多 tool ids，并把开放理由写入 `reasons[]`
- `orchestratorMode=fork`：父会话 `mainTools` 仍保持只读；任何写入/执行链路都在子会话里运行（父会话只负责计划与验收）

> 这条与“把一般模型托举到更强代理能力”并不矛盾：弱模型最缺的不是“更多工具”，而是“更稳的输入与更少的错误自由度”。

### 3.4 Turn Pipeline（建议执行顺序与落盘资产）

本专项要解决的不是“能不能并发”，而是“并发后还能不能 **回放/复盘/回归**”。因此建议把一次 turn 固化成下面这个顺序（每一步都有落盘资产）：

1) **Feature Extract（确定性）**：从 user message 提取 `intentText + features`（写入 `orchestrator.features.json`，供回归与解释）
2) **Plan（确定性优先，可选 triage）**：产出 `orchestrator.plan.json` + `orchestrator.planned` event（SSOT）
3) **Deterministic Modules（按需）**：  
   - `RoutingRunner`（首轮/需要时）：产出 `<routing>` pointers（已在 `packages/opencode/src/session/routing-injection.ts` 有落地）  
   - `RetrievalRunner`（需要仓库事实/资产引用时）：产出 retrieval artifacts + evidencePointers（已被 ContextPack 注入证据段）  
   - `Verification`（strict/balanced 时按需）：产出 report/view artifacts（已有 worker）
4) **Role Pack Build（确定性）**：把本轮“可消费输入”收敛成 Role Pack（短、稳定、指针化）
5) **LLM Workers（按 plan 执行）**：每个 worker 只做一件事；输出严格 JSON；写入 `worker.*.json` artifacts + events
6) **Tool Broker（如有 toolRequests）**：只读白名单 + 预算；执行结果必须 pointerize 并进入 manifest；最多 1 次回填
7) **Main LLM（受 mainTools 约束）**：消费 pointers + 小摘要，产出答复草稿（必要时附带 claims block）
8) **Secure Output Gate（按策略）**：事实断言缺证据则降级；把核验结果写入 evidence pack（已存在 `secure-output` worker）

> 实现上的“黄金法则”：**同一 turn 里所有 LLM（主 LLM + LLM workers）都只消费 Role Pack + pointers**，不要各自拼历史、各自 grep、各自压缩。

## 4) 如何决定启用 worker：关键字不够，但“纯 LLM 判断”也不稳

你提出的点是对的：通用场景下，仅靠关键词（引用/证据/合同）不够覆盖；但完全依赖 LLM 判断会带来不稳定与不可回归。

推荐 **混合 gating（deterministic first + LLM triage as fallback）**：

### 4.1 Stage 0：确定性规则（快速、可回归）

先用便宜且可解释的信号做明显分流：

- `orchestratorMode=chat`：短消息 + 无工具意图 + 低风险 → 0 LLM worker（只跑现有系统模块）
- `orchestratorMode=assist`：需要检索/需要核验/需要总结资产 → 1 LLM worker（通常是 retrieval planner 或 evidence critic）
- `orchestratorMode=fork`：涉及写文件/大改动/跑测试/长耗时工具链 → 派子会话（多会话并发），单会话仅做只读准备

补充：Stage 0 的“确定性信号”建议在实现时显式定义一个 `features` 结构，并作为 `inputsFingerprint` 的一部分写入 artifacts（否则回归时很难解释漂移）。示例：

- `features.uxMode`（Fast/Auto/Deep）
- `features.intentBytes / intentTokensEstimate`
- `features.hasFileParts`（workbench ingest 是否发生）
- `features.hasWriteIntent`（出现 edit/write/apply_patch 等强信号）
- `features.hasExecIntent`（bash/python 等强信号）
- `features.hasVerificationIntent`（引用/证据/核验/对账）
- `features.parentSessionId`（是否 child session）

### 4.2 Stage 1：LLM triage（只在“规则不确定”时启用）

当 Stage 0 判断不确定（例如复杂度分数在阈值区间），调用一个“小模型”做 triage，但强制：

- 输出必须是 `orchestrator-plan/1.0` 的严格 JSON（schema-first）
- `orchestratorMode/workers/budgets` 只允许枚举值（防止“发挥”）
- triage 结果只作为建议；若与安全/预算冲突则降级回 Stage 0

这样能覆盖“通用场景复杂多样”的问题，同时保持稳定与可回归。

> 决策记录：开发/测试阶段 triage/worker 统一使用 `GLM4.7 Flash`（API）。后续自部署候选另议。

### 4.3 Stage 2：可缓存（降低额外开销）

LLM triage 的输入是稳定特征（intent fingerprint / policy / workspace fingerprint / toolset fingerprint），输出 plan 可接入 CacheStore（命中时不再重复 triage 调用）。

---

## 5) Worker = “带脑子的只读工具”（agent-as-tool），但要被工程化约束

### 5.1 Role Pack（LLM worker 的最小输入）

给 worker 的输入不是“整段历史对话”，而是一份可审计、短小、稳定的 Role Pack：

- `specVersion: worker-role-pack/1.0`
- `planPointer`（指向 `orchestrator.plan.json`，保证 worker 输入可回放）
- `goal` / `constraints`
- `openQuestions[]`
- `workingSet.pointers[]`（稳定排序；指针化，不粘贴大段原文）
- `policy`（strict/balanced/loose + 必须 unknown 的规则；注意：当前仓库里 secure-output 默认对 build agent 走 balanced）
- `budget`（time/token/tool-call 上限）
- `task`（worker 的单一职责描述：例如“只输出检索 query 列表与预期命中文档类型”）

### 5.2 输出协议（LLM worker 的最小输出）

worker 输出必须是结构化 JSON：

- `specVersion: llm-worker-result/1.0`
- `workerId`
- `status: ok | degraded | timeout | cancelled`
- `candidates[]`（每条候选必须有 pointers 或标 unknown）
- `toolRequests[]`（可选；只读工具请求，见下节）
- `notes[]`（可选；严格限制长度）

### 5.3 Tool Broker（只读工具白名单 + 一次回填）

即便 **LLM worker** 可以“使用工具”，也不应直接执行，而是：

1) LLM worker 输出 `toolRequests[]`（结构化）
2) Tool Broker 校验白名单与预算后执行
3) 执行结果落 artifacts/events，并将 pointers 回填给主 LLM（或回填给 LLM worker，仅允许 1 次）

只读工具白名单（示例，具体按仓库工具集对齐）：

- 文件读取（ReadTool）/读取 artifacts（不写文件；默认只读）
- **检索（优先）**：RetrievalRunner（内部可用 `rg/lsp/tree`，并且会把命中写成 **snippet artifacts + manifest pointers**）
- **核验（按需）**：Verification runner（输出 report pointers；失败可降级但必须事件化）

禁止项：

- 写文件/应用 patch/运行高风险命令/网络写入（默认禁止；需要写入时走子会话并受权限门禁）

补充（关键工程约束）：LLM worker 侧发起的 toolRequests **不应触发交互式 ask**（否则就把“可回归系统流程”变成了“随机的人机交互流程”）。推荐策略：

- Tool Broker 对所有 toolRequests 采用 **non-interactive policy**：只走白名单 + 规则判定；不满足就返回 `rejected` 并事件化
- 任何需要用户确认/写入/外部目录/网络的请求，一律升级为 `orchestratorMode=fork` 的子会话执行（由父会话呈现“为什么需要确认/怎么降级”）

补充（你关心的“允许工具增强小脑”的边界）：

- LLM worker **不允许直接执行工具**（例如直接调用 `grep/rg/bash/python`），但**允许通过 Tool Broker 间接“使用工具结果”**：  
  worker 输出 `queries[]/toolRequests[]` → Tool Broker 执行（只读白名单）→ 返回 pointers+summary → 主 LLM/worker 消费。
- `rg` 的正确归属仍是系统检索层：worker 不跑 `rg`，而是请求 Tool Broker 调用 `RetrievalRunner`（其内部可用 `rg/lsp/tree`，并且输出会被 pointerize）。

### 5.4 “rg/grep”归属决策（质量/性能/稳定第一）

你问过一个关键问题：**rg 搜索到底是主 LLM 用，还是 worker 用？**

这里按我们“超高上下文 + 近 0 幻觉 + 命中缓存 + 托举弱模型”的目标，做一次明确定案：

**决策 D‑SEARCH‑1（默认路径）：搜索属于系统检索层，不属于 LLM 工具层。**

- 任何“为了回答/写代码而搜索仓库内容”的动作，默认走 **RetrievalRunner**（它内部会用 `rg`，但输出是 **指针化 hits**，而不是把 `rg` stdout 粘进上下文）
- worker 只负责“提 query/提过滤条件/提期望命中类型”，不直接跑 `rg`
- Tool Broker 执行检索并回填 pointers；主 LLM 只消费 pointers + 小摘要（可回放）

**原因（为什么这条是世界级、且务实）：**

- **稳定**：RetrievalRunner 有预算/去重/多源（rg+lsp+tree）与可回放 artifacts，LLM 工具 `grep` 的 stdout 难以审计也难缓存。
- **省 token**：返回 pointers，而不是把 100 行 grep 输出塞进 prompt。
- **低幻觉**：pointer → manifest → artifact 是可核验链路；stdout 粘贴很容易“引用不清/断链”。
- **弱模型更容易被托举**：弱模型“读指针摘要做归纳”比“读大段杂乱 grep 输出”更不容易跑偏。

**决策 D‑SEARCH‑2（`grep` 工具定位）：保留为交互/调试工具，不进入默认 orchestrator/workers 流程。**

- `packages/opencode/src/tool/grep.ts` 当前返回的是人类可读文本（文件路径 + 行号 + 行内容预览），它适合“开发者调试/临时查找”，但不适合“证据链/长会话 SSOT”
- 所以：**主 LLM 与 worker 在默认流程中不应直接依赖 `grep` 作为事实依据**（除非它的输出被再加工为 artifacts/pointers）

**决策 D‑SEARCH‑3（后续增强，进入调优实现范围）：为 `grep` 增加“指针化输出模式”，但不破坏现有交互体验。**

推荐实现策略（不在本稿实现，但本稿把方向锁定）：

- `grep` 新增 `outputFormat: "text" | "pointers"`（或由 Tool Broker 强制覆写为 `pointers`）
- `outputFormat="pointers"` 时：
  - 把匹配结果写入 `retrieval-snippet` 或 `tool-output` 类 artifacts（每个文件一段或按 topK 聚合）
  - 返回 `{ pointers[], summary }`（主 LLM/worker 只消费 pointers；GUI 默认只展示 summary）
- `outputFormat="text"` 保持当前行为（不破坏 CLI/TUI 的可用性）

> 这条让我们能同时满足：GUI 的“默认不暴露压缩/工程术语”，以及工程侧的“证据链可回放”。  
> 同时它不强迫所有用户/所有场景改变工作方式（质量/性能/稳定优先）。

### 5.5 工具是否“够用”？结论：够用，但需要“证据化/指针化”的最后一公里

你问“沙盒里工具是否配齐了”，按现状可以分两类回答：

**已经具备的关键能力（对愿景最关键）**：

- **强 Python 执行（且证据化）**：`python` tool 会把 input/output/环境信息写入 artifacts 与 events（适合核验链、可回放）。
- **强 Bash 执行（沙盒化 + 大输出指针化）**：`bash` tool 通过 SandboxRunner 执行，并在输出过大时返回 artifacts 指针（避免塞满上下文）。
- **rg（但以“系统检索层”的方式使用）**：RetrievalRunner 内部用 `rg/lsp/tree`，输出是 snippet artifacts + pointers（省 token、低幻觉）。
- **workbench 资产派生**：PDF/DOCX 等会派生结构化资产（可被检索/引用）。

**仍需补齐的“世界级可控”最后一公里（高优先级）**：

- **把“工具输出”统一纳入 SSOT 证据链**：  
  目前像 `grep/websearch/codesearch/glob/read` 这类工具，多数返回的是“人类可读文本（或直接返回片段内容）”，不天然进入 `artifacts/manifest`。  
  对长会话/近 0 幻觉而言，我们需要的是：**工具输出 → artifact → pointer → 进入 Role Pack/claims 的可核验链路**。

落地方式建议（仍保持默认体验不变）：

- Tool Broker 负责“pointerize”：当工具被 orchestrator/workers 流程调用时，把输出落盘为 artifact，并只回填 pointers + summary。  
- 交互模式（CLI/TUI）仍可保留原样的 text 输出，避免体验倒退。

### 5.6 LLM worker 的实现选型（已定案：选 A，避免走 `LLM.stream`）

> 背景：我们产品已经具备“主会话派发子会话并发执行”的能力。  
> 本节讨论的是 **单会话内部** 的“小 LLM workers”怎么实现，目标是：低延迟、可回归、不绕开 Tool Broker。

我们这里把“同 session 内额外模型调用（选 1）”再细分成两种实现方式：

- **A) Internal Worker Runner（推荐 & 已定案）**：用 `generateObject/streamObject + zod schema + CacheStore + EvidenceWriter` 实现 worker，不走 `LLM.stream` 主链路。  
  - worker 输入：Role Pack（短、稳定、指针化）  
  - worker 输出：严格 JSON（schema-first），写入 `orchestrator/<planId>/workers/...` artifacts  
  - worker 不拥有工具；如需检索/核验只能输出 `toolRequests[]/queries[]`，由 Tool Broker 执行并 pointerize

- **B) 复用 `LLM.stream`，为 worker 增加“禁用 retrieval/context-pack/toolset”的开关**：让 worker 像一次“小对话”一样走完整 prompt 管线，只是试图关闭其中一部分能力。

选择 A 的原因（工程视角）：

1) **避免隐式副作用**：当前 `LLM.stream` 会基于 user 文本自动触发 `runRetrieval` 并构建/落盘 ContextPack（见 `packages/opencode/src/session/llm.ts`）。  
   worker 走 `LLM.stream` 会导致“一个 turn 里多个 worker 重复检索/重复打包”，成本与延迟会线性上升，且 artifacts 变乱。

2) **降低耦合与回归风险**：B 需要侵入式改造 `LLM.stream` 的参数与行为（加 disable flags），很容易影响主对话路径（缓存命中、provider 适配、工具集、telemetry）。  
   A 把 worker 与主链路解耦，迭代 worker prompt/schema 不会动到主聊天链路。

3) **更符合“Tool Broker 控制面”**：A 天然把“脑力（LLM）”与“手脚（tools）”分开，worker 不直接动工具；Tool Broker 才是唯一工具入口，便于做到 non-interactive、pointerize、bounceMax=1。

4) **仓库已有成熟范式可复用**：`CapsuleAssistedRunner` 已经按 A 的模式落地（schema-first + CacheStore + EvidenceWriter + verifier + degraded），可直接作为模板（见 `packages/opencode/src/session/capsule-assisted.ts`）。

对 PM 的解释（为什么 A 更稳）：

- **A** 像“填一张表单问后台专家要点”：输入很短、输出是结构化清单、不会顺手去跑命令，所以快、稳定、可控。  
- **B** 像“让后台专家重新开一段完整对话，但要求他别点某些按钮”：规则多、容易漏、容易产生意外副作用，后续维护成本高。

---

## 6) 三个最值钱的 LLM worker（先做这 3 个就能托举弱模型）

> 不追求“多”，追求“对弱模型最补短板”的 3 个。

1) **Retrieval Planner**  
输出：`queries[]`（topK、预期命中来源、期望 anchor 类型）  
价值：弱模型常常“不会问/不会检索”，这能显著提高命中与质量。

2) **Evidence Critic**  
输入：主回答草稿（或计划）+ pointers 摘要  
输出：哪些句子需要证据、缺哪些 pointers、哪些措辞像事实但无证据  
价值：把“幻觉风险”变成清单，提前收敛，不等事后降级。

3) **Patch Planner（只做计划，不写代码）**  
输出：最小变更步骤、涉及文件列表、建议跑哪些测试  
价值：弱模型写代码易发散；先把范围收敛到可验收的计划。

---

## 7) 证据链与 UI（默认轻量、失败才展开）

### 7.1 建议事件

- `orchestrator.planned`
- `orchestrator.worker_started` / `orchestrator.worker_completed` / `orchestrator.worker_degraded` / `orchestrator.worker_timeout`
- `orchestrator.tool_request` / `orchestrator.tool_result`（payload 只含 summary + pointers）

### 7.2 GUI 呈现原则

- 默认不暴露工程术语（token/上下文窗口/压缩细节）
- 只展示人话：例如“正在检索资料”“正在核验引用”“正在生成修改方案”
- 失败自动展开：给出可操作建议（重试/禁用增强/切换模式），并提供审计详情（pointers/manifest）

---

## 8) DoD（可验收）

- 用户侧可选择 `Fast/Auto/Deep`（会话级），并能在审计事件/plan 中看到本轮决策如何受其影响（可解释）。
- `orchestratorMode=chat` 时：0 LLM worker、0 triage 额外调用；不强制收紧主 LLM 工具集（避免无 UI 时行为回退）
- `orchestratorMode=assist/heavy` 时：最多 2 个 LLM worker 并发（可观测、可解释）
- LLM worker 只读工具：无写入副作用；所有输出均证据化（artifacts + events）
- `evidencePolicy` 可回放：assist 默认 balanced、heavy 默认 strict、chat 默认不额外启用；缺证据的事实断言必须 unknown/降级（不可“装作知道”）
- 离线 eval 可回归：同一输入在相同 repo/worktree/policy 下，orchestrator plan 不漂移（hash 断言）

---

## 9) 后续落地建议（实现顺序）

1) 先实现 Stage 0（纯确定性 orchestrator plan）+ 事件化（不引入任何新 LLM 调用）  
2) 再引入 Stage 1（LLM triage，schema-first，cacheable）  
3) 先落地 1 个 worker（Retrieval Planner），验证收益与回归  
4) 再加 Evidence Critic（与 secure-output/verifier 联动）  
5) 最后加 Patch Planner（配合子会话写入/合并机制）

---

## 10) 关键决策一览（已定案，实施阶段按此执行）

- **D‑MODE‑NAME**：本稿的 `orchestratorMode` 与仓库 `Agent.Info.mode` 语义不同，字段名不得复用。
- **D‑MODE‑UX**：用户侧提供 `Fast / Auto / Deep` 三档增强偏好（会话级设置/CLI flag/UI toggle）；orchestrator 每轮仍输出 `orchestratorMode=chat|assist|heavy|fork`。`fork` 不作为用户常规开关，而在“需要动手/高风险操作”时由系统自动升级触发。
- **D‑WORKER‑PERM**：LLM worker 默认只读；写入/执行链路一律下沉到子会话（fork），并受权限门禁。
- **D‑WORKER‑SCOPE**：LLM worker 不做 compaction、不拼整段历史；只消费 Role Pack（pointers + 短状态）。
- **D‑WORKER‑IMPL‑A**：LLM worker 走 Internal Worker Runner（`generateObject/streamObject + schema + CacheStore + EvidenceWriter`），不走 `LLM.stream`（避免隐式 retrieval/context-pack 等副作用）。
- **D‑WORKER‑NO‑TOOLS**：LLM worker 不直接拥有工具执行能力；需要检索/核验只输出 `queries/toolRequests`，由 Tool Broker 执行并 pointerize。
- **D‑BOUNCE‑1**：LLM worker↔Tool Broker 只允许 1 次回填，禁止无限循环（性能/稳定第一）。
- **D‑CONC‑2**：默认 0 LLM worker（`orchestratorMode=chat`），默认上限 2 LLM worker/turn（assist/heavy）；升到 3 必须 `orchestratorMode=heavy` + `reasons[]` 明示。
- **D‑GATE‑MIXED**：启用 worker 的判断走“确定性优先 + 小模型 triage 兜底”，并把 triage 结果缓存（CacheStore）。
- **D‑TOOLS‑MAIN**：主 LLM 的工具面板也按需收敛：检索/核验尽量由系统模块先行，主 LLM 只消费 pointers；`mainTools` 实际生效必须与 user/agent permission 做交集；`orchestratorMode=chat` 默认不覆写工具集（`mainTools: null`）。
- **D‑SEARCH‑1/2/3**：搜索默认走 RetrievalRunner（指针化）；`grep` 仅交互调试；后续为 `grep` 增加指针化输出模式。
- **D‑TOOL‑POINTERIZE**：当工具被 orchestrator/workers 流程调用时，Tool Broker 必须把输出落为 artifact 并回填 pointers+summary（交互模式可保留原样文本输出）。
- **D‑NO‑ASK**：LLM worker 发起的工具调用不触发交互式 ask；不满足白名单/预算/权限则返回 rejected，并在需要时升级为 fork 子会话由用户确认。
- **D‑TOOL‑OUTPUT‑SSOT**：同一个工具允许存在两种输出路径：交互模式可继续使用 `Truncate`/人类可读文本；但 orchestrator/Tool Broker 调用时必须走 evidence artifacts + pointers（SSOT），以保证可回放/可核验。
- **D‑ROUTING‑LITE**：在不依赖外部设施的前提下，为 `worker_b_kb`/`worker_c_graph` 提供可降级的 lite 版本（本地 KB 检索 / 本地 import graph 近似），避免长期 `unavailable` 造成能力缺口。
- **D‑EVIDENCE‑SSOT**：任何“会影响事实输出/后续复用”的中间结果必须写 artifacts+manifest；events 只放 summary+pointers。
- **D‑SECUREOUTPUT‑POLICY**：secure-output/verification 的严格程度与触发策略由 `orchestratorMode + features` 决定：chat 不强制额外核验；assist 默认 balanced；heavy 默认 strict；涉及引用/对账/合规输出时即使在 assist 也可升级 strict；fork 的“执行与验收”链路在子会话中更严格。

---

## 11) 风险与关键约束（已定案，实施时按此执行）

1) **用户如何选择“增强档位”（与 `orchestratorMode` 解耦）？**  
我们不让用户直接选 `orchestratorMode=chat|assist|heavy|fork`（工程术语），而是提供 `Fast / Auto / Deep` 三档（会话级设置/CLI flag/UI toggle）：  
- `Fast`：强偏向 `orchestratorMode=chat`（尽量少派工、少额外开销）  
- `Auto`：默认策略（deterministic gating + triage 兜底）  
- `Deep`：强偏向 `orchestratorMode=assist/heavy`（更积极补检索/补核验/补审计）  
系统每轮仍会生成 `orchestrator.plan.json` 并落到 `orchestratorMode`；当用户请求执行/写入/高风险操作时自动升级到 `fork`。

2) **`mainTools` 的覆写语义边界（已定案）**  
`mainTools` 的目的不是“让模型更弱”，而是让协作流程更可控：  
- `orchestratorMode=chat`：`mainTools: null`（不覆写默认工具集，保持现有体验）  
- `orchestratorMode=assist/heavy`：允许 orchestrator **收紧** 主 LLM 工具集（只读优先），避免破坏证据链  
- `orchestratorMode=fork`：父会话保持只读；写入/执行下沉子会话  
- 无论任何模式：`mainTools` 最终生效必须与 user/agent permission 做交集（不可越权扩大）  
用户侧支持“强制全开/强制全关”的必要性不高，优先通过 `Fast/Auto/Deep` 三档与 fork 自动升级解决；如后续确需提供，建议只对开发/调试暴露。

3) **Tool 输出目前存在两套存储机制（明确区分调用路径）**  
部分工具依赖 `Truncate` 写到全局 `Global.Path.data`；而证据链需要进入 `.opencode/artifacts/<sessionId>` + manifest。  
定案如下：  
- **交互模式**：保持现状（人类可读文本 + Truncate），体验优先。  
- **orchestrator/Tool Broker 流程**：工具输出必须写 evidence artifacts + pointers（SSOT），并在 events 里只回填 summary+pointers。

4) **LLM workers 的落地形态（已定案）**  
单会话内：采用选 1 + 选 A（Internal Worker Runner），worker 无工具。  
需要动手（改文件/跑测试/高风险操作）时：升级为外层“子会话窗口/工单窗口”执行（`orchestratorMode=fork`）。

5) **strict/balanced/loose 与 secure-output 的联动策略**  
当前 secure-output 在 build agent 上默认 balanced。定案如下：  
- `orchestratorMode=chat`：不强制额外核验（避免闲聊被拖慢）；但若用户明确要求引用/对账/合规，Stage 0 可直接把本轮提到 assist/heavy。  
- `orchestratorMode=assist`：默认 `balanced`（缺证据就 unknown/降级）；  
- `orchestratorMode=heavy`：默认 `strict`（研究/多源对账/大量证据核验）；  
- `orchestratorMode=fork`：执行链路在子会话里更严格；父会话以“计划与验收”为主。  
策略来源：以 deterministic features 为主（用户显式档位/任务类型/风险信号），LLM triage 只能建议，不能绕过安全策略。
