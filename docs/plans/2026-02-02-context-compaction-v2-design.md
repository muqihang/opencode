# 上下文压缩专项：Context Compaction v2（Capsule / Context Compiler）设计稿（可落地）

> **定位**：这是一个“避免遗忘”的专项设计稿，用于在当前 P3（Milestone 2.6/3/4）并行开发完成后，再单独立项实施。  
> **与 P3 的关系**：它是你提出的“省 token / 高命中 / 超长上下文 / 近 0 幻觉”的关键拼图，用于把**已有 compaction**从“能用”升级到“世界级可控”。  
> **不打断当前执行**：当前终端 1/2/3 正在做 2.6/3/4，本稿只做设计与 DoD 固化，不改代码。

---

## 0) 背景与问题（为什么要做专项）

LLM 有最大上下文窗口（例如 128K / 200K）。但我们想要的产品体验是：

- 会话可以很长（跨天、跨多轮、多任务），仍然**稳定**；
- 依然能做到**高质量**与**低幻觉**（特别是“事实/引用”必须可对账）；
- 依然能做到**高命中缓存**（无论是本地 SSOT cache，还是各厂商的 prompt caching / cached content / cache-control）；
- UI（尤其 GUI）默认不向用户暴露“压缩/Token/上下文窗口”等工程术语，但要把“系统做了什么”以**人话+可信**的方式表达。

因此我们需要把“上下文压缩（compaction）”从单次摘要升级为一个**工程化的上下文编译器（Context Compiler）**：

> 把“长对话”编译成“短而可信的运行时上下文 + 可回放的证据资产（artifacts）”，并且具备缓存、核验、预算、降级、审计闭环。

---

## 1) 代码现状（以仓库事实为准）

当前仓库已经具备 compaction/summary 的雏形能力：

- **自动 compaction**：会话接近模型可用窗口时触发（基于模型 `limit.context` / `limit.input` / `limit.output` 做溢出判断）。
- **summary 消息**：compaction 会生成 `summary=true` 的 assistant 消息，用于“继续对话所需信息”。
- **prune（去膨胀）**：会清理很久以前的 tool 输出内容（保持结构，避免 tool result 撑爆上下文）。
- **historySummary block**：近期已将 summary 抽取为 `historySummary` 并注入稳定 ContextBlocks；同时从 messages 历史中剔除 summary，避免重复注入。

它们证明方向正确，但仍缺乏“世界级可控”的四件事：

1) **结构化（SSOT）**：summary 是自然语言，漂移与遗漏难以回归；  
2) **可核验**：summary 里的事实断言没有统一 pointers 绑定与 verifier 门禁；  
3) **可缓存**：summary/compaction 没有明确 cacheKey（或虽有，但未统一纳入 SSOT cache store）；  
4) **可解释**：UI/审计无法稳定解释“压缩了什么、为何可信、如何回放、哪些是 unknown”。

---

## 2) 目标（First Principle：质量优先的高效利用上下文）

这份专项按你的“第一原则”做权衡：**高效利用上下文，是为了提升完成任务的质量**。

因此我们推荐的策略不是简单“保守/激进”，而是：

> **激进外置（Aggressive externalization） + 保真内核（Faithful core） + 自适应（Adaptive）**

- **激进外置**：长内容尽量落盘为 artifacts（证据包/检索结果/工具输出/派生索引），对话上下文只注入摘要与指针（pointers-not-paste），提升命中率与可控性。
- **保真内核**：对“目标/约束/决策/待确认问题/关键证据指针/当前工作集”高保真保留；不确定就明确 `unknown`，不靠“写得像真的”来掩盖。
- **自适应**：当压缩会伤害质量（例如用户正在逐条对齐合同条款/代码 diff），宁可保留指针与可回放路径，并通过检索/锚点重取细节，不依赖自由叙事摘要。

### 2.1 非目标（避免范围失控）

