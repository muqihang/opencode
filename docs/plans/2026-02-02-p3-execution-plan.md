# P3 执行计划：Context Pack 上下文工程 + 多模型缓存命中治理

> **For Codex/Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task（并在实现前用 `superpowers:using-git-worktrees` 创建隔离 worktree）。

**Goal（P3 最小闭环）**：把“省 token / 高缓存命中 / 超长上下文 / 可解释计数器”从概念落到工程 SSOT：  
1) 每次模型调用都生成 `context-pack.json`（证据化、可审计、可解释）；  
2) 本地指纹缓存 + LRU/TTL（命中可观测）；  
3) 对齐各厂商 prompt caching / cached content / cache-control 的差异，统一成可对账的 `cache.read/cache.write` 与命中原因；  
4) UI/TUI 按 **人话视图 vs 审计视图** 展示上下文预算、命中与证据指针（默认安全、懒加载、失败自动展开）。

**Architecture（P3 关键模块）**：
- **Context Builder（daemon 层/后端）**：在发起模型调用前构建 `ContextPack`（Zod schema + stableJson）；输出 artifacts + events。
- **Cache Store（SSOT）**：按 project/worktree 分域的 `memory + disk` 默认后端；支持 LRU/TTL；命中写 events；将 provider 缓存仅作为“加速器”指标。
- **Provider Normalization**：统一采集 DeepSeek/GLM/MiniMax/Gemini/Claude/OpenAI 的缓存字段与 usage 口径；避免“不同厂商字段把我们骗了”。
- **UI（App/TUI）**：默认展示“阶段/预算/命中/证据指针”（safe）；审计字段/原始 JSON 懒加载；高频更新视觉节流（≥800ms）；失败自动展开；共享时钟；支持 `prefers-reduced-motion`。

**Tech Stack**：Bun、TypeScript、Zod、SolidJS（App/TUI）、Hono server、`@ai-sdk/*` providers。

---

## 0. 硬性约束（P3/P4 UI 工程纪律）

本计划所有 UI/前端相关改动，必须满足 `docs/ui/discipline.md` 的 6 条底线（摘录）：
- 禁止硬编码视觉值：必须用语义 token / vars（先用现有 token，不够再在 theme overrides 定义）。
- 人话视图 vs 审计视图分离：审计字段必须懒加载。
- 高频事件视觉节流：Live 状态至少保持 **800ms**；避免频闪焦虑。
- 失败是阻断：失败/需要介入的步骤必须自动展开。
- 性能红线：共享时钟 signal；禁止 list item 内各自 `setInterval`。
- 动效安全：尊重 `prefers-reduced-motion`（可降级为静态/淡入）。

另外：所有对用户可见文案默认中文（中文人话，不是工程字段名）。

---

## 1. 现状盘点（以仓库代码事实为准）

下面是 `feature/opencode-custom` 当前已落地能力（P2.5 及之前），用于界定 P3 最小补集：

### 1.1 P0–P2：沙盒执行 / 证据链 / 并行与合并（已具备）

- **SandboxRunner（soft）+ ExecPolicy 证据化**：`packages/opencode/src/sandbox/runner.ts`（写 `sandbox.backend_selected`、`policy.exec_evaluated`、stdout/stderr artifacts）。
- **Evidence Pack v1 + manifest/events + micro-pack**：`packages/opencode/src/evidence/writer.ts` + `packages/opencode/src/protocol/evidence-pack.ts` / `evidence-manifest.ts` / `evidence-micro-pack.ts`。
- **Evidence export 安全门禁（no symlink traversal + allowlist kinds）**：`packages/opencode/src/evidence/export.ts`。
- **Worktree 隔离与子会话合并**（隔离→合并、冲突 artifacts、事件记录）：`packages/opencode/src/session/finalizer.ts`、`packages/opencode/src/worktree/merge.ts`、`packages/opencode/src/workdir/*`。
- **Routing worker 协议骨架（A/B/C）+ routing cache（disk+memory）**：  
  - 协议：`packages/opencode/src/protocol/routing-run-request.ts`、`routing-worker-result.ts`  
  - runner + artifacts：`packages/opencode/src/routing/runner.ts`  
  - cache：`packages/opencode/src/routing/cache.ts`
- **File Workbench（输入去重 + 派生缓存 + cache_hit 事件）**：`packages/opencode/src/file/workbench.ts`、`packages/opencode/src/file/workbench-cache.ts`

### 1.2 P1.6：Token Economy 基础对齐（已具备，但 P3 还有欠账）

- **sticky session headers（Sub2API/OpenAI 网关粘性会话）**：`packages/opencode/src/session/llm.ts` 的 `buildGatewayHeaders()`。
- **prompt cache key 注入**：`packages/opencode/src/provider/transform.ts`（`promptCacheKey = sessionID` 的策略分支）；OpenAI-compatible responses 支持 `prompt_cache_key`：`packages/opencode/src/provider/sdk/openai-compatible/.../openai-responses-language-model.ts`。
- **DeepSeek cached tokens 粗归一**：`packages/opencode/src/session/index.ts`（读取 `prompt_cache_hit_tokens` 映射到 `cache.read`）。

> P3 必须补的点：Gemini Cached Content 自动化、Anthropic/MiniMax cache read/write 口径统一、GLM cached_tokens 归一、以及 Context Pack + prefix determinism 的“工程 SSOT”。

### 1.3 P2.5：App/TUI 执行可视化（已具备）

- **App：Turn Live Capsule + Timeline + Narrative（中文人话）**：`packages/app/src/components/activity/*`、`packages/app/src/lib/chronology/*`。
- **共享时钟（相对时间）**：`packages/app/src/components/activity/pulse.ts`（`useNowMs` singleton）。
- **Evidence events API**：`packages/opencode/src/server/routes/session.ts`（`GET /:sessionID/evidence/events` + manifest）。

### 1.4 现状：沙盒里能启用几个 worker？分工是什么？能跑哪些 Python/脚本/工具？

> 这节用“代码事实”回答你在总设计稿 Section 2 提到的关键问题：主会话/子会话进入各自沙盒后，当前到底能并行启用几个 worker、分工是什么、以及工具带能执行什么。

- **Routing workers（A/B/C）**：当前实现为 3 个 worker，默认 `maxWorkersInFlight=3`（可配置），入口：`packages/opencode/src/routing/runner.ts` + `packages/opencode/src/routing/config.ts`。
  - Worker A（`worker_a_repo` / `repo-lsp`）：当前实现是 repo 文件树扫描（Bun.Glob），产出候选文件列表（`packages/opencode/src/routing/worker-a.ts`）。
  - Worker B（`worker_b_kb` / `kb-rag`）：当前为 `unavailable` stub（`packages/opencode/src/routing/worker-b.ts`）。
  - Worker C（`worker_c_graph` / `graph-impact`）：当前为 `unavailable` stub（`packages/opencode/src/routing/worker-c.ts`）。
- **PythonTool（allowlisted scripts + project scripts）**：沙盒内可执行 **allowlisted** Python 脚本（输入/输出落盘为 artifacts 并进入 Evidence Pack），入口：`packages/opencode/src/tool/python.ts`。
  - allowlist registry：`packages/opencode/src/python/registry.ts` + `packages/opencode/src/python/scripts.manifest.json`
  - 内置 allowlisted scripts（现状）：`summarize-json` / `doc-extract-pdf-text` / `doc-unpack-archive` / `doc-ocr-image`
  - project scripts（可选）：`project:<name>`（仅允许 `.opencode/scripts/<name>.py`，并受 `config.python.allowProjectScripts` 控制）
- **BashTool/其它工具**：P0–P2 已通过 `SandboxRunner` 证据化并纳入审批/审计；P3 的目标是“上下文工程 + 可信门禁”质变，不扩大任意执行面。

---

## 2. P3 的“必须做”与“暂不做”（明确边界）

### 2.1 P3 必做（最小集合，不可遗漏）

来自总设计稿 Section 16/3/11.2 + 覆盖索引的硬要求（`docs/plans/2026-01-25-opencode-sandbox-context-design.md`、`docs/plans/2026-01-30-opencode-sandbox-context-section-coverage-index.md`）：

