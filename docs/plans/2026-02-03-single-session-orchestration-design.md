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
- `mainTools[]`（可选）：本轮允许主 LLM 直接调用的 tool ids（空数组表示“主 LLM 不用工具”，由系统模块先行完成检索/核验等）
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

### 3.3 主 LLM 的 Tool Gating（同样按需，避免“工具越多越乱”）

本专项的一个核心观点是：**不仅 worker 要受限，主 LLM 的工具面板也要按需缩小**。否则在通用场景里，主 LLM 很容易“为了图省事”走捷径（例如直接 grep 粘贴结果），反而破坏证据链与长会话稳定性。

推荐默认策略（可落地且可回归）：

- `mode=chat`：`mainTools=[]`（主 LLM 不用工具，只做对话；快、稳、不引入副作用）
- `mode=assist`：`mainTools` 只允许“读侧/解释侧”工具（例如 read/glob；检索与核验优先由系统模块先做，然后把 pointers 回填给主 LLM）
- `mode=heavy`：仍以“系统模块先行”为主；只有当确实需要主 LLM 交互式探索时才开放更多 tool ids，并把开放理由写入 `reasons[]`
- `mode=fork`：父会话 `mainTools` 仍保持只读；任何写入/执行链路都在子会话里运行（父会话只负责计划与验收）

> 这条与“把一般模型托举到更强代理能力”并不矛盾：弱模型最缺的不是“更多工具”，而是“更稳的输入与更少的错误自由度”。

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

- 文件读取（ReadTool）/读取 artifacts（不写文件；默认只读）
- **检索（优先）**：RetrievalRunner（内部可用 `rg/lsp/tree`，并且会把命中写成 **snippet artifacts + manifest pointers**）
- **核验（按需）**：Verification runner（输出 report pointers；失败可降级但必须事件化）

禁止项：

- 写文件/应用 patch/运行高风险命令/网络写入（默认禁止；需要写入时走子会话并受权限门禁）

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

---

## 10) 关键决策一览（已定案，实施阶段按此执行）

- **D‑WORKER‑PERM**：worker 默认只读；写入/执行链路一律下沉到子会话（fork），并受权限门禁。
- **D‑WORKER‑SCOPE**：worker 不做 compaction、不拼整段历史；只消费 Role Pack（pointers + 短状态）。
- **D‑BOUNCE‑1**：worker↔Tool Broker 只允许 1 次回填，禁止无限循环（性能/稳定第一）。
- **D‑CONC‑2**：默认 0 worker（chat），默认上限 2 worker/turn（assist/heavy）；升到 3 必须 `mode=heavy` + `reasons[]` 明示。
- **D‑GATE‑MIXED**：启用 worker 的判断走“确定性优先 + 小模型 triage 兜底”，并把 triage 结果缓存（CacheStore）。
- **D‑TOOLS‑MAIN**：主 LLM 的工具面板也按需收敛：检索/核验尽量由系统模块先行，主 LLM 只消费 pointers。
- **D‑SEARCH‑1/2/3**：搜索默认走 RetrievalRunner（指针化）；`grep` 仅交互调试；后续为 `grep` 增加指针化输出模式。
- **D‑TOOL‑POINTERIZE**：当工具被 orchestrator/workers 流程调用时，Tool Broker 必须把输出落为 artifact 并回填 pointers+summary（交互模式可保留原样文本输出）。
- **D‑ROUTING‑LITE**：在不依赖外部设施的前提下，为 `worker_b_kb`/`worker_c_graph` 提供可降级的 lite 版本（本地 KB 检索 / 本地 import graph 近似），避免长期 `unavailable` 造成能力缺口。
- **D‑EVIDENCE‑SSOT**：任何“会影响事实输出/后续复用”的中间结果必须写 artifacts+manifest；events 只放 summary+pointers。