- 不引入跨会话长期记忆（memory）机制（你已明确后置专题）。
- 不强制 UI 向用户展示 token 数、上下文窗口等工程术语（但允许审计视图懒加载）。
- 不把“压缩”变成单一大模型能力依赖：压缩必须能被我们的工程机制（检索/核验/脚本/缓存）兜底。

---

## 3) 产品体验（GUI/TUI：默认不显性“压缩”，但必须“可信可见”）

### 3.1 GUI（通用场景）

默认策略：**不露工程术语**，只露“可信叙事”。

- Timeline/Activity 可以出现轻量里程碑（milestone），例如：
  - 标题：`已整理历史信息`
  - 副标题：`为了保持回答准确与连贯`
- 仅在用户点开“详情/审计”时，才展示：
  - 触发原因（接近窗口上限、工具输出过多、用户开启省 token 模式等）
  - 保留要点（目标/约束/决策/开放问题/证据指针）
  - 可回放入口（指向 artifacts）

失败/降级必须自动展开（符合 UI 工程纪律）：

- 文案必须是中文人话 + 可操作下一步：
  - `我无法核验以下历史结论，已标记为未知。你可以：补检索 / 重新核验 / 切换到宽松模式继续。`

### 3.2 TUI（偏工程/编码用户）

TUI 可以更“工程可见”，但仍要分层：

- 默认仍是人话；
- 审计视图可见：预算、cache hit/miss、compaction key、artifact 指针、稳定排序与版本。

---

## 4) 核心设计：Context Compiler（上下文编译器）

把 compaction 升级为“编译流程”，输出两类产物：

1) **运行时上下文**：短、稳定、可控的 blocks（进入 context-pack.json）；  
2) **证据资产**：长、可回放的 artifacts（进入 Evidence Pack/manifest），用于核验与复盘。

### 4.1 三温区模型（Hot / Warm / Cold）

- **Hot（热区）**：最近 1–2 轮对话 + 当前工具调用必要信息（短、最新、关键）。
- **Warm（温区）**：结构化 capsule（见下文）+ history_summary block（短、稳定、可对账）。
- **Cold（冷区）**：所有长内容（完整对话、长工具输出、长文档）都以 artifacts 存储；上下文只注入 pointers/anchors。

这保证了“会话可无限长”，而模型上下文只是运行时内存。

### 4.2 从“自由摘要”升级为“结构化 Capsule（SSOT）”

我们引入 **Capsule v2**：一个结构化的会话状态（SSOT），再渲染成短文本供模型消费。

Capsule 的核心字段（建议）：

- `goal`：当前目标（短）
- `constraints[]`：硬约束（安全/时间/工具/输出格式）
- `decisions[]`：已确认决定（必须可追溯）
- `openQuestions[]`：待确认问题
- `workingSet`：当前工作集（文件/证据指针集合）
- `claims[]`：事实断言（可选；但一旦出现必须可核验）

Capsule 的好处：

- 可回放（artifact）
- 可缓存（稳定 key）
- 可核验（claims→pointers→verifier/toolbelt）
- 可 diff（减少漂移）

### 4.3 “可核验压缩”：claims 必须能挂证据（近 0 幻觉关键）

当 Capsule/summary 产生事实断言（claim）时：

- 必须绑定 `pointers(path+sha256+anchor)`；
- 必须可通过 toolbelt/verifier 校验；
- 校验失败则必须降级为 `unknown/unsupported`，并给中文原因；
- 禁止“写得像真的”的结论。

这与 P3 里的 `Tool Belt v1` + `Verifier Worker` 完全互补：弱模型也能被工程机制提升可信度。

---

## 5) 规格（Artifacts / Events / Cache Keys）

> 目标：让 compaction 成为“可审计、可缓存、可回放”的一等工程资产。

### 5.1 Artifacts（建议 v1 交付的 4 个产物）

1) `capsule.turn.json`（每轮）  
2) `capsule.turn.view.md`（每轮，人类可读；不参与正确性判定）  
3) `capsule.session.json`（聚合，跨多轮）  
4) `compaction.report.json`（一次 compaction 的报告：输入/输出/核验/降级原因）