1) **Context Pack SSOT**：每次模型调用生成 `context-pack.json`（`context-pack/1.0`）并登记为 evidence artifact；UI 计数器与解释必须可回溯到 `segments[]`。
2) **Evidence-first Retrieval（检索/裁剪工程化）**：二阶段检索（召回→精排→预算裁剪）、Query Rewrite、Dedup/Near-dedup；检索/裁剪过程产物化并可缓存；并确保稳定排序避免 cache 抖动（Section 16.3.1）。
3) **指纹缓存 + 命中可观测**：context pack cache hit/miss 可记录、可 grep；scoped LRU/TTL（至少 context pack + 文件内容/检索结果缓存）；命中原因可解释（Section 3.1/16.3.1）。
4) **prefix determinism**：稳定 blocks + toolset determinism；生成 `toolsetFingerprint + block fingerprints` 并入 cacheKey；MCP toolset 变更 freeze（避免 mid-turn 抖动）（Section 16.4）。
5) **Compaction 联动 + Ledger/Delta**：让 “54% → 10%” 的下降来自“调用级上下文重建 + compaction + 指针化产物 + delta 注入”，而不是删信息；compaction 输出必须带证据指针，避免摘要漂移（Section 16.3.2）。
6) **Secure-by-default（抗提示注入 + 控制消耗）**：指令/数据隔离、Schema-first 校验、Citation Required、预算/限流/熔断都写入 events（Section 16.3.3）。
7) **多模型缓存/usage 归一**：DeepSeek / GLM / MiniMax / Gemini / Claude / OpenAI 的 cache 字段统一到 `cache.read/cache.write`；Gemini Cached Content 自动创建/复用/失效管理接入；命中率进入 evidence/events（可观测）（Section 3.2 + P1.6 遗留）。
8) **UI 工程纪律落地**：人话视图默认安全；审计字段懒加载；失败自动展开；高频视觉节流（≥800ms）；共享时钟；`prefers-reduced-motion`（`docs/ui/discipline.md`）。

#### 2.1.1 P1.6 遗留到 P3 的核对清单（逐条对账）

> 来源：总设计稿 Section 11.2.1（“明确推迟到 P3 的点”）。本节的目的不是重复描述，而是确保 **P3 计划里每一条都有落点**。

- **Gemini Cached Content 自动化（创建/复用/失效）** → Milestone 4（Gemini 子项）+ Milestone 3（本地 cache SSOT 与失效原因可解释）
- **Claude/Anthropic Prompt Cache / cache-control（含 cache.read/cache.write 归一）** → Milestone 4（Claude/Anthropic 子项）
- **多模型统一：DeepSeek/GLM/MiniMax/Gemini 的缓存字段与 usage 口径归一** → Milestone 4（usage normalizer）
- **Context Pack + prefix determinism（可解释、可测试、可观测）** → Milestone 1（Context Pack SSOT）+ Milestone 2（determinism）+ Milestone 3（本地指纹缓存与命中统计）

#### 2.1.2 Capsule + 指纹缓存 + Compaction 的闭环（P3 关键数据流，防“做了功能但不可控”）

> 你的目标是“省 token / 高命中 / 超长上下文”做到工程可控。这里把最小闭环写成一条可审计的数据流（SSOT 驱动），避免只靠 prompt 技巧。

1) **证据先行**：Routing/Workbench/Retrieval 先产出 artifacts（可 grep、可缓存、可引用）与 events（可解释时间线）
2) **调用级重建**：每次模型调用前，由 Context Builder **按预算** 构建 `context-pack.json`（包含 capsule+pointers，而非塞满原文）
3) **指纹计算**：对固定 blocks + 关键依赖（toolset、repo、workbench inputId、retrieval hits）计算 fingerprints → 生成 cacheKey
4) **本地缓存 SSOT**：
   - 命中 → 复用 context-pack（或复用其 segments 的资产指针），写 `cache.hit`（原因可解释）
   - 未命中 → 重建 + 写 `cache.miss`（原因可解释）
5) **Compaction 只做“可控压缩”**：当预算压力或多轮后触发 compaction：
   - 输出必须是“结构化 + 指针化”（facts/ledger/delta + pointers）
   - 更新 capsule，但 capsule 必须引用 sources（避免摘要漂移/幻觉）
   - 下一轮 context-pack 使用 delta（而不是全量粘贴历史）

#### 2.1.3 “不锁场景”的产品原则（以高风险场景为门槛，但构建通用代理）

> 你明确提出：P3/P3+ 的“严谨、可靠、无限接近 0 幻觉”应当成为 **通用代理的基准能力**，而不是把系统锁死在法务/审计。
> 本节将“高风险场景要求”抽象为通用机制，并把“场景化增强”外置为可插拔模块（prompts/skills），避免 core 被领域耦合污染。

**核心原则（必须写进实现与验收方式）**
- **Core 只做通用机制**：证据资产化、确定性模板、指纹缓存、可解释计数器、引用门禁、降级语义、最小泄露。
- **领域策略外置**：
  - 以 `skills`（标准化执行流程包）或 prompt packs 的方式提供“行业/场景工作流”；
  - 通过 `SkillTool`（`packages/opencode/src/tool/skill.ts`）加载，且被记录为 evidence（以便审计/复现/缓存对账）。
- **“高风险门槛”是质量标准，不是领域限定**：同一套 Verification/Claims/Citation Required 机制也适用于编程、写作、产品、运营等任务，只是默认策略可更宽松。

**可配置的“可信输出策略”（通用能力，按 profile/skill 调参）**
- `strict`：关键结论没有可验证 pointers 就不输出结论（只输出“无法证实 + 下一步补证据”）
- `balanced`（推荐默认）：无证据时必须降级为“不确定/需补证据”，并自动触发一次补检索/补核验
- `loose`：允许输出推测，但必须显式标注“推测/低置信度”，且不能伪装成事实

#### 2.1.4 B++（B 为底，吸收 C）架构（你的选择，写进 P3 默认实现）

> 你明确选择：**B 为底，同时尽量拥抱 C（B++）**。这里把它固化为 P3 的默认架构，避免实施时“做到一半又改方向”。
>
> 约束：B++ 必须始终满足“工程可控”——每一步都要 **产物化 + 可缓存 + 可取消 + 可审计**；任何“更强能力”必须通过 feature flags/配置层叠灰度，而不能靠隐式魔法。

**B（商业级可用的可靠底座，P3 必做）**
- `context-pack.json` SSOT + 计数器可解释（Milestone 1）
- prefix determinism（稳定 blocks + toolsetFingerprint）+ 回归（Milestone 2）
- Evidence-first Retrieval（**代码 rg/LSP/文件树 + 资料工作台派生索引**）（Milestone 2.5）
- Secure-by-default（Schema-first + Citation Required + 消耗治理事件化）（Milestone 2.6）
- Tool Belt v1 + Verification gate（让弱模型也能强，且可核验）（Milestone 2.7/2.8）
- 本地缓存 SSOT（LRU/TTL + 命中原因）+ 多厂商归一（Milestone 3/4）
- Compaction 联动（Ledger/Delta）+ UI 非黑盒解释（Milestone 5）
- 最小 Evals（离线质量护栏，防退化）（Milestone 6）

**C（极致能力上限：尽量吸收，但不破坏 B 的可控性）**
- 多 worker 协作是“机制”，不是“某个大模型更聪明”：Router(A/B/C) + Verifier（Milestone 0.5/2.8），未来再扩展 small-LLM worker（P4/后续，P3 只留钩子与协议）。
- 多轮流水线（证据 → 核验 → 生成）：任何阶段都可中止/降级，并写入 events（Milestone 2.5/2.8）。
- “工具优先”替代“塞上下文”：长证据变成 **指针集合 + 锚点 + 对账报告**，并可缓存复用（Milestone 2.7）。
- 自救/灰度：一键 `disable cache` / `force rebuild context-pack` / `strict mode` / `tool belt off`（Milestone 3/5 + 配置层叠）。

**B++ 的最小产物链（每轮至少）**
1) routing capsule + `worker-*.result.json`
2) retrieval artifacts（rewrite/hits/dedupe/report）
3) `verification.report.json` + `verification.capsule.md`
4) `context-pack.json` + fingerprints + cache hit/miss events

#### 2.1.5 生产级可信增强（质变点，P3 必做，不做就很难“让用户信任”）

> 这一节把“从雏型/地基 → 商业级大厦”的质变点列成 checklist，方便你审阅与后续里程碑验收时对账。

1) **Claim-level Verifier 门禁**：关键结论必须可核验（没证据就降级/补证据），并产出 `verification.report.json`（Milestone 2.8）。
2) **确定性与可回归**：stableJson/canonicalization + blocks fingerprints + toolsetFingerprint 进入 cacheKey，且有回归测试（Milestone 2/3/6）。
3) **缓存是 SSOT（provider 只是加速器）**：本地 cache hit/miss 必须可解释、可观测、可淘汰（Milestone 3/4）。
4) **输出指针化（Pointers, not Paste）**：长文本/长证据落盘为 artifacts；对话/上下文只注入摘要+指针（贯穿 Milestone 1/2.5/5）。
5) **最小泄露 + 可共享**：默认安全视图；审计字段懒加载；导出/共享前跑 `redaction-scan`，但不篡改原证据（Milestone 2.7/2.8）。
6) **失败可复盘 + 自动展开**：任何失败必须有 error artifact + event；UI 必须自动展开并给出中文下一步（贯穿 Milestone 0.5/1/2.6/2.8/5）。
7) **可治理的开关**：feature flags + effective config（值来源可对账），避免“一次上线全开”导致不可控（Milestone 3/5）。

