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

---

## 2) 目标与非目标

### 2.1 目标（DoD 方向）

- **默认轻量**：闲聊/轻任务不启用 worker，不引入额外调用与延迟。
- **按需增强**：复杂/高风险/工具密集任务，按可解释规则启用 1–2 个 worker（只读），并写入审计事件。
- **稳定优先**：不允许 worker 自行 compaction；不允许 worker 随意拼 prompt；不允许无限回合的“worker↔工具↔worker”循环。
- **可审计/可回放**：每次协作都能导出证据包说明“系统做了什么、为什么这么做、失败如何降级”。
- **可回归**：有离线 eval 与 deterministic tests，避免迭代后悄悄变慢/变宽松/变不可信。

### 2.2 非目标（避免范围失控）

- 不在本稿引入跨会话长期记忆（memory）与训练数据治理（另立专题）。
- 不承诺所有任务都“更快更省 token”；目标是 **平均更稳、更可信**，并对高价值任务提供可解释增强。
- 不让 worker 获得写权限（文件写入/执行高风险命令）作为默认能力。

---

## 3) 核心设计：Orchestrator Control Plane（每轮一张可审计工作单）

### 3.1 Orchestrator Plan（结构化 + versioned）

每次用户消息进入主流程前，系统生成一个 `orchestrator.plan.json`，并写事件 `orchestrator.planned`：

- `specVersion: orchestrator-plan/1.0`
- `mode`: `chat | assist | heavy | fork`
- `workers[]`: 本轮要启用哪些 worker（最多 2 个）
- `budgets`: `maxWallClockMs` / `workerTimeoutMs` / `maxOutputTokens` / `maxToolCalls`
- `toolPolicy`: worker 可用的只读工具白名单（详见 5）
- `reasons[]`: 可解释理由（来自确定性信号，或来自 LLM triage 的结构化理由）
- `inputsFingerprint`: stableJson + sha256（可用于 cache/回归）

> 关键点：plan 是 SSOT。没有 plan 就不“偷偷启用 worker”。出问题时能复盘“为什么派工”。

### 3.2 默认并发策略（质量/性能/稳定第一）

对 “LLM workers（模型调用）” 的并发上限建议定死为：

- **默认并发上限：2 个 worker/turn**（不含主 LLM 本身）
- **默认 0 worker**：`mode=chat` 时永不派工
- **允许临时升到 3**：仅当 `mode=heavy` 且明确是“研究/多源对账/大量证据核验”类任务，并且必须写明 `reasons[]`（否则拒绝）

理由（务实）：你们已经存在并行模块（routing A/B/C、retrieval、verification、cache/compaction）。如果再把 LLM workers 并发开太大，会出现“并行越多越慢”的反效果。

---

## 4) 如何决定启用 worker：关键字不够，但“纯 LLM 判断”也不稳

你提出的点是对的：通用场景下，仅靠关键词（引用/证据/合同）不够覆盖；但完全依赖 LLM 判断会带来不稳定与不可回归。

推荐 **混合 gating（deterministic first + LLM triage as fallback）**：

### 4.1 Stage 0：确定性规则（快速、可回归）

先用便宜且可解释的信号做明显分流：

- `mode=chat`：短消息 + 无工具意图 + 非 strict/balanced + 无明显“要执行/要查/要改” → 0 worker
- `mode=assist`：需要检索/需要核验/需要总结资产 → 1 worker（通常是 retrieval planner 或 evidence critic）
- `mode=fork`：涉及写文件/大改动/跑测试/长耗时工具链 → 派子会话（多会话并发），单会话仅做只读准备

### 4.2 Stage 1：LLM triage（只在“规则不确定”时启用）

当 Stage 0 判断不确定（例如复杂度分数在阈值区间），调用一个“小模型”做 triage，但强制：

- 输出必须是 `orchestrator-plan/1.0` 的严格 JSON（schema-first）
- `mode/workers/budgets` 只允许枚举值（防止“发挥”）
- triage 结果只作为建议；若与安全/预算冲突则降级回 Stage 0

这样能覆盖“通用场景复杂多样”的问题，同时保持稳定与可回归。

> 决策记录：开发/测试阶段 triage/worker 统一使用 `GLM4.7 Flash`（API）。后续自部署候选另议。

### 4.3 Stage 2：可缓存（降低额外开销）

LLM triage 的输入是稳定特征（intent fingerprint / policy / workspace fingerprint / toolset fingerprint），输出 plan 可接入 CacheStore（命中时不再重复 triage 调用）。

---

## 5) Worker = “带脑子的只读工具”（agent-as-tool），但要被工程化约束

### 5.1 Role Pack（worker 的最小输入）

给 worker 的输入不是“整段历史对话”，而是一份可审计、短小、稳定的 Role Pack：

- `goal` / `constraints`
- `openQuestions[]`
- `workingSet.pointers[]`（稳定排序；指针化，不粘贴大段原文）
- `policy`（strict/balanced/loose + 必须 unknown 的规则）
- `budget`（time/token/tool-call 上限）
- `task`（worker 的单一职责描述：例如“只输出检索 query 列表与预期命中文档类型”）

### 5.2 输出协议（worker 的最小输出）

worker 输出必须是结构化 JSON：

- `status: ok | degraded | timeout | cancelled`
- `candidates[]`（每条候选必须有 pointers 或标 unknown）
- `toolRequests[]`（可选；只读工具请求，见下节）
- `notes[]`（可选；严格限制长度）

### 5.3 Tool Broker（只读工具白名单 + 一次回填）

即便 worker 可以“使用工具”，也不应直接执行，而是：

1) worker 输出 `toolRequests[]`（结构化）
2) Tool Broker 校验白名单与预算后执行
3) 执行结果落 artifacts/events，并将 pointers 回填给主 LLM（或回填给 worker，仅允许 1 次）

只读工具白名单（示例，具体按仓库工具集对齐）：

- 文件读取/rg 搜索/读取 artifacts（不写文件）
- retrieval runner（返回 hits + pointers）
- verification runner（返回 report pointers）

禁止项：

- 写文件/应用 patch/运行高风险命令/网络写入（默认禁止；需要写入时走子会话并受权限门禁）

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

- `mode=chat` 时：0 worker、0 额外调用、行为与当前版本一致
- `mode=assist/heavy` 时：最多 2 个 worker 并发（可观测、可解释）
- worker 只读工具：无写入副作用；所有输出均证据化（artifacts + events）
- 在 strict/balanced 下：fact 不能无证据通过（缺证据就 unknown 或降级）
- 离线 eval 可回归：同一输入在相同 repo/worktree/policy 下，orchestrator plan 不漂移（hash 断言）

---

## 9) 后续落地建议（实现顺序）

1) 先实现 Stage 0（纯确定性 orchestrator plan）+ 事件化（不引入任何新 LLM 调用）  
2) 再引入 Stage 1（LLM triage，schema-first，cacheable）  
3) 先落地 1 个 worker（Retrieval Planner），验证收益与回归  
4) 再加 Evidence Critic（与 secure-output/verifier 联动）  
5) 最后加 Patch Planner（配合子会话写入/合并机制）