#### `capsule.turn.json`（示例结构，版本化）

- `specVersion`: `"capsule.turn/2.0"`
- `sessionId`, `messageId`, `createdAtUtc`
- `goal`, `constraints[]`, `decisions[]`, `openQuestions[]`
- `workingSet.pointers[]`（稳定排序）
- `claims[]`（可选；若存在每条必须带 `pointers[]`）
- `quality`: `{ ok, degraded, reasons[] }`
- `sources`: `{ contextPackId?, retrievalId?, verificationId? }`

### 5.2 Events（闭环，payload 只放 summary + pointers）

新增或扩展事件（命名可在实施时对齐现有 event 体系）：

- `compaction.requested`
- `compaction.completed`
- `compaction.degraded`
- `compaction.timeout`
- `compaction.cancelled`
- `capsule.updated`（每轮 capsule 产出）
- `capsule.cache_hit` / `capsule.cache_miss`（当接入 SSOT cache store 后）

事件字段要求：

- 必须包含：`sessionId`、`messageId`、`compactionId`（或 capsuleId）、`artifact` 指针、`summary`（中文）
- 禁止：把长原文塞进 event data
- 降级/超时/取消：必须给 `reasons[]` + 中文 hint（可操作下一步）

### 5.3 Cache Keys（与 Milestone 3 的 CacheStore 对齐）

Compaction/Capsule 的 cacheKey 必须可解释，建议输入包含：

- `policyVersion`（策略变化必须失效）
- `toolsetFingerprint`（工具变化必须失效）
- `workspaceFingerprint`（repo/worktree 变化必须影响）
- `compactionPromptVersion`（模板/规则版本）
- `inputPointersFingerprint`（指针集合的稳定表示）
- `mode`（strict/balanced/loose）

命中策略：

- 命中只跳过“重计算/重调用”；仍要写 call-scoped 的 context-pack.json 与本轮事件（保持证据链对账一致）。

---

## 6) 运行流程（建议实现顺序）

### 6.1 触发策略：soft/hard 阈值 + 自适应

建议沿用并升级已有的 overflow 检测：

- `softThreshold`：开始后台整理（不阻塞主流程）
- `hardThreshold`：下一次模型调用前必须整理（阻塞式）

阈值不写死成 token 数，写成“相对预算比例”，对 128K/200K 自适应。

### 6.2 编译管线（高层）

1) **Measure**：基于 ContextPack 计数器与预算，判断是否需要 compaction  
2) **Plan**：生成 `compaction.plan.json`（为什么、目标预算、要保留的内核字段）  
3) **Compile**：产出结构化 capsule（`capsule.turn.json` / `capsule.session.json`）  
4) **Verify**（strict/balanced）：对 claims 走 verifier/toolbelt；不可核验则标 unknown 并降级提示  
5) **Emit**：写 artifacts + events；更新 `history_summary` block 的输入（短文本 + 指针）  
6) **Cache**：接入 CacheStore 后，读写 capsule/report 缓存并事件化命中原因

---

## 7) 测试与验收（DoD：可回归、可解释、低幻觉）

### 7.1 关键不变量（必须有测试覆盖）

- **不会 silent fail**：请求→完成/降级/超时/取消事件闭环必达
- **结构化输出可 parse**：capsule/report 版本化 schema 校验
- **稳定排序**：指针/claims/decisions 的排序稳定（乱序输入→固定输出）
- **预算达标**：history_summary 文本不超过上限（超限必须降级/二次编译）
- **事实不装懂**：缺证据必须 unknown/unsupported
- **可回放**：所有关键输出都能通过 artifact 指针追溯

### 7.2 “弱模型也能强”的验收样例

- 使用较弱模型生成 capsule，但通过：
  - retrieval 的证据指针
  - toolbelt 的 citation-check / quote anchor
  - verifier 的 claim-level 门禁
 让最终输出依然可信（unknown 明确、可补证据）。

---

## 8) 实施建议（排期与协作）