#### 2.1.6 子会话窗口 = 可扩展 Worker（按“代理编排”分工，不锁在单一 session）

> 你的选择是 “两者都要（研究/写作/写代码/图书管理员…）”，并且主会话会根据任务性质分配不同子会话窗口去完成任务（参考 `oh-my-opencode`）。
> 这件事我建议 **在 P3 明确作为默认工作模式**：用“可审计的子会话协作”实现跨会话能力，而不是靠“跨会话记忆”。

**核心观点（我的意见）**
- **不要把能力押注在单一 session**：长任务必然需要拆解；拆解最稳定的载体是子会话 micro-pack（可合并、可核验、可缓存），不是对话记忆。
- **子会话应当像“worker”一样被治理**：必须有预算、允许取消、结果产物化、失败可复盘；否则只会变成“更多对话窗口 → 更乱”。
- **模型/厂商不要写死**：像 `oh-my-opencode` 一样，用“Category/Role（意图）+ Skills（流程包）”抽象模型选择，避免模型偏置影响系统行为；映射关系走配置层叠（Section 17.1）。

**落地方式（不新增大系统，复用仓库现状能力）**
- 复用现有 “subagent/agent 编排”机制（代码事实）：`Config.Agent` 支持 `mode=subagent` + `permission` + `prompt`（`packages/opencode/src/config/config.ts`）。
  - 代理定义落在：`.opencode/agents/*.md` / `agents/*.md`（或用户目录的 `.opencode/agents/`），天然可扩展、可版本化。
- 在 P3 的 `task-frame.json` 体系里，显式记录每次子会话委派（delegation）：
  - `delegate.role`（例如：`research`/`writing`/`engineering`/`librarian`）
  - `delegate.agent`（具体 agent 名称，来自 config）
  - `delegate.skills[]`（SkillTool 加载的流程包）
  - `delegate.policy`（strict/balanced/loose）+ `budgets`（wallclock/token/tool）
  - `delegate.inputs[]`（必须是 pointers，不粘贴原文）
  - `delegate.outputs[]`（必须至少包含 micro Evidence Pack pointers）
- 通过 Milestone 1.1（结构化 handoff）把以上“委派契约”证据化；通过 Milestone 2/3 把“委派策略”纳入 determinism/cacheKey（避免同任务分配抖动导致 cache miss）。

**默认 Dispatch Rules（v1，P3 必做，写成可审计规则）**

> 你要求“像 `oh-my-opencode` 一样可编排、可扩展”，但我们要保证 P3 的核心目标：**工程可控**（可审计/可缓存/可取消/可解释）。  
> 所以 dispatch v1 的定位是：**规则优先（deterministic）+ 允许技能/配置覆盖（extensible）**，而不是“让模型自由发挥”。

**输入（作为 cacheKey 与审计的一部分）**
- `task-frame.json`（用户意图 + openQuestions + 证据指针集合）
- `policy`（strict/balanced/loose）
- `budgets`（wallclock/token/tool/concurrency）
- `toolsetFingerprint` + repo/worktree scope（用于稳定分配与缓存命中）

**输出（必须产物化）**
- 每个子会话前：`delegate-frame.json`（见 Milestone 1.1）
- 子会话后：micro-pack 指针（`evidence.micro_pack_emitted` 已具备）+（可选）patch/diff 指针

**规则（v1，足够强且可实现）**
1) **显式优先**：用户显式选择（例如 @某 agent / 指定“开子会话调查”）> 规则；但仍要写 `delegate-frame.json` 记录输入输出指针。
2) **最小必要**：能用 routing/retrieval/tool-belt/verification 在本会话解决的，就不额外开子会话（减少窗口膨胀）。
3) **先证据后实现**：
   - 若任务涉及“需要引用/证据/核验”，优先派 `librarian`/`research`（产出 pointers+anchors），再派 `writing/engineering`。
4) **写代码默认子会话（隔离 workdir）**：
   - 任何会改 repo 的任务默认走 `engineering` 子会话（隔离 workdir + patch/diff artifact），主会话只做 review/合并与 verifier gate（避免主会话被实现细节污染）。
5) **失败语义明确**：
   - 子会话失败必须产出 micro-pack + error artifact；主会话 UI 自动展开并给出中文下一步（符合 UI 工程纪律）。
6) **并发上限**：
   - v1 先限制：同一 parent session 同时最多 N 个子会话 in-flight（默认 1–2）；超出则排队或降级为本会话继续（写 `delegate.degraded` event）。

**DoD（验收标准）**
- 后端：`delegate-frame.json` + `evidence.micro_pack_emitted` +（必要时）patch/diff 指针，都能在 manifest/events 中追溯。
- 协议：delegate-frame 与 micro-pack 指针格式稳定（stableJson + version）；dispatch decision 进入 `decision_boundary` block（Milestone 2）。
- UI：Timeline 出现“已委派：<角色>（可追溯）”；失败自动展开。
- 测试：给定固定 `task-frame.json` + 配置 → dispatch 结果稳定（hash 断言即可，避免复制业务逻辑）。

### 2.2 总设计稿覆盖矩阵（P3 相关 Section → 本计划落点）

> 目的：确保不会漏掉总设计稿中 P3 相关的章节/要求；同时让后续实施可以按里程碑对账。

| 总设计稿 Section（P3 相关） | 要求摘要 | 本计划落点 |
| --- | --- | --- |
| 2.3.1 A/B/C worker 接口契约 | 输入/输出都“产物化”（result.json + capsule.md）；可缓存、可合并、可降级 | 已有协议骨架（P2）；P3 补齐治理/取消/稳定输出（Milestone 0.5/2.5） |
| 2.3.2 WorkerResult schema | worker-result 统一 schema（versioned）；字段必须稳定可对账 | 已有 `routing-worker-result/1.0`；P3 扩展时保持 versioned + 回归（Milestone 0.5/6） |
| 2.3.3 worker result 字段 | A/B/C 的 result 字段定义要稳定；降级状态要一致 | Milestone 0.5（治理）+ Milestone 2.5（检索结果稳定/降级语义） |
| 2.3.4 缓存 key 规则 | routing/retrieval/context 的 key 必须确定性、可解释、可审计；scope 必须对齐租户边界 | Milestone 2.5（retrieval 输出稳定）+ Milestone 3（Context Pack cache key 与 scope） |
| 2.3.5 stableJson / canonicalization | 协议级确定性序列化；集合型数组必须稳定排序；stableJson 版本必须进入 key | Milestone 2（determinism）+ Milestone 2.5（retrieval 排序）+ Milestone 3（cache key） |
| 2.3.6 默认值与降级表 | LSP/rg/索引不可用时必须降级且写 events/risks；不阻塞主流程 | Milestone 0.5（治理/取消/收敛）+ Milestone 2.5（检索降级） |
| 3.1 Cache Store（可插拔、P3/P4 可选 Redis） | 本地缓存为 SSOT；后端可选 `memory|disk|redis`；写 evidence 命中统计 | Milestone 3（Cache Store）+ Milestone 4（多模型归一） |
| 3.2 Provider Prompt Caching | provider 缓存是“加速器”；稳定前缀 + cacheHints；统一指标口径 | Milestone 2（prefix determinism）+ Milestone 4（归一 + Gemini Cached Content） |
| 2.3.8 Worker 资源调度（maxWallClockMs/取消/收敛） | 不让并行把机器打挂；超时/取消要可复盘 | Milestone 0.5（Routing backfill） |
| 8.1 events.jsonl（时间线 SSOT） | 事件必须可关联（routingRunId/contextPackId/verificationId）；时间线可解释 | 贯穿 Milestone 0.5/1/2.8/3/5（新增事件必须带关联 id） |
| 2.3.7.1 协议代码化 + 契约测试 | Zod schema SSOT + contract tests，防漂移，失败必须 `protocol.violation` 且不断链 | Milestone 1（context-pack 写入）+ Milestone 2.5（retrieval 产物）+ Milestone 2.6（schema-first） |
| 16.2.1 Context Pack schema SSOT | 每次调用生成 `context-pack.json`；segments 可解释计数器 | Milestone 1 |
| 16.2.2 UI/CLI 非黑盒展示 | safe/verbose/audited 分级；默认安全；可点回证据 | Milestone 1（事件映射）+ Milestone 5（解释 compaction/ledger） |
| 16.3.1 Evidence-first Retrieval | 二阶段检索/改写/去重/预算裁剪；产物化并可缓存；稳定排序 | Milestone 2.5 |
| 16.3.2 Compression with Guarantees | Facts/Capsule/Manifest 三件套；Ledger/Delta；按需回填 | Milestone 5（compaction 联动） |
| 16.3.3 Secure-by-default | 指令/数据隔离；Schema-first；Citation Required；消耗治理事件化 | Milestone 2.6 +（贯穿 Milestone 1/3/5） |
| 16.4 Prefix determinism | blocks fingerprint + toolsetFingerprint；MCP freeze；动态噪声外移 | Milestone 2 |
| 4 Evidence Pack（对齐 Ideal Evidence Pack） | L0–L4 分层；pack.json/pack.md/manifest/events；micro→macro 合并 | 已具备（P0–P2）；P3 只做必要补强（Milestone 1.1/0.5） |
| 5.1 六个“可验证吸收点”（Codex/GPT 对齐） | call-scoped context pack / workbench / router-first / worker 结构化 / cache 分层 / 可解释时间线 | 贯穿 Milestone 1/2.5/3/4/5（见 2.2.1） |
| 6 沙盒内外上下文与缓存边界 | daemon 统一构建/缓存；沙盒只做一次性执行；缓存按 project/worktree 分域 | Milestone 3（cache scope）+ Milestone 2.6（least disclosure） |
| 7 oh-my 多代理机制吸收 | 按角色分工与委派契约（category/role + skills）；子任务可并行；会话连续性；输出必须产物化可合并 | 已具备部分（P1.6/P2）；P3 明确“子会话=可扩展 worker”（2.1.6）+ 补齐 `delegate-frame.json`/micro-pack 合并（Milestone 1.1）+ 并行治理（Milestone 0.5） |
| 13.3 沙盒内置工具带（Tool Belt） | 用工具检索/抽取/对账换取超长上下文与低幻觉；输出必须指针化可复盘 | Milestone 2.7（Tool Belt v1） |
| 14.1 PythonTool 脚本注册表 | allowlisted registry + sha256 校验；输出必须 evidence 化 | Milestone 2.7（以 allowlisted scripts 形态交付） |
| 17.1 配置层叠 + effective config | P3 能开关/降级/自救；值来源可对账 | Milestone 3/5（加 feature flags 与自救开关） |
| 17.3 Feature flags + Maturity | 易变/高风险能力必须上 feature flags，并标注成熟度（Experimental/Beta/Stable），避免实验能力污染生产 | Milestone 3（feature flags + cache/检索/核验开关与成熟度） |
| 18 回归与门禁 | 同输入→同 cacheKey；版本化；必要时加回归测试 | Milestone 2/3/5（determinism + cache + compaction 回归） |
| 18.1 最小 Evals（质量护栏） | routing/引用/压缩/证据链的离线回归；避免“悄悄退化” | Milestone 6（Minimal Evals） |

#### 2.2.1 对齐 Section 5.1 的 6 个“可验证吸收点”（在 P3 中的落地方式）

> 这 6 点不是“理论参考”，而是你要求的“世界级、可工程验收”的上下文工程手段。这里把它们逐条写成 **P3 的可落地机制**，并明确落点（便于后续验收不跑偏）。

1) **调用级上下文重建（call-scoped Context Pack）** → Milestone 1（每次模型调用生成 `context-pack.json`，计数器来自 segments）
2) **Artifacts-first Workbench（资料产物化）** → Milestone 2.5（资料派生索引进入 retrieval；命中/失败事件化；只注入摘要+指针）
3) **Router-first（先并行拿证据）** → Milestone 0.5（治理/取消/收敛）+ 现有 Routing（request/result/capsule artifacts 不断链）
4) **小模型/工具当 worker（结构化短输出 + 可校验）** → Milestone 2.5（工具优先 + `score_bps` + stable sort）+ Milestone 2.6（schema-first + protocol.violation）
5) **缓存分层（本地 SSOT，provider 为加速器）** → Milestone 3（本地 cache store）+ Milestone 4（provider usage 归一为辅助指标）
6) **可解释时间线（默认安全）** → Milestone 1/3/5（Timeline 展示预算/命中/压缩；审计懒加载；失败自动展开）

#### 2.2.2 对齐 GPT-5.2 / ChatGPT 工具机制（来自 `/Users/muqihang/chelingxi_workspace/OpenAI`，只吸收“可验证机制”）

> 你要求“对齐乃至升华超越 GPT 的能力”。这里遵循总设计稿 Section 5 的原则：**不猜内部实现，只吸收可验证机制**，并把它们落到 P3 的工程 DoD 上。
>
> 对照材料（已阅读）：`gpt-5.2-thinking.md`、`tool-file_search.md`、`tool-advanced-memory.md`、`tool-memory-bio.md`、`prompt-automation-context.md`、`codex-cli.md`。

**可直接吸收的机制（并明确 P3 落点）**
- **Decision boundary（工具触发的确定性门槛）**：哪些情况“必须检索/必须核验/必须降级”，写成规则并纳入 `ContextPack` 的稳定 blocks（Milestone 2 + Milestone 2.6/2.8）。
- **file_search 的“Precision + Recall”双查询习惯**：同一问题至少两类 query（精确问句 + 关键词召回）提升召回率并降低重写误差；并将 query 集合作为 cacheKey 输入（Milestone 2.5 + Milestone 3）。
- **检索 query 的可控 operator**：`+()` boost / `--QDF=` freshness（在本项目中映射为：路径/符号 boost + git recency/mtime 权重），避免“召回靠运气”（Milestone 2.5）。
- **Citations 纪律（引用格式稳定 + 可验证）**：所有“事实/引用”必须能落到 pointers（path+sha256+anchor），并能被 `citation-check` 校验；禁止“看起来像引用但不可点击/不可对账”的伪引用（Milestone 2.7/2.8）。
- **Memory 的结构化注入**：偏好/洞见按条目、带置信度、可审计；并且明确“不要存敏感/不要存短期”（延期到专题研究，不在 P3 实装）。
- **Automation 非交互模式**：当系统处于 batch/自动化时，减少追问、倾向 best-effort 输出；但必须保持证据化与可回滚（P4/后续，P3 只留概念，不实装）。

### 2.3 暂不做（Fusion 冲刺项 / P4 项）

**Fusion 冲刺项（质感封神点，不阻塞 P3）**：
- DESIGN_SPEC_FINAL.md 的 “Neuro-Link Jitter / Liquid Morph / Haptic Ripple”等变态级微交互（可留架构钩子，但不做 full fidelity）。

**明确不属于 P3（但需要在边界上写清楚，避免误会）**：
- **Worker B/C（KB/Graph）的“真实引擎接入”**：P3 只保证 `unavailable/degraded` 的证据化降级，不承诺接入 PG/Qdrant/Neo4j 全套（见总设计稿 Section 2.3）。
- **shell_snapshot / unified_exec（PTY-backed）**：只留钩子，不在 P3 实装（见总设计稿 Section 5.2 (6)）。
- **opencode exec（非交互模式）**：不在 P3 承诺范围内（见总设计稿 Section 5.2 (8)）。

**明确属于 P4（不在 P3 承诺范围内）**：
- 硬沙盒后端（bwrap/nsjail/sandbox-exec/Job Object）与真实能力声明、OTel GenAI semconv 全量对齐、企业治理（requirements/managed defaults）、远端归档/Retention/索引。
- **Memory / 记忆系统（跨会话偏好/洞见沉淀）**：延期到专题研究（单独写 design + threat model + UI/治理；避免 P3 引入黑盒风险）。

**说明（避免重复造轮子）**：
- **Undo / Snapshot**：仓库已具备（`packages/opencode/src/snapshot/*`），P3 不再重复“发明撤销机制”，只需要在 Context Pack/Timeline 的叙事里能正确引用其 evidence/events（如果相关）。

**P2.6/架构清理候选（除非成为 P3 阻塞，否则只记录不推进）**：
- `packages/ui/src/components/message-part.tsx` 超大文件拆分、ToolOutput 专用渲染器、Smart Scroll 等（见 `docs/plans/2026-02-01-p2-5-ui-global-review.md`）。

---

## 3. P3 里程碑（可验收 + 每个里程碑 DoD）

> 里程碑按“先立 SSOT → 再做确定性 → 再做缓存与观测 → 再做厂商适配 → 再做 compaction 联动与 UI 解释”排序，避免先优化后返工。

### Milestone 0：P3 隔离工作区 + 基线验证（只做准备，不实现功能）

**目标**：为后续实现建立“可回滚、可对账、可验证”的干净基线。

**操作**：
- 使用 `superpowers:using-git-worktrees` 创建 worktree：`.worktrees/p3-context-pack`（分支：`p3-context-pack`，基于 `feature/opencode-custom`）。
- 基线验证（禁止跑根目录）：
  - `cd packages/opencode && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test`
  - `cd packages/app && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun run typecheck`
  - `cd packages/app && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test src`

**DoD**
- UI：无（不改 UI）
- 后端：无（不改代码）
- 协议：无
- 测试：上述 3 组命令均 PASS，作为后续回归对照

---

### Milestone 0.5：P0–P2 回填（确保 Section 2/5 的“并行治理”真的落地）