> 建议在当前 P3 终端 1/2/3（2.6/3/4）完成并集成后，再启动本专项；否则会与 cache store / secure-by-default / provider normalize 产生接口抖动。

推荐拆成 5 个阶段（每阶段可独立验收）：

1) **协议与产物化先行**：capsule/report artifacts + events（先不追求智能压缩）  
2) **结构化 capsule 编译**：Context Compiler v1（可控、可回归）  
3) **核验联动**：claims→verifier/toolbelt（strict/balanced 下门禁）  
4) **缓存联动**：capsule/report 接入 CacheStore（命中原因可解释）  
5) **GUI 叙事与审计视图**：默认人话、细节懒加载、失败自动展开（Gemini 适配 UI）

当你决定进入实现时，建议再创建一份单独的 TDD 级实现计划文档：

- `docs/plans/YYYY-MM-DD-context-compaction-v2-implementation-plan.md`

并为每阶段分配隔离 worktree 与按包测试（与当前流程一致）。

### 8.1 预计会触及的代码位置（便于后续落地分工）

> 这一节是“可落地”的关键：实施时优先复用现有模块，而不是另起炉灶。

后端（packages/opencode）：

- compaction 主逻辑：`packages/opencode/src/session/compaction.ts`
- 会话驱动/触发点（何时 compact / prune）：`packages/opencode/src/session/prompt.ts`、`packages/opencode/src/session/processor.ts`
- context blocks 注入点（history_summary / capsule block）：`packages/opencode/src/session/context-blocks.ts`
- context pack 产物：`packages/opencode/src/session/context-pack.ts`、`packages/opencode/src/session/llm.ts`
- retrieval（rehydrate/补证据）：`packages/opencode/src/retrieval/runner.ts`
- verifier 门禁（claims 校验）：`packages/opencode/src/verification/worker.ts`
- evidence/events 落盘：`packages/opencode/src/evidence/writer.ts`
- cache store（复用 Milestone 3 的成果）：`packages/opencode/src/cache/store.ts`（若届时路径不同，以实际为准）

协议与 schema（建议新增版本化文件）：

- capsule/report 协议：`packages/opencode/src/protocol/*`（例如 `capsule-turn.ts` / `compaction-report.ts`）

测试（packages/opencode；不 mocks，真实实现）：

- `packages/opencode/test/session/compaction-v2.test.ts`（事件闭环、schema、预算、unknown 语义）
- `packages/opencode/test/session/capsule-cache.test.ts`（命中后跳过重活 + 命中原因对账）

前端（packages/app；由 Gemini 接力实现叙事与美感）：

- Timeline narrative：`packages/app/src/components/activity/activity-narrative.ts`
- 审计懒加载与失败自动展开：按 `docs/ui/discipline.md` 的现有模式扩展

### 8.2 开关与自救（与 P3 自救一致）

Compaction v2 的推荐开关（示例命名；实施时对齐现有 Flag/Config 风格）：

- `disableCompaction`：关闭 compaction（只做 prune 或完全不做；必须事件化原因）
- `forceRebuildCapsule`：即使命中缓存也强制重建 capsule（用于排障）
- `compactionMode`：`strict|balanced|loose`（与 verifier/retrieval 一致）

要求：所有开关都必须进入“effective config”并可对账（来源可追溯）。

---

## 9) 与 GPT-5.2 风格的可借鉴点（不依赖“秘密提示词”）

这里列的是“工程方法”，不依赖任何内部 prompt：

1) **指令与数据强隔离**：把检索/资料/用户粘贴文本当“数据”，默认不允许它改变系统指令（prompt injection 防御）  
2) **证据优先**：先拿证据（retrieval/capsule/pointers），再产出结论；结论缺证据就 unknown  
3) **门禁与降级**：宁可降级也不装懂；把降级写成事件与可操作中文提示  
4) **可回归**：任何“省 token 的聪明优化”必须可测、可解释、可回放（否则就是黑箱）  
5) **稳定前缀**：blocks/顺序/模板版本稳定，缓存才会高命中