**目标**：把总设计稿 Section 2.3.8 的“资源治理/取消/收敛”从文档变成可复盘行为；避免后续 P3 叠加 context/retrieval 后出现“并行越多越慢/卡死/难复盘”。

**现状（代码事实）**
- `RoutingRunner` 已写入 `routing.started` / `routing.completed`，并对每个 worker 做 `workerTimeoutMs`（`withTimeout`），但：
  - `maxWallClockMs` 目前没有在 runner 内真正生效（只记录在 request.json budgets）
  - worker 取消/收敛事件（`routing_timeout`/`routing_cancelled`/`routing_late_result`）未落地
  - Worker A/B/C 支持 `signal?: AbortSignal` 入参，但 runner 当前未传递，导致“取消”无效

**后端（DoD）**
- `packages/opencode/src/routing/runner.ts`：
  - 实现 `maxWallClockMs`：到达总预算后取消剩余 worker，并立即聚合已有结果写 `routing.completed`
  - 增加事件（最小可用即可，命名遵循 dotted 规范）：
    - `routing.timeout`：总预算触发（data: routingRunId + cancelledWorkers）
    - `routing.cancelled`：同一 session 的新 routing run 取消旧 run（受 `maxRoutingRunsInFlight` 约束，默认 1），或用户显式取消（data: previousRunId/newRunId + reason）；**不用于“全局并发淘汰”**
  - 将 `AbortSignal` 传入 WorkerA/B/C，并在 WorkerA 的扫描循环内周期性检查 `signal.aborted`（避免大仓库扫描卡死）
  - 同步补齐 `maxRoutingRunsInFlight` 的真实语义（目前 config 已有但 runner 未实现）：默认 1 → 新输入 supersede 旧输入，避免“并行越多越慢/越乱”

**协议（DoD）**
- 不新增 schema（v1 先靠 events + artifacts），但事件字段必须稳定、可 grep、可用于 UI 人话叙事。

**UI（DoD）**
- App/TUI 的 turn timeline 能把 `routing.timeout/routing.cancelled` 映射成中文人话，并在 `needs_attention/failed` 语义下自动展开（符合 UI 工程纪律）。

**测试（DoD）**
- `packages/opencode`：新增单测构造一个“慢 worker”场景，断言：
  - 达到 `maxWallClockMs` 后不会等待慢 worker
  - 写入对应事件，且 `routing.completed` 仍会产出（证据不断链）
  - 同一 session 在前一 run 未完成时发起新 run → 旧 run 被取消并写入 `routing.cancelled`（并且不会把 Evidence 链写断）

---

### Milestone 1：Context Pack SSOT（生成 + 落盘 + evidence/events 对账）

**目标**：把 `context-pack.json` 变成“每次模型调用必有的证据化资产”，并可被 UI 解释。

**后端（DoD）**
- 在模型调用入口（建议：`packages/opencode/src/session/llm.ts`）增加 **ContextPack 生成与写入**：
  - 每次 `LLM.stream()` 发起模型调用前：
    - 构建 `ContextPack`（`specVersion=context-pack/1.0`，包含 window/budgetTokens、segments、versions、ledger）。
    - 写入 artifact：`.opencode/artifacts/<sessionId>/context/<contextPackId>/context-pack.json`
    - 写 evidence event：`context.pack_built`（data 至少包含 `contextPackId` + artifact path + totals.tokenEstimate + window.maxTokens/budgetTokens）
- 约束：**UI 计数器必须可从 segments 解释**（至少先提供 segments 的 kind/priority/tokenEstimate）。

**协议（DoD）**
- 复用现有 schema：`packages/opencode/src/protocol/context-pack.ts`（不得随意改字段；如需变更，先 bump specVersion 并加回归）。

**UI（DoD）**
- App/TUI Chronology engine 能识别 `context.pack_built` 并在“人话视图”展示为：
  - 示例：`上下文：已整理（18%）` / `上下文：预算 60k / 128k`（中文人话）
- 审计信息（segments 明细/原始 JSON）必须懒加载：默认不读文件内容；用户点击 Inspect 才通过 `file.read` 拉取 `.opencode/.../context-pack.json`。

**测试（DoD）**
- `packages/opencode`：新增单测覆盖 `ContextPack` 生成（schema parse + totals/segments 一致性）。
- `packages/app`：Chronology/Activity 的单测覆盖 `context.pack_built` → `ActivityItem` 映射与中文叙事。

---

### Milestone 1.1：通用任务的“结构化 Handoff”（Task Frame + Evidence-backed Capsule，0 幻觉）

**目标**：把“通用任务请求”（不仅是写代码）也纳入同一套上下文工程：让主代理/小代理/工具协作时，始终以 **结构化、可追溯、可合并** 的资产为中心，而不是靠大段对话记忆。

**后端（DoD）**
- 每个 user turn（messageId）生成一个 `task-frame.json` artifact（稳定路径建议）：
  - `.opencode/artifacts/<sessionId>/task/<messageId>/task-frame.json`
- 子会话/子任务不是“只靠记忆传话”，而是 **同一协议体系的可合并产物**（参考 `oh-my-opencode` 的“分工代理”思想，但以本仓库协议为 SSOT）：
  - 父会话在启动子会话前必须生成一个 `delegate-frame.json`（建议稳定路径）：
    - `.opencode/artifacts/<sessionId>/delegate/<delegateId>/delegate-frame.json`
    - 最小字段建议（v1 可不 schema 化，但必须 stableJson）：`role`、`agent`、`skills[]`、`policy`、`budgets`、`inputs[]`（pointers）
  - 子会话启动时必须拿到明确输入：
    - 父会话 `delegate-frame.json` 指针（而不是复制一大段上下文）
    - 本子任务的目标/预算/工具限制（与 `Config.Agent.permission` 对齐）
  - 子会话完成后必须产出 micro Evidence Pack（P1/P2 已具备）：
    - 主会话只合并 **指针 + claims/checks**（不粘贴全文）
    - 若子会话产生代码变更：必须提供 patch/diff artifact 指针（避免“我改了但你看不到”）
  - 这套机制提供“跨会话协作能力”，但不等同于“跨会话记忆系统”（记忆系统延期专题研究）
- P3 默认支持的子会话角色（Role）建议（可通过 `.opencode/agents/*.md` 扩展，不写死）：
  - `librarian`：资料/文档“馆员”（以检索与指针为产出，不写结论；产出 hits + anchors）
  - `research`：调查研究（产出 findings + 支撑 pointers；必要时触发 verifier）
  - `writing`：写作/整理文档（产出结构化草稿 + 引用指针；不改代码）
  - `engineering`：实现/改代码（默认 isolated workdir；产出 patch + tests 结果 + 风险/回滚）
- `task-frame.json` 必须满足 **0 幻觉** 约束：
  - 只包含两类信息：
    1) **可直接对账的事实**（来自用户输入、配置、路由/检索 artifacts、workbench inputs 等）
    2) **显式的不确定项**（`openQuestions[]`），而不是“猜测结论”
  - 任何“推断/建议”不得写成事实；如果必须写建议，必须带 `evidence[]` 指针或明确 `confidence<1`。
- `ContextPack` 的 `capsule` segment 必须引用 `task-frame.json`（sources 指针），从机制上确保 capsule 不会凭空编造。

**协议（DoD）**
- v1 先不新增 Zod schema（避免扩散协议面），但必须 stableJson + 版本号字段（例如 `specVersion: task-frame/1.0`）以便后续缓存与回归。

**UI（DoD）**
- App/TUI 审计视图可通过 pointers 打开 `task-frame.json`（懒加载），并在人话视图展示为“已整理任务上下文（可追溯）”。

**测试（DoD）**
- 单测覆盖：`task-frame.json` 的生成是确定性的（同输入/同指针集合→同 stableJson 输出）；且不允许出现“没有 evidence 的断言字段”（硬门禁）。

---

### Milestone 2：prefix determinism（稳定 blocks + toolsetFingerprint + 回归测试）

**目标**：让 prompt caching 的“exact prefix match”变成工程纪律：可解释、可回归、可定位 cache miss。

**后端（DoD）**
- 在 Context Builder 中明确拆分并固定顺序的 prefix blocks（写入 `context-pack.json.versions` + 作为 fingerprints 输入）：
  1) permissions_instructions（sandbox/approval 概述）
  2) developer_instructions（全局/团队策略）
  3) user_instructions（AGENTS.md 规则合并后的最终结果）
  4) toolset（工具列表 + schema）
  5) environment_context（cwd/worktree/runtime）
  6) capsule+pointers（本轮证据摘要与指针）
  7) decision_boundary（工具触发/核验/降级规则，确定性文本块）
- 实现 **toolset determinism**：
  - tool list 必须稳定排序（`toolName asc`）
  - tool schema 需 canonicalize（stableJson）并生成 hash
  - 汇总为 `toolsetFingerprint`，写入 `context-pack.json`（建议放入 `totals` 或 `ledger.notes` 的结构化字段；如需扩展 schema，先设计并加 tests）
- MCP 工具集变更 freeze：
  - 工具集变化不得 mid-turn 生效；至少“本轮之后再生效”，并写 evidence event（例如 `tools.list_changed`）。

**协议（DoD）**
- stableJson 的版本号必须进入 fingerprint/key 计算；任何排序/字段变更必须 bump 版本并加回归。

**UI（DoD）**
- 审计视图可以显示 fingerprints 摘要（不泄露全文）：哪些 block 变了（帮助解释 cache miss）。

**测试（DoD）**
- 新增 determinism 回归测试：同样输入（同 tools 集合/同 AGENTS/同 cwd）→ 生成相同 fingerprints 与 cacheKey（golden snapshot 或 hash 断言）。
- 覆盖 “cwd 变化只影响 environment block” 的分离性测试（避免无关抖动打碎缓存）。

---

### Milestone 2.5：Evidence-first Retrieval（Query Rewrite + 二阶段检索 + 预算裁剪 + 去重）

**目标**：把 “超长上下文” 从“塞更多”升级为“塞更对 + 可缓存 + 可复盘”：检索链路工程化、可观测、确定性。

**后端（DoD）**
- 在 Context Builder 构建 `ContextPack` 前新增一个稳定流程（可先 rule-based，保证确定性）。本 milestone **范围已确认：同时覆盖代码检索 + 资料工作台派生索引**：
  1) **Query Rewrite**：把用户意图改写为结构化 queries + filters（产物化、可缓存）
  2) **Recall**：工具/索引召回候选（两条通道都要打通）：
     - 代码通道：rg（建议 `rg --json`）/LSP/文件树
     - 资料通道：资料工作台派生索引（PDF/Docx/Archive 的 derived text/structure）
  3) **Rerank（v1 规则优先）**：输出 `score_bps`（整数）+ 稳定 tie-break
  4) **Budgeted Selection**：按 `budgetTokens` 选择片段并稳定排序
  5) **Dedup**：内容哈希去重 + 重叠去重（产出 report）
- 对齐 `tool-file_search.md` 的“最小可控检索习惯”（把检索做成工程纪律）：
  - Query Rewrite 至少产出两类 query（同一轮必须都有，且都进入 cacheKey）：
    1) **Precision Query**：用户原始问题的“消歧完整句”（中文/英文各一份，避免代码/文档只写英文导致搜不到）
    2) **Recall Query**：1–2 个短关键词（不加修饰，最大化召回；用于兜底）
  - 支持最小 operator（落在 JSON 中，v1 可不拼字符串也行）：
    - `boost`: `paths[]` / `symbols[]` / `kinds[]`（对齐 `+()` boost 的思想）
    - `freshness`: `gitRecencyDays` / `mtimeDays`（对齐 `--QDF=` 的思想）
  - retrieval 输出 hits 必须带 `anchor`（行号/页号/段落 id），用于后续 `doc-quote-anchor`/`citation-check` 校验与 UI 打开定位
- 代码通道最小实现建议（优先复用仓库既有模块，避免重复造轮子）：
  - ripgrep：优先使用 `packages/opencode/src/file/ripgrep.ts`（`Ripgrep.search` 已是 `--json` 解析）产出结构化 matches。
  - 文件树：优先使用 `Ripgrep.tree` / `Ripgrep.files` 做“可解释的候选空间收敛”（并确保稳定排序）。
  - LSP：优先使用 `LSP.workspaceSymbol` 做 symbol seeds；如果 LSP 不可用则 **降级为** ripgrep + 文件树，并写 events/risks（见总设计稿 Section 2.3.6）。
- 资料通道最小实现建议（直接消费 Workbench 的派生 artifacts，确保“可引用、可缓存、可复盘”）：
  - PDF：消费 `derived/<inputId>/pdf.pages.json` + `derived/<inputId>/pdf/pages/*.txt`（或等价路径）；命中时 hits 必须能指回具体页（page number + path + sha256）。
  - Docx：消费 `derived/<inputId>/docx.structure.json`，以 chunk/snippet 为最小引用单元（而不是“我读过某 docx”）。
  - Archive：消费 `derived/<inputId>/unpacked/filelist.json`；召回时至少做到：
    - 能把“可疑相关的文件（path+sha256）”列出来（候选空间）
    - 对文本型文件允许进一步用 rg 在 `derived/<inputId>/unpacked/` 里查（仍然产物化 hits；避免把整包展开内容粘回 prompt）
- 建议 artifacts（路径稳定，便于 grep 与缓存）：
  - `.opencode/artifacts/<sessionId>/retrieval/<id>/query-rewrite.json`
  - `.opencode/artifacts/<sessionId>/retrieval/<id>/hits.json`
  - `.opencode/artifacts/<sessionId>/retrieval/<id>/dedupe.report.json`
- 对资料工作台（workbench）额外要求（避免“解析了但用不上”）：
  - 资料派生结果必须能被 retrieval 消费：至少确保存在可 rg 的文本产物（例如 `derived/<inputId>/text/*.txt` 或等价路径），并能回溯到 `inputId` 与来源文件名。
  - retrieval 输出的 hits 必须能指向 workbench artifacts（路径 + sha256），而不是只写“我看过某 PDF”。
- 事件：`retrieval.started` / `retrieval.completed` / `dedupe_applied`（都要带 artifacts pointers）。
- 降级必须可复盘（总设计稿 Section 2.3.* 的硬约束）：
  - LSP 不可用 → `worker.unavailable` 或 `retrieval.degraded`（二选一，但命名要稳定）+ 风险提示（影响：只能 lexical，可能漏召回）
  - 资料派生不可用（例如 `pdftotext` 缺失）→ 产出 error artifact（WorkBench 已有 `file-pdf-error`/`file-docx-error`/`file-unpack-error` 的模式）+ `retrieval.degraded`

**协议（DoD）**
- v1 可先不引入新 Zod schema（只要 stableJson + evidence 不断链）；但必须做到：
  - 输出结构化 JSON
  - 稳定排序规则固定（避免缓存抖动）
  - 版本号进入 cacheKey（改规则必须 bump 版本）

**UI（DoD）**
- 人话视图能出现“已检索证据/已筛选片段”的叙事节点（不要展示 query 细节）。
- 审计视图可打开 `query-rewrite.json / hits.json / dedupe.report.json`（懒加载）。

**测试（DoD）**
- 单测覆盖：同输入→同 query rewrite 输出（稳定），同候选→同排序与裁剪（稳定），dedupe 输出可复盘。
- 加一条“端到端最小回归”（不依赖真实模型）：给定固定 repo fixture + workbench fixture → 产生固定 hits（hash 断言即可，避免复制逻辑）。

---

### Milestone 2.6：Secure-by-default（指令/数据隔离 + 引用强约束 + 消耗治理）

**目标**：让“低幻觉/可控成本”变成机制，不靠提示词自觉；对通用任务同样成立（不仅是写代码）。

**后端（DoD）**
- **Instruction-Data Separation**：
  - 检索/资料内容默认进入 `evidence_pointers/files` 等专用 segments，并标注为 untrusted；
  - system 模板明确：资料中出现“指令性文本”一律忽略，仅作证据阅读。
- **Schema-first + Output Validation**：
  - 对任何结构化产物（context pack/retrieval 输出/compaction 输出）都要 Zod parse；失败写 `protocol.violation` 并降级（证据不断链）。
- **Citation Required**（主代理关键 claim 默认需要指针）：
  - 能引用则引用（manifest entry/sha256）
  - 不能引用必须承认不确定并触发补证据（routing/retrieval）
- **消耗治理事件化**：
  - token/time/并发/重试上限触发必须写 events（否则用户无法理解降级/停止原因）。

**UI（DoD）**
- 默认 safe 摘要；敏感原文只通过 pointers 查看（懒加载）。
- 若触发限流/熔断/需要人工确认：失败/needs_attention 必须自动展开（符合 UI 工程纪律）。

**测试（DoD）**
- 用最小 fixture 测试：资料里包含“恶意指令”时不会污染 system 指令块；Citation Required 未满足会触发补证据路径。

---

### Milestone 2.7：Tool Belt v1（可验证的“增强工具带”，让弱模型也能强）

**目标**：把“超长上下文 + 低幻觉 + 可审计”从 prompt 技巧升级为 **工具化能力**：用脚本/工具做检索、锚定、复算、校验与脱敏，输出结构化证据资产并可缓存复用。

> 关键定位：Tool Belt 是通用能力，不是行业绑定。法务/审计只是最严格的验收门槛。

**后端（DoD）**
- 以 `PythonTool` 的 allowlisted scripts 机制为主（`packages/opencode/src/tool/python.ts` + `packages/opencode/src/python/registry.ts`），新增并内置 4 个生产级脚本（输出必须“结构化 + 指针化”，并写入 evidence/events）：
  1) `citation-check`：引用校验器（pointers 存在性/sha256/定位合法性）
  2) `doc-quote-anchor`：文档引用锚定器（PDF 页/Docx 段落 → anchors，输出 `score_bps` + 稳定排序）
  3) `table-check`：数值对账/复算器（金融/审计常用，但本质是通用“数值核验”能力）
  4) `redaction-scan`：最小泄露扫描器（用于导出、共享、审计视图；不自动改写原 artifacts，避免破坏证据链）
- 每个脚本必须具备统一的“可缓存可复盘”约束：
  - 输入：stableJson（包含 `specVersion` + `policyVersion`）
  - 输出：stableJson + rg-friendly 的 `.md` view（v1 默认生成；view 只用于人类阅读，不承载 SSOT）
  - cacheKey：`sha256(stableJson(input_json))`（版本变更必须 bump）
  - 失败：必须产出 error artifact + event（不得 silent fail）

**脚本规格（v1，可直接落地为新的 allowlisted scripts）**

> 目标是“可落地、可质变”，所以这里把 4 个脚本写成明确的 I/O 契约与落盘形态，避免实施阶段变成“写脚本但不可复盘/不可缓存”。

- 统一落点（建议）：
  - 新增脚本文件：`packages/opencode/src/python/scripts/<script-id>.py`
  - 追加 allowlist：`packages/opencode/src/python/scripts.manifest.json`（每次变更必须更新 sha256）
- 统一输入：`input_json.specVersion` + `input_json.policyVersion` + `input_json.pointers[]`（若适用）
- 统一输出（JSON）：`specVersion` + `cacheKey` + `summary` + `items[]`（必须稳定排序）
- 统一输出（v1 默认生成 MD）：`<script-id>.view.md`（rg-friendly，人类可读但不承载 SSOT）
- 统一事件：`toolbelt.<script_id>.completed`（data 至少包含 counts + cacheKey + ok）

1) `citation-check`（引用校验器）
   - 输入（建议最小字段）：`{ specVersion: "citation-check/1.0", policyVersion: "v1", pointers: [{ path, sha256, kind?, anchor? }] }`
   - 输出：逐 pointer 给出 `ok/missing/hash_mismatch/anchor_invalid`，并汇总 `unsupportedClaims`（供 Verification 阶段阻断/降级）
   - 约束：只做“存在性/一致性/锚点合法性”校验；不尝试从网络补证据（补证据走 Milestone 2.5）

2) `doc-quote-anchor`（文档引用锚定器）
   - 输入：`{ specVersion: "doc-quote-anchor/1.0", policyVersion: "v1", quotes: [{ text, sourcePointer }], topK }`
   - 输出：为每条 quote 给出候选 anchors（例如 `page/lineStart/lineEnd/chunkId`）+ `score_bps`，并保证稳定排序（同输入→同输出）
   - 约束：优先只消费 Workbench 派生 artifacts（PDF pages txt / docx structure / archive unpack list），不直接解析原始二进制文件（避免重复实现与不可控依赖）

3) `table-check`（数值对账/复算器）
   - 输入：`{ specVersion: "table-check/1.0", policyVersion: "v1", cases: [{ title, inputs: [{ pointer, note? }], checks: [{ kind, expr?, expected? }] }] }`
   - 输出：每个 case 的 `computed[]` 与 `mismatches[]`（人话解释 + 指针），用于把“数字断言”变成可核验资产
   - 约束：保持通用（不绑定法务/审计领域）；领域规则应外置到 skills/prompt packs

4) `redaction-scan`（最小泄露扫描器）
   - 输入：`{ specVersion: "redaction-scan/1.0", policyVersion: "v1", pointers: [{ path, sha256 }], rules?: { pii?: boolean, secrets?: boolean } }`
   - 输出：`findings[]`（含 severity + location + reason + suggestedAction）；**不自动改写** artifacts（避免破坏证据链）
   - 约束：默认用于“导出/共享/审计展开”前的风险提示；真正的脱敏动作若要做必须产出新 artifact 并清晰记录 provenance（P4）

**协议（DoD）**
- v1 先不增加新的顶层协议文件，但每个脚本输出必须带 `specVersion`，并且能被 Zod 校验（可把 schema 放在 `packages/opencode/src/protocol/` 或脚本内内嵌最小校验）。

**UI（DoD）**
- Timeline 可展示工具带节点（人话摘要）：
  - `引用已核验 / 引用不足 / 已完成脱敏扫描 / 数值已复算`
- 审计视图可懒加载打开工具输出 artifacts（默认安全）。

**测试（DoD）**
- `packages/opencode`：为每个脚本准备最小 fixture（不走真实网络），断言输出结构稳定 + 排序稳定 + cacheKey 稳定。

---

### Milestone 2.8：Verification Pipeline（Verifier Worker：把“接近 0 幻觉”做成门禁）

**目标**：把“可信输出”做成流水线门禁，而不是依赖模型自觉：任何关键结论（claims）必须有可验证 pointers；没有证据就降级为“不确定 + 下一步补证据”。

**后端（DoD）**
- 在 “Evidence-first Retrieval → Secure-by-default” 之后，增加一个通用的 Verification 阶段（可作为 routing 的后处理，也可作为 Context Builder 的前置）：
  - 输入：`task-frame.json`（Milestone 1.1）+ retrieval hits + candidate claims（草稿）+ pointers
  - 执行：
    1) 运行 `citation-check`（门禁）
    2) 若涉及文档引用：运行 `doc-quote-anchor` 补齐锚点（可选，但建议对高风险 profile 默认启用）
    3) 若涉及数值断言：运行 `table-check`（可选，但建议对包含数字的 claim 默认启用）
    4) 导出/共享/审计视图前：运行 `redaction-scan`
  - 输出：`verification.report.json`（逐 claim 的 supported/unsupported + reasons）+ `verification.capsule.md`（给主代理/下游消费）
- 将 “可信输出策略”做成可配置的通用策略（见 2.1.3）：
  - 默认建议：`balanced`
  - 通过 skill/profile 可切换为 `strict`（高风险门槛）或 `loose`（创意/探索任务）
- 对齐 “Citations 纪律” 的硬要求：
  - 主代理对用户输出的关键 claim 必须能映射到 `verification.report.json` 的 evidence 列表
  - evidence 引用必须是“可核验指针”（path+sha256+anchor），禁止只写“我看过某文件/某 PDF”
  - `citation-check` 必须能检测并阻断“伪引用”（格式看似引用但无法在 manifest 中定位）
- Verification 必须写入 evidence events：
  - `verification.started` / `verification.completed`
  - `verification.blocked`（strict 模式下无法输出关键结论）
  - `verification.degraded`（工具不可用/输入不完整）

**协议（DoD）**
- Verification 输出至少满足：
  - “可 grep、可引用、可缓存、可解释”
  - 每条 claim 都能追溯到 pointers（或明确标注 unsupported）

**UI（DoD）**
- 人话视图必须能读懂：
  - `已核验` / `未核验（证据不足）` / `需人工确认`
- 任一 `blocked/failed/needs_attention` 必须自动展开（符合 UI 工程纪律）。

**测试（DoD）**
- 用 fixture 覆盖三种策略：
  - strict：缺证据 → 阻断结论输出
  - balanced：缺证据 → 自动触发补检索/补核验一次（若仍不足则降级）
  - loose：允许输出推测，但必须显式标注推测且不能伪装成事实

---

### Milestone 3：Context Pack Cache Store（LRU/TTL + 命中统计 + 证据化）

**目标**：把“同类任务重复执行能稳定命中”落到本地 SSOT：cache key 可解释，命中率可观测。

**后端（DoD）**
- 新增 Context Pack cache（默认 memory+disk）：
  - key = sha256(stableJson({ versions + blockFingerprints + toolsetFingerprint + repo/worktree scope + capsule fingerprint + file hashes }))
  - hit 时：复用 cached segments/template（避免重复检索/切片/估算），但**仍然为本次调用生成新的** `contextPackId/createdAtUtc` 并落盘新的 `context-pack.json`；同时写 event：`cache.hit`（含 key、scope、reason）。
  - miss 时：写 event：`cache.miss`（含 reason：repo_changed/toolset_changed/ttl_expired/disabled）。
- 需要有 LRU/TTL（最小可用即可）：避免 cache 无限增长；淘汰策略与容量写入配置（可先默认值）。
- **Feature flags + Maturity（总设计稿 Section 17.3，P3 最小落地）**：
  - 把易变/高风险能力都做成可治理开关（并标注成熟度），至少包含：
    - `context_cache`（Stable/Beta：取决于你对稳定性的要求；默认开启）
    - `retrieval`（Beta：默认开启）
    - `toolbelt`（Beta：默认开启；可一键关闭以快速定位问题）
    - `verification`（Beta：默认开启；strict/balanced/loose 由 profile 决定）
    - `gemini_cached_content_automation`（Experimental：默认关闭或灰度开启，避免一次性引入复杂生命周期）
  - 每个开关的 effective 值必须能被对账：至少写入一次 evidence event（例如 `config.effective` 或按模块写 `context_cache.effective`），并能解释 cache miss 的 `reason=disabled`。
- 同期把缓存从“只缓存 context-pack”扩展到“缓存构建依赖”（P3 核心要求）：
  - 文件内容哈希/切片结果缓存（避免重复读取与重复估算）
  - retrieval hits 缓存（配合 Milestone 2.5 的确定性输出）
  - verification 报告缓存（配合 Milestone 2.8）：同一组 pointers + 同一 policyVersion → 复用核验结果（省 token/省时间）
  - 统一按 project/worktree 分域（必要时细化到 session/user）

**协议（DoD）**
- cache hit/miss 的事件与字段需要有稳定命名（可先走 events.jsonl + data 字段；后续再 schema 化）。

**UI（DoD）**
- Turn Live Capsule / Timeline 中能展示 cache 命中摘要（中文人话），例如：`命中缓存（上下文复用）`。
- 审计视图可看到 cache key/hash 与命中原因（不泄露敏感原文）。

**测试（DoD）**
- `packages/opencode`：cache store 的单测（set/get/ttl/evict；key 稳定性）。
- 回归：重复同输入两次，第二次必须命中（可用测试替身构造固定 blocks；避免依赖真实模型）。

---

### Milestone 4：多模型缓存与 usage 归一（DeepSeek/GLM/MiniMax/Gemini/Claude/OpenAI）

**目标**：把“厂商差异”隔离到 adapter/normalizer 层：上层只看统一的 `tokens.cache.read/write` 与可对账的命中指标。

**后端（DoD）**
- 统一 usage 归一层（建议从 `packages/opencode/src/session/index.ts:getUsage` 抽出为可测试的 pure function）：
  - DeepSeek：读取 `prompt_cache_hit_tokens`（已做，补齐 miss/hit 口径与兼容字段）。
  - GLM：支持 `prompt_tokens_details.cached_tokens`（见 `docs/plans/2026-01-29-zai-glm-4_7-api-notes.md`）。
  - MiniMax（Anthropic-compatible）：支持 `cache_control` 与 usage 的 `cache_read/cache_write` 字段归一（见 `docs/plans/2026-01-29-minimax-m2_1-api-notes.md`）。
  - Claude/Anthropic：把 cache read/write 的 metadata 字段完整映射进 `cache.read/cache.write`（当前仅写入 cache.write，需补齐 cache.read）。
  - Gemini：接入 Cached Content 自动化（创建/复用/失效管理）；并把 `usageMetadata.cachedContentTokenCount`（或等价字段）映射到 `cache.read`（见 `docs/plans/2026-01-29-gemini-antigravity-api-notes.md`）。

**协议（DoD）**
- 对外展示的 SSOT 字段必须一致：无论 provider 如何返回，都统一到 `Message.tokens.cache.read/write` 与 evidence/events 的命中指标。

**UI（DoD）**
- UI 里展示的 “Cache Read/Write” 逻辑不依赖 provider 私有字段；只读统一 tokens 字段。
- 对 Gemini Cached Content：人话视图只显示“已复用缓存内容”，审计视图可显示 cached content id（如属于敏感可做 redaction）。

**测试（DoD）**
- 为每个 provider 准备最小 JSON fixture（不走真实网络），测试归一结果：
  - DeepSeek hit tokens → cache.read
  - GLM cached_tokens → cache.read
  - Anthropic/MiniMax cache_read/cache_write → cache.read/write
  - Gemini cachedContentTokenCount → cache.read（以及 cached content lifecycle 的状态机测试）

---

### Milestone 5：Compaction 联动 + UI “非黑盒解释”（把 54%→10% 做实）

**目标**：让“上下文变短”来自 **可追溯资产化**，并在 UI 里可解释：为什么变短、丢了什么、凭什么可信。

**后端（DoD）**
- compaction 输出改为 “结构化 + 指针化”：
  - 产物至少包含：`capsule.md`（rg-friendly）、`facts.json`（key-value SSOT）、manifest pointers（sha256 可追溯）
  - 与 `ContextPack.ledger` 联动：支持 `mode=delta`，并记录 `previousContextPackId`
- 自动 compaction 触发（软/硬阈值）与证据化说明：
  - `softThreshold/hardThreshold/emergencyThreshold` 的默认值与事件必须可对账（写 events）。

**协议（DoD）**
- compaction 产物进入 evidence manifest；任何写入失败必须产出 `evidence.write_failed`（不得静默）。

**UI（DoD）**
- Turn Timeline 能展示 “上下文已压缩/已重建” 的人话事件；失败必须自动展开并给出恢复建议（例如“可禁用缓存/强制重建 context-pack”入口留钩子）。
- 审计视图可展开查看：segments 列表、ledger delta、fingerprints 变化。

**测试（DoD）**
- compaction 的回归测试：同一会话多轮后触发 compaction，下一轮 context-pack tokenEstimate 明显下降，且 `sources` 指针完整可追溯。

---

### Milestone 6：最小 Evals（离线质量护栏，单人也能跑）

**目标**：把“工程可控”落到可重复执行的离线评估上：确保 routing/retrieval/compaction/evidence 不会在迭代中悄悄退化（总设计稿 Section 18.1）。

**后端（DoD）**
- 在 `packages/opencode` 增加一个最小入口（建议 `opencode debug eval` 或等价命令），跑一组离线样本并输出一份 Evidence Pack（eval 自己也必须证据化）：
  1) **Routing 契约回归**：生成/读取 `request.json` 与 `worker-*.result.json`，验证 schema parse + stableJson hash 稳定
  2) **Retrieval 确定性回归**：同输入→同 `query-rewrite.json/hits.json/dedupe.report.json`（hash 断言即可）
  3) **Compaction 不漂移**：compaction capsule/ledger 中的关键结论必须指向至少一个 manifest entry（pointers-not-paste）
  4) **Evidence 断链检测**：routing/context-pack/retrieval/compaction 相关 artifacts 必须在 manifest.json 中可追溯（含 sha256）
  5) **Verification 门禁回归**：strict/balanced/loose 三种策略行为不漂移（避免“悄悄变宽松”导致信任崩塌）

**协议（DoD）**
- eval 输出仍然遵循现有 Evidence Pack 结构：`pack.json/pack.md/manifest.json/events.jsonl`，并清晰标注 `task.title`/`actors` 为 eval（避免与真实会话混淆）。

**UI（DoD）**
- 无强制 UI；但至少保证 eval 的 evidence 可以通过现有 `GET /:sessionID/evidence/*` 拉取（便于未来接 UI）。

**测试（DoD）**
- `packages/opencode`：为 eval 的“断链检测”写单测（输入一个模拟 manifest + artifact 列表，断言缺失时会 FAIL 且给出中文可读错误）。

---

## 4. 执行节奏与提交策略（建议）

- 每个 milestone 内部按 TDD 拆小步提交（每次只做一个“可证明的增量”）。
- 每个 milestone 结束必须跑回归（按包）并写入 evidence checks（若本阶段涉及 gates）。
- 任何 schema/稳定序列化变更必须：
  1) bump 版本号（specVersion 或 versions.*）
  2) 补 determinism 回归测试
  3) 在计划/PR 描述中明确“为何变更、如何对账”

---

## 5. 进入实施前需要你确认的点（避免跑偏）

1) **Gemini Cached Content 自动化**：P3 是否要一次性做“创建/复用/失效”全链路？还是先落地接口与观测（最小可用），下一轮再做完整生命周期？
2) **Context Pack UI 展示位置**：优先放在 App 的 `Turn Live Capsule`（强产品感），还是先放在 Activity Panel（更工程化但风险更低）？
3) **缓存淘汰默认值**：你希望更保守（命中率优先）还是更省空间（磁盘/隐私优先）？（会影响默认 TTL/LRU 上限）
4) **Evidence-first Retrieval 的范围（已确认）**：Milestone 2.5 同时覆盖“代码检索（rg/LSP/文件树）”与“资料工作台（PDF/Docx/Archive 派生索引）”。
5) **可信输出策略默认值（通用能力）**：Decision - 产品默认采用 `balanced`，并允许通过 `skills/profile` 切换到 `strict`（高风险）或 `loose`（创意探索）。

> Decision（由我替你定默认）：P3 起产品默认采用 `balanced`。  
> - 高风险任务通过 `skills/profile` 升级为 `strict`（缺证据即阻断结论）。  
> - 创意/探索任务可显式切换为 `loose`（允许推测但必须标注）。  
> 这样既满足“高信任门槛”，又不把 core 锁死在单一领域。
