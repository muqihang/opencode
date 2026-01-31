# OpenCode CLI 沙盒 + 上下文控制改造方案（opencode-zh-build 版）

状态：草案（基于现有代码结构落地）
日期：2026-01-25
范围：/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src

## 决策摘要

- 采用 CLI + 本地 daemon 的架构，但直接复用 OpenCode 现有 server 作为 daemon。
- 产物生成在沙盒内完成；默认落盘到项目状态目录（`.opencode/evidence/` 与 `.opencode/artifacts/`），需要交付时再显式导出到仓库目录（例如 `./evidence/`）。
- 权限与策略复用 `PermissionNext` 规则集，并扩展为“能力集”以驱动沙盒执行。
- 多代理并行是默认能力：主会话与子会话都可进入各自沙盒；子会话输出 micro-pack，主会话合并为 macro-pack（Manifest 去重）。

## Decision Log（关键默认值与理由）

为避免“大家理解一致但实现跑偏”，这里把关键默认值写成可对账的决策清单：

- 默认执行形态：`CLI -> server(daemon) -> SandboxRunner`（避免 UI 侧重复实现上下文/沙盒/证据）
- 默认 workdir：`isolated`（并行安全，**默认实现采用 git worktree**）；必要时可切 `shared`（并行读、串行写 + 锁/队列）
- 默认网络：`deny_all`（plan）；需要外部资源时切 `allowlist`（limited）；`full` 必须显式开启且审计
- 默认产物位置：`.opencode/`（不污染仓库根目录，支持保留周期与清理）；交付/归档用显式 export
- 默认上下文策略：Capsule/Manifest/pointers 优先；“结果指针化”优先于“原文回填”
- 默认缓存边界：按 project/worktree 分域（必要时细化到 user/session）；防止跨租户侧信道与污染
- 默认子代理行为：子代理只拿“子上下文包”，禁止直接读取全量会话；产出 micro-pack，主会话合并
- 默认路由与并行：用户只提问题，系统自动并行启动 3 类 worker（LSP/KB/Graph）；worker 输出只允许“结构化结果 + capsule + 指针”
- 默认模型分层：重模型只用于最终决策与关键代码；worker 优先用工具直出或轻量模型（抽取/压缩/对账），以换取速度与低幻觉

## 2026-01-28 评审增补（定稿前的关键补丁）

本节用于把评审结论“锁死”到设计里，避免实现阶段再出现跑偏。若后续实现与本节冲突，以本节为准（除非显式更新本节并记录原因）。

### A+ 路线：先把“证据链/协议/统一执行”打通，再逐步加硬隔离后端

我们采用 **A+** 的工程路线（更适合单人自用 → 逐步企业化）：

- **P0 优先级**：协议门禁（Zod + contract tests）+ `events.jsonl` 时间线 SSOT + Evidence Pack v1 + BashTool 统一走 SandboxRunner（backend 先 `soft`）。
- **P1/P2**：在接口稳定后再补 **硬隔离后端**（Linux: bwrap/nsjail；macOS: sandbox-exec；Windows: Job Object 等）。
- **强制透明**：任何执行都必须在证据中记录 `sandbox.backend` 与 `sandbox.enforcement = soft|hard`，避免“假安全感”。

这条路线的目标是：先让系统“可交付、可复盘、可演进”，再逐步收紧执行面的 OS 级强制能力。

### `isolated` workdir 的默认实现：git worktree（定案）

为了让隔离模式不仅能“只读检索”，还能真正“改代码/跑门禁/产出可复验变更集”，`isolated` workdir 采用 **git worktree** 作为默认实现：

- 每个 session 分配一个 worktree 目录（建议落在 `.opencode/worktrees/<sessionId>/`，或等价的 state 目录）。
- 沙盒内把该 worktree 作为可写工作区（例如挂到 `/workspace/work`），工具默认在此目录执行。
- 会话结束时变更集以 `git diff`（或 patch）作为 artifact 落盘，并登记到 Evidence Pack（避免“目录拷贝 + 盲合并”的不可控）。
- `shared` workdir 仍可作为按需模式，但必须有写入协调（锁/队列）与审计事件。

备注：git worktree 是“工作区隔离/回滚”的工程措施；Execution Sandbox 是“进程/网络/文件边界”的安全措施。两者都叫 sandbox 但关注点不同，需在事件与文档中明确区分。

### “软/硬隔离”语义（必须写进证据）

为避免跨平台差异导致安全语义漂移，统一定义：

- `enforcement=hard`：后端具备 OS 级强制隔离能力（至少能阻断：越界写入、进程树失控；网络能力按后端声明）。
- `enforcement=soft`：仅做 **治理与审计**（路径边界校验、命令策略评估、超时/kill tree、输出落盘与脱敏、显式 approvals），不承诺 OS 级阻断。

要求：
- 每次 tool 执行必须产出 `events: sandbox.backend_selected` 与 `events: tool.started/tool.completed`，并在 pack.environment 中记录。
- UI/CLI 默认展示 “soft/hard” 状态（默认安全展示，不泄露敏感原文）。

### 关键不变量（Invariants）：写成门禁，避免“越迭代越乱”

这些不变量是 P0 就必须落地并用测试/门禁保护的工程契约：

1) **Artifacts 不断链**：任何落盘 artifact 必须登记到 `manifest.json`（path + sha256 + kind + size）；否则视为 Evidence 写入失败并记录 `events: evidence.write_failed`。
2) **事件必成对**：每次 tool 调用至少有 `tool.started` 与 `tool.completed`（失败也要 completed，状态=error/degraded），否则 UI/审计无法可靠复盘。
3) **协议强校验**：routing/context-pack/worker-result/events/pack/manifest 等协议文件写入前 `schema.parse()`；读取后同样 parse。失败必须写 `events: protocol.violation` 并生成失败 artifact（错误摘要 + 指针）。
4) **边界可解释**：每次执行必须在证据中记录：`workdirMode`、可写路径集合、网络模式、命令策略评估结果（至少路径/命令/网络三维）。

### 路径与 symlink 安全（导出/打包阶段的真实漏洞点）

必须显式治理 “symlink/路径逃逸”：

- 所有路径判断必须先 `realpath/resolve` 再做 `containsPath`（防 `..` 与符号链接绕过）。
- Evidence/Artifacts writer 与 export 阶段默认 **不跟随 symlink**（使用 `lstat`）；遇到链接必须拒绝或要求显式 allow（并写入审计事件）。
- `manifest.json` 中记录的 path 必须是项目内相对路径；任何绝对路径、驱动器前缀、`..` 都视为协议违规。

### 网络 allowlist 的工程语义（避免“写了 allowlist 但实际绕过”）

域名 allowlist 是策略表达，但是否能被强制执行取决于沙盒后端与网络实现方式：

- 在 `enforcement=soft` 阶段：allowlist 主要用于 **审批/审计/提示**，不承诺 OS 级阻断；必须把该风险写入 `risks`（默认项）。
- 在 `enforcement=hard` 阶段：若要做到“域名级强制”，通常需要 **受控代理/受控解析**（否则可用直连 IP 绕过）。后端应在 `backendCaps` 中声明真实能力（例如 `network.enforced=true|false`），并写入证据。

### PermissionNext / ExecPolicy / Capability 的统一决策优先级

为避免多重弹窗与规则冲突，统一优先级与交互：

- 决策优先级：`forbidden/deny` > `prompt/ask` > `allow`（最严格优先）。
- 每次 tool run 最多允许一次“最终审批”交互：把触发原因合并展示（命令规则、路径扩张、网络访问等），并将评估结果写入 artifact（例如 `execpolicy.eval.json`）。

## Section 1 — Architecture（基于现有 OpenCode 架构）

OpenCode 已有本地 server（`packages/opencode/src/server`）与 CLI 前端（`packages/opencode/src/cli`），
因此无需新增独立守护进程：直接把 server 视为执行核心。在 server 内新增三层能力：
Sandbox Runner（执行隔离）、Context Builder（上下文预算与压缩）、Evidence Pack Writer（证据产物）。
工具层仍以 `Tool.define` 为统一入口，但 `BashTool` 与高风险工具改为通过 Sandbox Runner 执行，
并把运行产物（stdout/stderr、文件变更、依赖哈希）汇入 Evidence Pack。权限模型复用
`PermissionNext` 的“ask/allow/deny”流程，并在规则集上叠加能力集（文件范围、网络域名、命令白名单、
导出白名单），让策略与沙盒执行一一对应。上下文控制复用现有 `SessionCompaction` 与 `SessionSummary`，
但增加“Capsule + Manifest”层；所有上下文切片都带指纹，保证前缀缓存可复用。项目边界通过
`Instance.containsPath` 与 `Project.worktree` 约束，避免沙盒导出越界。注意现有“sandbox”概念是
worktree 目录集合，并非执行沙盒；本方案新增执行沙盒能力但不破坏原有工作区模型。

## Section 1.1 — 执行边界（哪些在沙盒里，哪些在 daemon 里）

为了同时做到“安全隔离”和“高缓存命中/省 token”，本方案明确分层职责（这是生产级最佳实践）：

- **必须在沙盒内执行（Execution Sandbox）**
  - BashTool / PythonTool 以及未来所有会产生副作用的工具执行（文件写入、网络访问、进程树）。
  - 任何执行产物（stdout/stderr、patch、报告、扫描结果）都先在沙盒/沙盒挂载目录里生成，再写入 `.opencode/artifacts` 与 `.opencode/evidence`。
- **更适合在 daemon 内集中执行（Orchestrator / Context Builder / Cache Store）**
  - 任务拆分与子代理调度：需要跨 session 协调并行与依赖链。
  - 上下文构建与压缩（Capsule/Compaction）：需要跨轮次复用与统一预算控制。
  - 缓存与命中统计：需要跨工具/跨子代理共享，且要隔离到 project/worktree，不能让每个沙盒各自为政导致命中率下降。

这也回答你关心的点：**“产物”与“工具执行”应在沙盒内；而“上下文控制与缓存命中”作为策略与治理能力，集中在 daemon 层更好**（可复用、可观测、可审计）。但即便如此，子代理在执行时仍然“各自进沙盒”，并把产物和证据回写到统一的 Evidence Pack。

## Section 2 — 多代理并行 + 沙盒执行 + 上下文隔离

目标是在单个会话中实现“自动并行”的多代理执行，同时保证每个子代理都在沙盒内运行，并且
上下文可控、可追溯。OpenCode 已有子代理机制（`tool/task`、`agent` 模型），可作为并行
调度的基础：Orchestrator 负责把主任务拆成子任务并分配给子代理；每个子代理在独立的
Sandbox Runner 实例中执行，使用独立的 workdir 与能力集，避免交叉污染。Context Builder
对每个子代理输出“子上下文包”（Capsule + 文件切片 + 必要历史摘要），不允许直接读取
全量会话历史，从机制上限制上下文膨胀。并行执行时，结果通过 Evidence Pack 的 events、
artifacts 与 claims 记录，主代理只接收“结果指针 + 关键摘要”，避免回传大段原始输出。

为支持“自动并行”，需要增加任务分解策略：当任务包含多个独立子目标时，系统自动生成
子任务并并行派发；当任务存在强依赖关系时，保持串行并标注依赖链。子代理的工具调用
（包括 Python 脚本执行）必须进入沙盒，并在 Evidence Pack 中记录其输入、输出与执行环境。
缓存命中由 Context Builder 统一维护：子代理上下文包带指纹哈希，命中时直接复用 Capsule
与文件切片；未命中时重新构建并记录原因。这样既能达到“自动并行 + 高质量执行”，也能
保持上下文控制与审计能力。

### Section 2.1 — 关键澄清：主会话与子会话都能“各自进沙盒”

你强调的点非常关键：`delegate_task` 这类机制本质是“主代理创建子 session”，它的价值是隔离上下文与并行。
但你要的更强：主 session 在沙盒中执行；同时每个子 session（子代理）也要有自己的沙盒能力（工具、Python、
文件写入、网络限制等），并且能够并行。这并不矛盾，反而是生产级编排的典型形态：**UI 看起来是一个会话窗口，
系统内部是多个 session/执行单元并行，且每个执行单元都通过统一的 Sandbox Runner 进入沙盒。**

落地上需要把 Sandbox Runner 变成“按 session 维度可分配”的资源，而不是“全局只有一个 shell”。推荐默认模型：
以 project/worktree 为边界挂载源码为只读，每个 session 分配独立 workdir（写入隔离）；策略与权限从父 session
继承并可收紧；子 session 的证据以 micro-pack 形式生成，最终由主 session 合并为 macro-pack（Manifest 去重）。

### Section 2.2 — Workdir 模式：默认隔离（1），可切换共享（2）

你选择“1/2 两者都支持”的目标很合理：生产级系统通常需要同时覆盖“并行安全”和“协作修改”两种工作模式。
因此本方案定义两种工作区模式，并把它们做成显式策略（Policy Capability），而不是隐式约定：

1) **隔离 workdir（默认）**：每个 session（主会话/子会话）都有独立可写工作区，源码以只读方式挂载。
   - 优点：并行安全、不会互相覆盖、失败/中断可独立回滚；适合自动并行与后台任务。
   - 风险：需要“合并回主工作区”的机制（patch/merge），增加一个收敛步骤。
   - 推荐实现（定案）：**git worktree 作为默认隔离 workdir**（建议目录：`.opencode/worktrees/<sessionId>/`）；目录隔离作为 fallback。

2) **共享 workdir（按需切换）**：多个 session 共享同一个可写工作区（通常是用户当前工作目录）。
   - 优点：适合强协作（例如多代理同时改一个 feature），减少合并步骤。
   - 风险：并发写入会导致竞态与冲突；需要更强的“写入协调”与“冲突检测”。
   - 约束：默认仍建议“并行读、串行写”。当检测到同一文件存在并行写入意图时，Orchestrator 必须排队或加锁。

**切换策略**：
- 默认所有子代理使用隔离 workdir（最大化并行收益与安全性）。
- 只有当主代理明确判断“需要共同修改同一套文件并立即对齐”时，才将某个子代理切到共享 workdir。
- 切换本身应触发一次权限提示/审计事件（因为共享 workdir 等价于扩大写入权限边界）。

**合并与冲突处理（隔离 → 主工作区）**：
- 子会话结束时，Evidence Pack Writer 生成变更集（例如 git diff/patch + 文件列表 + 哈希）。
- Orchestrator 在主 workdir 中以“可回滚、可验证”的方式应用变更：优先 `git apply --3way` 或基于内容哈希的补丁应用；
  冲突时生成明确的 conflict artifact 并要求人工/主代理决策。
- 合并后的结果必须重新跑门禁（tests/lint/format），并将 checks 写入 macro Evidence Pack。

**并行能力与缓存命中如何结合**：
- 隔离 workdir 模式下：并行最大化，缓存以“Context Pack 指纹 + 依赖哈希”作为复用键，主代理只接收摘要与指针。
- 共享 workdir 模式下：并行读/检索可继续，写入受控串行；缓存仍按 session 分域，但可共享只读缓存（文件内容/LSP 索引），
  避免重复扫描成本。

### Section 2.3 — 全自动“路由并行”（A/B/C worker：LSP / KB / Graph）

你已明确选择“全自动”：用户只提问题，系统自动开 A/B/C 三个 worker 并行跑（同会话并行 + 工具并行）。
这也是最接近“总参谋长”的体验：先把证据并行拿齐，再做决策与执行。

**核心思想**：把子代理的默认职责从“写结论/写代码”收敛为“取证据 + 结构化对账”，主代理只消费 capsule + 指针。
这样可以同时做到：更快、更省 token、更低幻觉、更高缓存命中率。

默认并行的三类 worker（可降级）：

- **Worker A（LSP/Repo）**：精准定位“相关代码点”
  - 输入：用户意图 + 最小 Capsule + 当前 repo 指纹
  - 动作：LSP symbols/refs、ripgrep、文件树扫描（只读）
  - 输出（artifact + capsule）：相关文件列表、候选符号/位置、最短可复验路径
- **Worker B（KB/RAG）**：召回“历史决策/PRD/经验”
  - 输入：用户意图 + 项目/业务域标识
  - 动作：PGroonga（lexical）、Qdrant（semantic）、RRF fusion（按你的 Jarvis KB Fusion P1 方案）
  - 输出：top chunks + citations（必须可追溯到 chunkId/path/hash）
- **Worker C（Graph/Impact）**：计算“影响面/依赖链”
  - 输入：候选文件/符号（来自 A）+ 目标变更意图
  - 动作：Neo4j（代码/文档图谱）、或 GraphRAG Light（邻居扩散）输出影响面
  - 输出：影响文件/模块列表、依赖路径解释（指针化）

**降级规则（生产级必须有）**：
- 若某个数据源未配置/不可用（例如 Neo4j 未启动），worker 立即降级为空结果并写入 Evidence Pack：
  - `events`: worker.unavailable
  - `risks`: "Graph unavailable; impact analysis degraded"
  - 同时不阻塞其它 worker 与主任务执行。

**worker 输出约束（避免“轻量模型把幻觉放大”）**：
- worker 的输出必须是“结构化结果 + capsule + pointers”，禁止长篇叙事。
- 默认能力集为“只读”：禁止写文件/禁网（除非 KB/Graph 需要访问本地服务，且在 allowlist 内）。
- worker 产物必须落盘为 artifact（例如 `.opencode/artifacts/<sessionId>/routing/<routingRunId>/worker-a.result.json`），主代理只拿路径/哈希 + 简短 capsule。

**模型分层（你关心的“速度化/轻量化”落地决策）**：
- Worker 优先“工具直出”（不走 LLM）；需要抽取/压缩时才调用轻量模型（Tier-1）。
- 主代理使用更高质量模型（Tier-2），只在“证据齐备”后做最终决策、计划与执行。
- 这使得：并行速度由工具与轻量摘要保证；质量由主代理在证据约束下保证。

#### Section 2.3.1 — A/B/C worker 接口契约（输入/输出都“产物化”）

为了让“全自动并行”长期可维护、可缓存、可审计，必须把路由并行做成**稳定契约**，而不是零散的字符串拼接。
这里定义最小 v1 契约：每次路由并行会生成 1 个 request artifact + 3 个 worker result artifact + 1 个聚合 capsule。

**Artifacts 命名规范（必须稳定，可作为指针与缓存命中依据）**：

- 路由运行目录：`.opencode/artifacts/<sessionId>/routing/<routingRunId>/`
- 必须生成：
  - `request.json`（本次路由输入的 canonical 版本）
  - `worker-a.result.json`（Repo/LSP）
  - `worker-b.result.json`（KB/RAG）
  - `worker-c.result.json`（Graph/Impact）
  - `routing.capsule.md`（聚合 capsule，供主代理消费）
- 可选生成（仅当需要时）：
  - `worker-a.snippets.json`（用于主代理注入的少量 snippet 指针清单）
  - `worker-b.citations.json`（长 citations 列表，主代理只取 topK）
  - `worker-c.paths.json`（影响路径详情，主代理只取摘要）

**RoutingRunRequest（request.json）字段（v1）**：

```json
{
  "specVersion": "routing-run-request/1.0",
  "routingRunId": "<ulid>",
  "sessionId": "<sessionId>",
  "messageId": "<messageId>",
  "tier": "plan|limited|full",
  "intent": {
    "text": "<user_text>",
    "normalized": "<normalized_text>",
    "fingerprint": "<sha256>"
  },
  "project": {
    "projectId": "<Instance.project.id>",
    "worktreeRoot": "<Instance.worktree>"
  },
  "repo": {
    "vcs": "git|none",
    "head": "<commit_or_empty>",
    "dirty": true,
    "diffFingerprint": "<sha256_or_empty>"
  },
  "budgets": {
    "maxWallClockMs": 15000,
    "workerTimeoutMs": 8000,
    "topK": 20
  },
  "workers": {
    "worker_a_repo": { "enabled": true, "topK": 20 },
    "worker_b_kb": { "enabled": true, "topK": 20 },
    "worker_c_graph": { "enabled": true, "topK": 20 }
  },
  "versions": {
    "routingTemplate": "v1",
    "capsuleSchema": "v1",
    "workerSchemas": "v1"
  }
}
```

规范约束：
- `intent.normalized` 必须是确定性规范化（trim、统一换行、折叠连续空白、去除不可见控制字符）；并且只对“格式”做处理，不要改写语义。
- `repo.diffFingerprint` 仅在 `dirty=true` 时计算；建议基于 `git diff --patch` 的内容做 sha256（确保“变更不同 → key 不同”）。

#### Section 2.3.2 — WorkerResult（worker-*.result.json）统一 schema（v1）

三类 worker 的外壳 schema 必须一致，方便合并与缓存；差异只体现在 `result` 字段。

```json
{
  "specVersion": "routing-worker-result/1.0",
  "routingRunId": "<ulid>",
  "sessionId": "<sessionId>",
  "workerId": "worker_a_repo|worker_b_kb|worker_c_graph",
  "status": "ok|degraded|unavailable|error",
  "cache": {
    "hit": true,
    "key": "<sha256>",
    "scope": "project|worktree|session",
    "reason": "exact_match|repo_changed|index_changed|ttl_expired|disabled"
  },
  "timing": {
    "startedAtUtc": "<iso8601>",
    "endedAtUtc": "<iso8601>",
    "durationMs": 1234
  },
  "inputs": {
    "intentFingerprint": "<sha256>",
    "repoFingerprint": "<sha256>",
    "configFingerprint": "<sha256>"
  },
  "result": {},
  "capsule": {
    "handoff": "<= N tokens, bullets preferred>",
    "pointers": [
      { "kind": "artifact|file|kb_chunk|neo4j_query", "ref": "<path_or_id>", "sha256": "<optional>", "label": "<optional>" }
    ],
    "openQuestions": []
  },
  "errors": []
}
```

强约束（直接决定“低幻觉/高命中”）：
- `capsule.handoff` 必须短（建议 150-400 tokens），只写“事实 + 指针”，禁止长推理、禁止承诺式结论。
- `result` 允许很长，但必须落盘为 artifact；主代理默认只消费 capsule + topK pointers。

#### Section 2.3.3 — 各 worker 的 result 字段（v1）

**Worker A（worker_a_repo，Repo/LSP）**：

```json
{
  "kind": "repo-lsp",
  "files": [
    {
      "path": "packages/opencode/src/tool/task.ts",
      "reason": "subagent orchestration entrypoint",
      "score": 0.93,
      "symbols": [
        { "name": "TaskTool", "kind": "function|class|const", "location": { "line": 1, "col": 1 } }
      ]
    }
  ],
  "snippets": [
    { "path": ".opencode/artifacts/<sessionId>/routing/<runId>/snippets/task.ts#L1", "sha256": "<sha256>", "why": "shows session creation + permission defaults" }
  ]
}
```

**Worker B（worker_b_kb，KB/RAG）**（对接 Chelingxi-OS 的 `kb_search/kb_discovery` 时也用同一结构）：

```json
{
  "kind": "kb-rag",
  "hits": [
    {
      "id": "chunk:<id>",
      "source": "pgroonga|qdrant|rrf",
      "score": 0.81,
      "citation": {
        "vaultPath": "project::relative_path",
        "relativePath": "docs/xxx.md",
        "startLine": 1,
        "endLine": 40,
        "contentHash": "<sha256_or_content_hash>"
      }
    }
  ],
  "queries": [
    { "engine": "pgroonga", "q": "<normalized>", "topK": 20 },
    { "engine": "qdrant", "q": "<normalized>", "topK": 20 }
  ]
}
```

**Worker C（worker_c_graph，Graph/Impact）**：

```json
{
  "kind": "graph-impact",
  "seeds": ["project::packages/opencode/src/tool/task.ts"],
  "nodes": [
    { "id": "project::packages/opencode/src/session/prompt.ts", "score": 0.76, "why": "task tool uses SessionPrompt" }
  ],
  "edges": [
    { "from": "project::A", "to": "project::B", "type": "IMPORTS|REFERENCES|CALLS" }
  ],
  "queries": [
    { "engine": "neo4j", "cypherId": "impact_v1", "params": { "seed": "..." } }
  ]
}
```

#### Section 2.3.4 — 缓存 key 规则（命中率的工程底座）

缓存命中要稳定，关键是：**key 的构造必须确定性、可解释、可审计**。

**统一 cacheKey 计算方式（推荐）**：

```text
cacheKey = sha256(stableJson({
  specVersion: "routing-cache-key/1.0",
  workerId,
  scope: { projectId, worktreeRoot },
  repoFingerprint,
  intentFingerprint,
  configFingerprint
}))
```

各 fingerprint 的建议：
- `intentFingerprint`：`sha256(intent.normalized + "\n" + versions.routingTemplate)`
- `repoFingerprint`：
  - git clean：`sha256("git:" + head)`
  - git dirty：`sha256("git:" + head + "+dirty:" + diffFingerprint)`
- `configFingerprint`：只包含“会影响结果集合”的字段（topK、阈值、所用索引版本、脚本版本），避免把无关信息塞进 key 破坏命中。

**worker 级失效规则（最重要，必须写进实现）**：
- Worker A：repoFingerprint 变化 → 必须失效；LSP index version 变化 → 建议失效。
- Worker B：KB snapshot/version 变化（如 `revision_ref`/ingestion cursor）→ 必须失效。
- Worker C：Graph snapshot/version 变化（Neo4j cursor/last_updated_at）→ 必须失效；seeds 变化 → 必须失效。

**缓存边界（安全与多租户）**：
- 默认 scope = `project/worktree`（单人本地即可高命中）；企业多租户必须至少加 `tenantId/workspaceId`。
- 任何跨租户共享缓存都必须视为高风险（侧信道/数据泄露），默认禁用。

#### Section 2.3.5 — stableJson / canonicalization 规则（协议级“确定性”）

路由并行的高命中与可审计，最终取决于“同样输入 → 同样序列化 → 同样 hash”。因此需要一套**协议级的确定性序列化规则**，
所有实现（Node/Bun/未来其它语言）都必须遵守。

**stableJson(v1) 基本规则**：

1) **编码**：UTF-8。
2) **对象 key 顺序**：按 Unicode code point 升序（等价于大多数语言的字典序排序），递归应用。
3) **数组顺序**：
   - 若数组表达“有序语义”（例如 `events[]`、`queries[]` 的时间序列），必须保持原顺序。
   - 若数组表达“集合语义”（例如 `files[]`、`hits[]`、`nodes[]`），必须按稳定排序规则排序后再序列化。
4) **数值**：不允许 `NaN/Infinity`；整数按十进制；浮点保留到必要精度（建议最多 6 位小数）并禁止科学计数法（避免跨运行时差异）。
5) **字符串**：标准 JSON 转义；禁止包含不可见控制字符（若出现，必须在 normalize 阶段移除或替换为可见占位）。
6) **输出格式**：用于 hashing 的 stableJson 必须是 minified（无多余空白）；用于人类阅读的 view（例如 pack.md）另行生成。

**集合型数组的默认排序规则（v1）**（建议直接写成代码常量，避免“实现各自为政”）：

- `WorkerA.result.files[]`：按 `score desc`，再按 `path asc`
- `WorkerA.result.snippets[]`：按 `why asc`，再按 `path asc`
- `WorkerB.result.hits[]`：按 `score desc`，再按 `id asc`
- `WorkerC.result.nodes[]`：按 `score desc`，再按 `id asc`
- `WorkerC.result.edges[]`：按 `(from asc, type asc, to asc)`

补充：stableJson 的“版本号”必须显式进入 `cacheKey` 计算（见 request.json 的 `versions` 字段），任何排序/字段变更都必须 bump 版本，避免旧缓存误命中。

实现建议（减少踩坑）：
- 若希望更严格的跨语言一致性，可直接采用 RFC 8785（JSON Canonicalization Scheme, JCS）的实现作为 stableJson。
- 若短期只用 Node/Bun，实现更简单的做法是：尽量避免在 cacheKey 相关对象里使用浮点数；例如把 `score` 改为整数（`score_bps`）或字符串（固定小数位），避免不同运行时对浮点格式化产生差异。

#### Section 2.3.6 — 默认值（topK/超时）与降级策略表（v1）

为了让单人自用“开箱即用”，并且在资源紧张/依赖缺失时仍然可用，路由并行需要明确默认值与降级策略。
下面给出推荐 v1 默认值（可由 config 覆盖），并要求“降级必须写 Evidence Pack”：

| 项目 | 默认值 | 失败/超时后的状态 | 降级策略（不阻塞主流程） | 证据要求 |
| --- | --- | --- | --- | --- |
| routingRun.maxWallClockMs | 15000ms | - | 超过总预算：停止最慢的 worker，聚合已有结果 | events: routing_timeout |
| workerTimeoutMs | 8000ms | `degraded` | 超时返回空 result + capsule（说明未完成） | artifacts: worker-*.result.json |
| topK (A/B/C) | 20 | `ok/degraded` | 资源不足时降为 10 | request.json 记录最终 topK |
| Worker A（LSP） | enabled | `degraded/unavailable` | LSP 未就绪→仅 ripgrep + 文件树扫描 | events: worker.unavailable; risks |
| Worker B（KB） | enabled | `degraded/unavailable` | Qdrant 不可用→仅 PGroonga；PG 不可用→仅 Qdrant（若可） | citations 必须可追溯 |
| Worker C（Graph） | enabled | `degraded/unavailable` | Neo4j 不可用→使用“本地 imports 近邻”启发式（若有）或返回空 | risks: impact degraded |

说明：
- “不阻塞主流程”指：A/B/C 任意一个失败，都不能让用户卡死；主代理用已有证据继续，并在 Capsule/OpenQuestions 里提示缺口。
- 降级不是“静默跳过”：必须写 Evidence Pack `events/risks`，否则你无法复盘为什么这次答案质量下降。

#### Section 2.3.7 — 协议落地一致性：routing/context-pack 必须进入 Evidence Pack（不可断链）

为了避免出现“系统内部做了很多并行与压缩，但交付/复盘时看不到证据”的断链问题，本方案规定：

- `request.json`、`worker-*.result.json`、`routing.capsule.md`、`context-pack.json` **都必须登记为 Evidence Pack artifacts**，
  并且出现在 `.opencode/evidence/<sessionId>/manifest.json` 中（含 sha256）。
- 主代理对外输出的关键结论（claims）必须引用：
  - 路由证据（routing artifacts）以及
  - 执行证据（tool stdout/stderr/patch/check logs）
  不能只引用“文本描述”。

建议的 artifact `kind`（便于检索与去重）：
- `routing-run-request`：request.json
- `routing-worker-result`：worker-a/b/c.result.json
- `routing-capsule`：routing.capsule.md
- `context-pack`：context-pack.json（见 Section 16.2.1）

建议的落盘路径（稳定，可做指针）：
- `.opencode/artifacts/<sessionId>/routing/<routingRunId>/request.json`
- `.opencode/artifacts/<sessionId>/routing/<routingRunId>/worker-*.result.json`
- `.opencode/artifacts/<sessionId>/routing/<routingRunId>/routing.capsule.md`
- `.opencode/artifacts/<sessionId>/context/<contextPackId>/context-pack.json`

#### Section 2.3.7.1 — 协议代码化（Zod/TypeScript）+ 契约测试（防漂移，避免越迭代越乱）

为了让 routing/context-pack 不只是“文档里的示例”，而是可执行的工程门禁，我们需要把协议落成：

- **Zod schema + TypeScript 类型（SSOT）**：写 artifact 前必须 `schema.parse()`，保证产物永远符合协议；
- **contract tests（契约测试）**：用 fixture 锁住字段与 strict 行为（unknown key 必须报错），避免未来插件/核心漂移。

落地门禁（必须，不可选）：
- **统一写入入口**：所有 routing/context-pack/worker-result artifacts 必须通过统一的 writer 写入（例如 `ProtocolArtifactWriter`），写入前强制 parse；
- **统一读取入口**：任何消费这些 artifacts 的地方也必须通过统一的 reader 读取（读后 parse），禁止“随手 JSON.parse 然后继续跑”；
- **失败语义必须可审计**：parse 失败时不允许静默吞掉或回退到不受控路径，必须：
  - 写 `events: protocol.violation`（safe 摘要）；
  - 落一个 “error artifact”（包含错误摘要、触发位置、输入指针），保证 Evidence Pack 不断链。

实现状态（已落地，作为后续实现的唯一真相来源）：
- `packages/opencode/src/protocol/routing-run-request.ts`（`routing-run-request/1.0`）
- `packages/opencode/src/protocol/routing-worker-result.ts`（`routing-worker-result/1.0`）
- `packages/opencode/src/protocol/context-pack.ts`（`context-pack/1.0`）
- `packages/opencode/src/protocol/shared.ts`（sha256/ulid/时间等基础类型）
- `packages/opencode/test/protocol/protocol-contract.test.ts`（contract tests）

版本化规则（必须遵守，保证缓存与解析器不被“悄悄破坏”）：
- **字段语义/排序规则/严格性变化 = bump `specVersion`**（例如 `.../1.1` 或 `.../2.0`），并同步更新测试 fixture；
- 新增字段若要兼容老版本，必须明确“默认值/缺省语义”，并在解析层做显式兼容（禁止 silent accept）。

#### Section 2.3.7.2 — Schema 到底是什么？以及“行业/场景工作流扩展”时是否需要新增 Zod schema

你可以把 **schema 理解为“机器可验证的合同/协议”**：它精确定义了一段数据（通常是 JSON）应该长什么样、
有哪些字段、每个字段的类型/约束、以及跨字段的不变量（例如 A=true 则必须提供 B）。

它解决的是“规模化与商用必然会遇到”的问题：
- 多人/多模块/多插件协作时，**双方对字段含义的理解会漂移**；
- 没有 schema 的系统，最终会退化为“到处是字符串 + 猜测解析”，缓存难命中、UI/审计难做、错误难定位；
- 生产级/企业级必须做到：**失败可解释、数据可回放、行为可审计**，schema 是工程骨架之一。

因此问题的结论是：**不是“做商用就要给所有行业都新增一堆 schema”**，而是把 schema 分层：

1) **平台级 schema（必须稳定，越少越好，但必须强约束）**
   - 适用范围：跨模块通信、缓存 key、Evidence Pack、时间线事件、上下文包等“底座协议”。
   - 例子：`routing-run-request`、`routing-worker-result`、`context-pack`、未来的 `event/1.0`、`tool-run-receipt/1.0`。
   - 原则：平台级 schema 变化必须版本化（bump `specVersion`），并用 contract tests 锁死。

2) **插件/行业/工作流 schema（按需增加，越贴近“工具/产物”越值得 schema 化）**
   - 适用范围：当你新增一个行业（法律/教育/财务/客服…）的工作流时，如果它只是“提示词模板 + 人类阅读输出”，不一定要新增 schema。
   - 但只要出现以下任一需求，就强烈建议新增 schema（否则很快会乱）：
     - 需要把产物作为 Evidence Pack artifact 被复用/缓存（可哈希、可 diff）
     - 需要 UI 展示结构化结果（例如表格、引用、条款、风险项）
     - 需要与其它 worker/tool 做“结构化对账”（降低幻觉）
     - 需要把结果喂回下游流程（例如自动生成合同条款、自动生成题库）
   - 例子（命名示意）：
     - 法律：`legal.case_intake/1.0`、`legal.citation_extract/1.0`、`legal.memo/1.0`
     - 教育：`edu.lesson_plan/1.0`、`edu.quiz_items/1.0`、`edu.rubric/1.0`

工程化建议（避免“每个行业都在 core 里堆 schema”）：
- 采用 **schema registry** 模式：插件注册自己的 `artifactKind -> zodSchema` 映射；core 的 writer/reader 统一调用 registry 做 parse。
- 保持“外壳统一，业务内核可扩展”：平台统一的 artifact envelope（id/ts/sessionId/sha256/pointers）不变，
  行业数据放在 `payload`（由插件 schema 严格约束）。

这样做的价值：
- **可复盘**：你能回答“这次为什么选这些文件/为什么查到这些证据/为什么认为影响面是这些”。
- **可缓存**：routing 结果与 context-pack 都是可哈希的资产，命中可观测。
- **可合规**：企业场景下必须证明“模型在什么输入下得出什么结论”，否则无法审计。

#### Section 2.3.8 — Worker 资源调度（并发上限 / 取消 / 收敛）与“不会把机器打挂”

全自动并行如果没有资源治理，会出现两个坏结果：机器被打满（卡顿）+ 并行越多越慢（争抢 IO/CPU）。
因此必须把 worker 调度做成明确策略（默认值可配）：

**并发上限（单人默认）**：
- 同时活跃的 routingRun：`maxRoutingRunsInFlight = 1`（用户每次提问只跑一个；新提问会取消旧的）
- 每个 routingRun 的 worker 并发：`maxWorkersInFlight = 3`（A/B/C 各一个）
- 全局工具/检索并发（跨会话）：`maxBackgroundWorkers = 4`（防止后台任务挤占交互）

**取消策略（用户体验关键）**：
- 若用户在 routingRun 进行中继续输入新问题：立即取消旧 routingRun（写 `events: routing_cancelled`）。
- 若 routingRun 达到 `maxWallClockMs`：取消最慢的 worker，立刻聚合已有结果（写 `events: routing_timeout`）。

**收敛策略（避免“长尾拖死”）**：
- routingRun 结束条件：`min(A,B,C) completed OR maxWallClockMs reached`。
- 若 Worker A（Repo/LSP）完成且能给出足够 seeds（>= 1 个高置信文件/符号），允许提前触发主代理“下一步计划/执行”；
  Worker B/C 的结果以“后到补齐”方式更新 Capsule（写 `events: routing_late_result`），不阻塞执行闭环。

**故障隔离**：
- worker 失败只影响它自己的结果（status=error/degraded），不允许把失败升级为“整次会话失败”。
- 失败必须产出 result.json（含 errors），以保证 Evidence Pack 不断链。

## Section 3 — 上下文控制与缓存命中（结合现有 compaction/summary）

OpenCode 已有 `SessionSummary` 与 `SessionCompaction`，可作为上下文收敛的基础，但需要
补上“Capsule + Manifest + 指纹”三个层。改造思路：在会话级别生成 Capsule（关键事实、
决策与指针），并在 Context Builder 里为每次模型调用构建 Context Pack。Context Pack
由 Capsule、必要历史摘要、以及相关文件切片组成，并附带 hash 指纹（文件路径 + 内容哈希 +
会话摘要版本 + 规则版本）。指纹用于前缀缓存与子代理复用：命中时直接复用上下文包并
记录命中原因；未命中则触发 compaction 与摘要刷新。为了避免“摘要漂移”，Compaction
的输出必须带版本号与来源指针（manifest entry），并写入 Evidence Pack。

缓存采用 scoped LRU/TTL（参照 `specs/02-cache-eviction.md` 与 `specs/05-modularize-and-dedupe.md`），
按项目目录隔离，包含：文件内容缓存、检索结果缓存、上下文包缓存。每个缓存条目都存储
依赖哈希与有效期，确保“同一任务/同一输入”能复用，同时避免过期或跨任务污染。命中策略
优先保留：Capsule、Manifest 指针、最近一次完成的子任务摘要；低价值的原始输出在预算
不足时被丢弃，只保留指针与哈希。子代理只能访问其上下文包，不可直接读取全量会话历史；
主代理通过 manifest 合并子代理结果，形成新的 Capsule。

### Section 3.1 — Cache Store：本地优先 + 可插拔后端（是否需要 Redis？）

你问“会不会用到 Redis 缓存服务器”——答案是：**单人本地阶段不需要把 Redis 作为硬依赖，但要把 Cache Store 设计成可插拔**，
这样未来商用/云端多进程时可以无痛换成 Redis。

推荐默认（单人/本地）：
- **L0（进程内）**：内存 LRU（最快，保存热点：Context Pack、routing results、文件哈希、token 估算）
- **L1（本地磁盘）**：持久缓存（保存可复用：routing artifacts、context-pack、派生资料 chunks、KB 查询结果摘要）
  - 实现可选：SQLite/LMDB/简单文件树 + manifest（都可以；优先选你团队维护成本最低的）

什么时候才建议引入 Redis（商用/团队/云端）：
- 多进程共享缓存（多个 worker/多个 runtime/水平扩展）
- 需要集中限流/队列（rate limit、后台任务队列）
- 需要跨机器共享（云端执行面分布式）

注意：Redis 带来的不仅是性能，也有运维复杂度与安全面（多租户隔离、持久化策略、泄露风险）。因此本设计建议：
- **P0-P2：不引入 Redis**（把接口做出来即可）
- **P3-P4：提供 cache backend 选项**（`memory|disk|redis`），并在 Evidence Pack 记录 backend 与命中统计

### Section 3.2 — Provider Prompt Caching：各家厂商不同，但我们用“确定性模板 + 本地指纹”兜底

你提到“不同 LLM 厂商缓存命中的风格/格式不同，要不要匹配？”——是的，但建议分层处理：

**(1) 我们可控的：本地缓存与指纹（必须做成 SSOT）**
- routing/cacheKey、context-pack fingerprint、inputId（sha256）都由我们生成并审计。
- 这决定了“系统层的复用与省 token”，不依赖任何厂商能力。

**(2) 厂商加速器：prompt/prefix caching（可用但不依赖）**
- 不同 provider 对 prompt caching 的命中条件不同（例如“前缀必须完全一致”是常见要求）。
- 工程策略：
  - 在 Context Builder 中保证 **确定性模板/序列化**（见 Section 2.3.5、Section 16）
  - 把动态字段（时间戳、随机 id、traceId）尽量放到 prompt 尾部或放到 Evidence Pack/events，而不是放到系统前缀里
  - 为 provider adapter 预留 `cacheHints`：例如 `prompt_cache_key`、或等价字段（不同厂商不同，按 adapter 适配）

**(3) 统一指标口径（不被厂商差异“骗”）**
- 无论 provider 是否暴露 cached_tokens，我们都要记录：
  - 本地 cache hit（routing/context-pack）
  - provider cache hit（若可用，作为加速器指标）
- 最终你关心的体验指标是：延迟下降、token 消耗下降、幻觉下降；不要只盯某个厂商字段。

## Section 4 — Evidence Pack 灵感映射（来自 Ideal-Evidence-Pack-Spec）

本方案的 Evidence Pack 结构直接对齐 Ideal Evidence Pack 的 L0-L4 分层：L0 Capsule 由
Context Builder 生成并随会话更新；L1 Manifest 由 Evidence Pack Writer 输出，记录所有
artifact 路径与哈希；L2 Claims 在任务完成时由 Orchestrator 汇总子代理结果生成；L3
Artifacts 包含日志、diff、扫描结果与命令输出；L4 Provenance 记录沙盒类型、模型、权限
审批与工具调用。关键原则采用“指针优先、断言化、可合并、可验证、最小泄露”。这意味着
所有总结都必须指向可验证产物，不允许“描述式结论”；子代理以 micro-pack 形式输出证据，
主代理做去重合并；敏感信息需脱敏后再导出。该结构同时服务上下文压缩与沙盒治理：Capsule
既是上下文输入的“最小事实”，也是 Evidence Pack 的可交接载体；而 Provenance 记录执行
边界，避免沙盒执行成为“黑盒”。

## Section 5 — 对齐 Codex / GPT 系的优势实践（可验证的工程原则）

无法验证内部实现细节，但业界高命中、低成本系统普遍采用以下原则：稳定前缀（固定系统指令
与模板顺序）、分层上下文（固定规则 + 任务上下文 + 指针化证据）、最小输入（只注入必要片段）、
哈希指纹缓存（内容不变则复用上下文包）、以及“结果指针化”（工具输出走路径/哈希而非原文）。
本方案通过 Capsule/Manifest、指纹哈希与 scoped LRU/TTL 复用这些优势；并把上下文构建与
缓存放在 daemon 层，避免重复构建与高频重复 token。与多代理并行结合时，只把子代理结果的
摘要与证据指针回传给主代理，减少上下文膨胀与缓存失效。该原则可直接提升“缓存命中、上下文
质量、与审计能力”，并适配未来模型迭代。

在“前缀缓存 / Prompt Caching”成为主流后，还需要把工程原则落地为可执行约束：缓存命中往往
依赖“前缀完全一致”，包括空格、换行与序列化格式；因此 Context Builder 必须采用确定性序列化
（稳定的字段顺序与模板渲染），并把动态内容（时间戳、request id、随机标记）尽量放到提示词尾部。
同时需要缓存淘汰策略（LRU/TTL/容量上限），否则长会话与多并发会导致 KV/上下文缓存膨胀。

### Section 5.1 — 尽最大可能对齐 GPT-5.2 / Codex 体验：6 个“可验证吸收点”（不猜内部实现，只吸收机制）

你强调的体验目标是：**超长上下文 + 低成本 + 尽最大努力降低幻觉**。下面这 6 点是我们能“务实对齐”的工程机制，
并且每一点都能通过 Evidence Pack/产物/指标来验收（不是停留在口号）。

1) **调用级上下文重建（call-scoped context pack）**
   - 机制：每次模型调用都生成独立的 `context-pack.json`，由 Context Builder 在调用前“按预算重建上下文”，而不是把对话历史全量回填。
   - 验收：Evidence Pack 中能看到每次调用对应的 `context-pack.json`；UI 计数器百分比来自 `window.maxTokens/budgetTokens + segments.tokenEstimate`（见 Section 16.2）。

2) **工具/资料产物化（Artifacts-first Workbench）**
   - 机制：PDF/ZIP/大文本/图片等大对象进入“资料工作台”，在沙盒内处理生成派生 artifacts（文本提取、页级索引、摘要、结构化表格），prompt 只放“摘要 + 指针”。
   - 验收：Evidence Pack 的 manifest 中能追溯原始输入与派生输出（sha256）；主代理输出引用 pointers 而不是粘贴原文（见 Section 13.2 / Section 2.3.7）。

3) **Router-first（先并行拿证据，再生成/执行）**
   - 机制：默认先跑 A/B/C worker（Repo/LSP、KB、Graph）拿证据与影响面，主代理只消费 capsule+pointers 后做计划与执行，避免“先拍脑袋再补证据”。
   - 验收：每次路由都有 `request.json + worker-*.result.json + routing.capsule.md`；worker 缺失会产生 `degraded/unavailable` 与风险事件（见 Section 2.3）。

4) **小模型/工具当 worker（结构化、短输出、可校验）**
   - 机制：worker 优先使用工具直出（LSP/rg/DB/Graph），需要 LLM 时选轻量模型做抽取/对账/压缩；强制结构化 schema 输出，禁止长篇叙事（减少幻觉扩散）。
  - 验收：worker result 都可通过 Zod schema 校验；出现 schema 不匹配必须写入 protocol.violation 事件并降级（见 Section 2.3.7.1 / Section 16.1）。

5) **缓存分层：本地缓存为 SSOT；provider 缓存作为加速器**
   - 机制：本地 cacheKey/context-pack fingerprint 由 stableJson + sha256 生成并审计；不同 provider 的 prompt caching 只作为“额外加速”，不作为正确性依赖。
   - 验收：Evidence Pack/events 中能看到本地 cache hit/miss 原因；若 provider 暴露 cached_tokens 则记录为辅助指标（见 Section 3.2）。

6) **可解释时间线（不是黑盒，但默认安全）**
   - 机制：CLI/UI 展示“阶段/预算/证据/缓存命中”的时间线；细节展示分级（safe/verbose/audited），默认不泄露敏感内容。
   - 验收：时间线来自同一套 events/trace spans；每个阶段都能点回 Evidence Pack artifacts；并记录脱敏策略版本（见 Section 16.2.2 / Section 8）。

### Section 5.2 — 从 OpenAI Codex 开源实现/官方文档汲取的“可验证机制”（补强本设计的工程落点）

你这次明确要求“既然开源了，就尽量把好的机制吸收进来”。这里把从 `openai/codex` 仓库与官方文档中能直接验证、且与我们目标高度一致的机制补齐到设计里（不靠猜测）。

**(1) Sandbox/Approvals 两层模型（能力 vs 何时询问），并提供“read-only”一键切换**
- Codex 的安全模型把“能不能做”（sandbox mode）与“什么时候必须停下来问你”（approval policy）拆开，这比把一切塞进同一个 permission 更清晰，也更利于企业治理（requirements/managed config）。
- 对我们设计的落点：
  - `SandboxCapability` 继续表达“可执行边界”；`ApprovalPolicy` 单独作为“交互门禁策略”。
  - 提供 `/approvals` 或等价 UI 入口把会话切到 `read-only`（只读聊天/规划），让用户可控地“随时收紧”。

**(2) 明确承认：只有内置 shell/exec 工具能被 OS 沙盒强约束；MCP 工具必须自证/自限**
- Codex 在工程上明确区分：CLI 自带的 `shell` 工具在 OS 沙盒内执行；而 MCP 工具不由 Codex 统一沙盒化，必须由 MCP server 自己做 guardrails。
- 对我们设计的落点：
  - 把“哪些工具是 sandboxed / 哪些是 external”写进 `context-pack.json` 与 `events.jsonl`（provenance），避免安全边界成为隐性假设。
  - 对外部工具（MCP/HTTP）引入 `toolIdentity` 与 allowlist：不在 allowlist 的 MCP 工具默认禁用或降级为“只读查询 + 输出脱敏”。

**(3) 配置层叠（workspace/repo/home/system）与“Profile + Feature flags + Maturity”体系**
- Codex 的配置不是单文件，而是“按目录向上查找 + repo root + 用户目录 + 系统目录”的 stack，并且有 profile 与 feature flags（含成熟度标签：Experimental/Beta/Stable）。
- 对我们设计的落点：
  - 把 `.opencode/opencode.json(c)` 的加载策略升级为“可层叠”，并提供 `opencode config show --effective` 以便对账（见 Section 17）。
  - 所有高风险/易变能力（sandbox 后端、unified exec、remote compaction、undo 等）必须有 feature flag，并标注成熟度，避免 PoC 与生产混用。

**(4) 企业级强约束：requirements（不可覆盖）+ managed defaults（可覆盖但下次启动重置）**
- Codex 支持 `requirements.toml` 这类“管理员强制策略”，以及 `managed_config.toml` 这类“企业默认值”；并支持对 MCP server 进行 identity allowlist。
- 对我们设计的落点：
  - 预留 `requirements.*` 与 `managed.*` 配置层（见 Section 17），让未来商用/企业版能“从一开始就可治理”，而不是后补。
  - 默认建议：`network_access=false`、`log_user_prompt=false`、MCP allowlist 空=全部禁用（更安全的企业默认）。

**(5) ExecPolicy（prefix-rule）把“允许/询问/禁止”做成 policy-as-code，并内置 rule 测试向量**
- Codex 的 `execpolicy` 采用 prefix rules（按 token 序列前缀匹配），decision 取 `allow/prompt/forbidden`，并支持 `match/not_match` 作为加载时的“单元测试”（规则本身自带测试用例）。
- 对我们设计的落点：
  - 在 PermissionNext 之上增加“命令级 execpolicy”一层（见 Section 13.1.1），实现更细的“命令白名单/黑名单/解释性拒绝”。
  - 把 policy 文件与它的测试向量一起纳入 Evidence Pack provenance（policyVersion + policyHash）。

**(6) Shell Snapshot / 统一 Exec（PTY-backed）类能力：用“环境快照 + 标准化 IO”换性能与稳定性**
- Codex 的 feature flags 中包含 `shell_snapshot`（加速重复命令）与 `unified_exec`（统一 PTY-backed exec）等概念。
- 对我们设计的落点（不强制 P0 实现，但必须在路线图留钩子）：
  - 把“命令执行环境”显式化：env forwarding policy（include_only/denylist），并将“环境指纹”纳入 cacheKey/configFingerprint。
  - 让 SandboxRunner 的 IO 捕获标准化（stdout/stderr/exit/timedOut），为“可解释时间线 + 可复验产物”打地基。

**(7) Undo（per-turn git ghost snapshots）：把“可回滚”作为默认安全网**
- Codex 把 undo 当成一等能力（每轮 turn 做 git 级快照，必要时可回滚），这在商用/企业落地时极其重要：可以显著降低“自动化误改”的心理门槛。
- 对我们设计的落点：
  - P1/P2 引入 `opencode undo`（可选、默认开启、可配置），并把快照引用写入 Evidence Pack（provenance + events）。
  - 在 shared workdir 模式下更关键：回滚是“并行写入事故”的最后保险。

**(8) 非交互模式（Non-interactive exec）与“输入附件化”（图片/文件）**
- Codex CLI 文档把“非交互 exec”作为一等用例；社区也大量使用 `codex exec --image ...` 这类模式来做“截图→分析→修复”的闭环。
- 对我们设计的落点：
  - 在 CLI 侧提供 `opencode exec`（非交互），并把 stdin/stdout 都产物化（artifact + schema），适配 CI/脚本化工作流。
  - “文件输入/图片输入”直接进入资料工作台（inputs/derived），而不是要求把内容粘到 prompt（见 Section 13.2）。

## Section 6 — 沙盒内外的上下文与缓存边界

执行与产物应在沙盒内完成，但上下文构建与缓存更适合在 daemon 层集中管理。原因：上下文复用、
缓存命中统计与指纹版本管理需要跨任务与跨子代理共享；而沙盒强调隔离与最小权限。建议采用
“双层缓存”：daemon 层缓存上下文包、摘要与证据指针；沙盒内缓存仅用于本次执行的临时数据
（如工具输出、临时文件）。导出阶段通过 allowlist 与哈希校验把产物带回宿主，同时把证据索引
写入 Evidence Pack。子代理只访问其上下文包，禁止直接读取沙盒外数据；主代理只能通过 manifest
合并结果，保证上下文与证据的一致性。

补充：缓存的“隔离边界”必须与权限/租户边界一致。尤其在企业场景，如果出现“跨用户/跨组织共享”
的 prompt/prefix 缓存，可能引入基于响应时间差异的侧信道风险。因此本方案要求所有本地缓存默认
按 project/worktree（必要时再细到 session/user）分域；并将任何外部模型侧的缓存视作不可控依赖，
在风险评估中显式标注（例如对敏感任务禁用或降低复用）。

## Section 7 — 借鉴 oh-my-opencode 的多代理机制（可直接迁移的工程价值）

你提到的 `oh-my-opencode` 确实有很强的“多代理 + 自动并行 + 上下文管控”工程化实现，且它是构建在
OpenCode 的 session/agent/plugin 机制之上，因此存在大量可复用价值。本方案建议重点吸收以下做法：

1) **Planning/Execution 分离**：用“只做规划、不写代码”的 Planner 与“执行+调度”的 Orchestrator
分工，减少上下文污染与目标漂移；规划产物落为可复用的 Markdown 计划文件，再由执行器逐条落实。

2) **delegate_task（可控子代理调用）**：用专用工具封装“创建子 session → 指定 agent/model →
限制 tools → 轮询稳定性 → 汇总结果”的流程。好处是：子代理上下文天然隔离（每个子 session 独立），
并且可以把“技能注入/系统 prompt 拼接/工具白名单”统一收口，避免主会话被大量中间输出污染。

3) **Background Tasks（并行探索）**：把“探索/文档/代码检索”类子任务默认后台运行，并设置并发上限
与并发分组（例如按模型分组）；主代理只接收“完成通知 + 结果指针/摘要”，让并行成为默认能力。

4) **目录级上下文注入（AGENTS.md 向上查找）**：在读取文件或批量读取时，自动注入该目录及父目录的
AGENTS.md 规则（并缓存已注入目录，compaction 后清空）。这对“减少人类重复解释项目规范”非常有效。

5) **工具权限收敛**：对子代理强制关闭递归调度能力（例如禁止子代理再次 `delegate_task`），并按 agent
类型施加细粒度工具白名单，避免无限递归与上下文爆炸。

### Section 7.1 — 与 OpenCode 一起“捆绑升级”的定位与边界

虽然本方案的施工目标是升级 OpenCode core（上下文控制、沙盒、缓存、Evidence Pack、可观测性等），但在实际
研发中可以将 `oh-my-opencode` 作为“同仓协同演进的 first-party 插件”一起升级：它负责快速试验与沉淀编排策略
（多代理调度、后台任务、目录上下文注入、技能系统与用户体验），而 OpenCode core 负责提供稳定、可治理的底座能力
（Sandbox Runner、Context Builder、Evidence Pack Writer、OTel tracing）。两者的关系应当是：

- core 提供稳定接口：子会话/子代理调度 API、沙盒执行 API、证据写入 API、缓存统计 API、权限评估与审批 API。
- 插件负责策略与体验：如何拆分任务、何时并行、何时后台跑、如何选择 agent/model、如何注入目录规则与技能。
- 插件不直接“自建沙盒底座”：而是把执行请求下沉到 core，确保所有执行都能统一进入沙盒、统一生成证据、统一审计。
- 兼容性门禁：为 core ↔ 插件 的契约增加集成测试与版本约束（例如 API 变更必须双向更新，并在 CI 中验证）。

落地建议：在 OpenCode core 内实现与 `delegate_task` 等价的“子代理调度 API”（server 侧），而 UI/插件层
只做触发与展示。这样既能复用 oh-my-opencode 的成熟思路，又能把沙盒/证据/缓存能力沉淀为生产级基础设施。

## Section 8 — 可观测性与审计（OTel Tracing + Evidence Pack 关联）

为了达到生产级与企业级，除了“能跑”，还必须“可观测、可审计、可复盘”。建议将 OpenCode 的会话、子代理、
工具调用与沙盒执行统一纳入 tracing：为每个 session 建立 trace，为每个 tool call 建立 span，并把
model/provider、token 预算、缓存命中、权限请求、沙盒限制等作为 span attributes。这样可以把“上下文控制”
从不可见的黑箱变成可分析的指标体系（例如命中率、平均上下文长度、失败重试原因、权限拒绝分布）。

Evidence Pack 与 tracing 的关系是“证据归档”与“实时观测”互补：Evidence Pack 负责把关键产物（artifacts）、
门禁结果（checks）与断言（claims）固化为可验证交付；tracing 负责把执行路径与性能/失败信号连续记录。
工程上可以把 traceId/spanId 写入 Evidence Pack 的 Provenance/events，使得一次交付既可离线审计，也可
在线定位问题。此外，参考供应链安全的通用模型（SLSA/in-toto），Evidence Pack 的 Manifest+Provenance
天然可以扩展为 “attestation bundle” 的形态：当未来对接企业 CI/CD 时，可以把 Evidence Pack 作为制品的
证明材料归档并做策略验证。

### Section 8.1 — events.jsonl：时间线与审计的 SSOT（建议也做成协议 + 契约测试）

前面我们已经把 routing/context-pack 做成“强约束协议”。为了让 UI/CLI 时间线不靠“猜状态”，并且让审计不丢链，
同样需要把事件流当成一等产物（artifact），并尽量协议化。

建议 v1 采用 JSONL（每行一个 event），落盘例如：
- `.opencode/evidence/<sessionId>/events.jsonl`

最小事件外壳（v1，示意）：

```json
{
  "specVersion": "event/1.0",
  "ts": "2026-01-25T00:00:00.000Z",
  "sessionId": "<sessionId>",
  "traceId": "<traceId>",
  "spanId": "<spanId>",
  "severity": "debug|info|warn|error",
  "actor": "tool:bash|tool:python|worker:worker_a_repo|orchestrator|policy|user",
  "type": "routing.started|routing.worker.completed|context_pack.built|cache.hit|permission.ask|tool.completed",
  "summary": "<human-readable, redacted>",
  "data": { "any": "structured_payload" },
  "redaction": { "applied": true, "policyVersion": "v1" }
}
```

规则（生产级必须明确）：
- `summary` 必须默认脱敏（适合直接展示在 CLI/UI）；敏感细节只能通过指针进入 Evidence Pack artifacts。
- `data` 允许结构化，但必须遵守“最小泄露”：优先记录统计与引用（artifact refs/sha256），不要记录原文内容。
- 事件协议也应引入 **Zod schema + contract tests**（和 routing/context-pack 同等级），否则时间线语义会随迭代漂移。

### Section 8.2 — 对齐 OpenTelemetry GenAI 语义约定（SemConv）：指标口径与“内容外置”

为了更接近“顶级产品的可观测性体验”，建议 tracing/metrics 直接对齐 OpenTelemetry 的 GenAI 语义约定：
这样你未来要接入任何 APM/Collector 都会更顺滑，也避免“我们自己发明一套字段，后续难迁移”。

务实落地建议：
- **tokens/usage 指标口径**：优先记录 input/output token usage，并和 `context-pack.json` 的预算/估算对账。
  - 例如 OTel GenAI metrics 中有 `gen_ai.client.token.usage`（并用 `gen_ai.token.type=input|output` 区分）。
- **内容处理最佳实践**：GenAI span/event 中的输入/输出内容可能很大且敏感；OTel 也明确建议：
  - 生产环境优先“内容外置（external storage）+ span 里记录引用”，而不是把全文塞进 telemetry。
  - 这与我们“Evidence Pack + pointers-not-paste”的设计完全一致：telemetry 记录 trace/指标，Evidence Pack 记录可验证证据。
- **版本固定**：OTel SemConv 仍在演进，建议在实现中固定一个 semconv 版本，并把版本号写入 Evidence Pack（便于长期对账）。

## Section 9 — 上游同步策略（OpenCode + oh-my-opencode 的“吸收式开发”）

你提出的“既要持续吸收上游，又要开发自己的能力”是开源项目走向企业级时最常见的诉求。推荐采用
“两者都保留：开发用 monorepo/workspace，发布/对齐上游用 submodule/vendor”的组合策略，但要把边界
设计清楚，避免双份源码长期漂移。

建议把 OpenCode core 与 oh-my-opencode 都视为 **Upstream Track**：保持可快速更新的来源（submodule 或
vendor 镜像），并为每个组件配置 `upstream` remote，定期拉取与对齐。我们的增强部分走 **Overlay Track**：
在 workspace 中放置“薄封装/适配层 + 补丁集”，而不是长期 fork 一份大改。具体做法：

- **推荐选择：git submodule 作为发布/对齐上游的主方案**（subtree 作为备选）
  - 为什么选 submodule：
    - 版本 pin 清晰：每次升级就是“指向上游某个 commit”，审计与回滚都简单。
    - 上游历史保持原样：便于对齐 release/tag、做 range-diff、定位上游变更来源。
    - 多上游组合更自然：OpenCode 与 oh-my-opencode 可以分别独立升级，不强耦合。
  - subtree 适用场景（不作为默认）：你明确希望“单仓单 git clone 即可完整开发”，且团队对 subtree 的升级流程非常熟。

- **开发态（workspace）**：把 `oh-my-opencode` 作为 workspace package 引入，便于本地联调与端到端测试；
  同时 core 提供稳定 API（沙盒/证据/缓存/权限/子代理调度），插件只实现编排策略与 UI/交互增强。
- **发布态（submodule/vendor）**：固定上游版本（commit pin），我们的修改以 patch queue 形式维护
  （例如 `git format-patch`/`git rerere`/range-diff），升级时先更新 submodule，再重放/重演补丁并跑门禁。
- **契约测试**：为 core↔插件 的关键契约增加集成测试（API 兼容、事件语义、权限边界、Evidence Pack 输出），
  防止上游升级导致“能编译但行为变了”。
- **版本锁定清单（集成层 Manifest）**：在“集成工作区”（例如 `opencode-zh-build`）维护一个可机器读取的
  lock 文件，记录 OpenCode/oh-my-opencode 的 commit、补丁 sha256、以及构建工具链版本。该 lock 文件可以视为
  Evidence Pack 的 L1 Manifest/L4 Provenance 的“最小实现”，用于企业级复现与审计。

这套策略的目标是：上游更新带来的收益最大化，同时把我们真正的“护城河”集中在底层基础设施与可验证交付链路上。

## Section 10 — 集成层 UPSTREAM.lock.json（最小 Manifest/Provenance）规范

为避免“集成工作区不是 git 仓库导致无法追溯版本”的问题，建议在 `opencode-zh-build/` 生成并维护
`UPSTREAM.lock.json`。该文件的目标不是替代 Evidence Pack，而是作为 **Evidence Pack 的最小 L1/L4**：
让任何人可以在不打开终端的情况下回答“这次构建到底用了哪个上游版本、哪个补丁、哪个工具链”。

建议字段（v1）：
- `schemaVersion`: 锁文件版本
- `generatedAtUtc`: 生成时间
- `toolchain`: bun/node 版本
- `repos.opencode`: path/head/branch/dirty/remotes(origin/upstream)
- `repos.oh-my-opencode`: 同上
- `patches.*`: patch path + sha256

与 Evidence Pack 的映射：
- `UPSTREAM.lock.json` → Evidence Pack 的 `environment.repo`、`environment.runtime`、`artifacts(manifest)` 的输入
- `patch sha256` → Evidence Pack 的 `artifacts[]` 与 `checks[]` 的完整性校验依据
- `dirty=true` → Evidence Pack 的 `risks[]`（不可复现风险）或 `claims[]`（环境断言）

自动生成方式：
- 建议在 `opencode-zh-build/update_opencode_zh.sh` 的成功路径里自动写入/更新（幂等）。
- CI 中可额外校验：若 lock 文件缺失或与当前 HEAD/patch 指纹不一致则失败。

## Section 11 — “最小闭环”PoC 定义（不简陋）与 P 阶段路线图

你强调的“最小闭环不能太简陋”非常正确：PoC 必须能让单人日常使用时就覆盖核心需求点（沙盒执行、子代理并行、
上下文控制、证据产物），同时具备清晰的扩展点，才能逐步走向生产级/企业级。下面给出一个“够用且可扩展”的最小闭环
定义，并拆成可交付的 P 阶段。

### 11.1 最小闭环（PoC v1）必须满足的能力清单

PoC v1 不是“跑一个命令就算完成”，而必须覆盖以下链路：

1) **主会话沙盒执行（BashTool）**：Bash 工具的执行必须进入 Execution Sandbox（与 worktree 概念区分），并输出可追溯产物。
2) **子会话沙盒执行（Subagent）**：主代理创建的子 session（子代理）也必须通过同一套 Execution Sandbox 执行工具。
3) **Python 执行器（PythonTool）**：至少支持在沙盒内执行受控 Python 脚本（用于结构化处理/生成报告），并落盘产物。
4) **Evidence Pack（最小可验收）**：每个 session 都能生成最小 evidence 包：
   - `pack.json`（Canonical）、`pack.md`（View）、`manifest.json`（路径+sha256）
   - 至少记录：checks（执行了什么）、artifacts（产物在哪里）、provenance（沙盒/权限/模型信息）
5) **指针化输出（Pointers-not-Paste）**：主会话与子会话的长输出不回填提示词，只回填摘要 + 指针（路径/哈希）。
6) **扩展点就位**：Sandbox Runner / Evidence Writer / Context Builder 必须是可替换模块（接口化），后续可增强隔离后端与缓存策略。

### 11.1.1 默认产物路径（单人可用 + 不污染仓库）

默认建议把 Evidence Pack 与执行产物写入项目的工具状态目录，而不是仓库根目录：

- Evidence Pack：`.opencode/evidence/<sessionId>/pack.json`、`.opencode/evidence/<sessionId>/pack.md`、`.opencode/evidence/<sessionId>/manifest.json`
- 执行产物：`.opencode/artifacts/<sessionId>/...`

原因：
- 不污染仓库根目录、默认不进入版本控制（更符合企业/商用工具的“状态目录”实践）。
- 便于按 session/任务分区与做保留周期（Retention）策略。

同时提供显式导出能力（用于交付/PR/CI 归档）：
- `opencode evidence export <id> --out ./evidence/<id>/`（示例）
- 导出时执行脱敏与 allowlist 校验，确保不会把敏感信息带出沙盒/状态目录。

### 11.2 P0-P4 路线图（含 P1.5 收口门禁；每阶段都有“能用 + 可验证”产出）

**最佳实践分期说明（已确认）**：
P0–P4 的分期是本设计稿的**最佳实践推进**：先把“协议/证据链/统一执行入口”打牢（P0/P1），再做并行与写入协调（P2），随后才是上下文工程（P3）与生产级治理（P4）。

但为了避免“P0/P1 看起来能跑、P2 一做并行与合并就暴露底座欠账”，在 P1 与 P2 之间插入 **P1.5（收口门禁）**
作为强制 Gate：专门把 P0/P1 的关键不变量（协议强校验/证据不断链/审批收敛/可解释边界/变更集可复验）补齐并门禁化，
确保进入 P2 后不会因为底座语义漂移而返工。

该顺序可以最大化早期可用性、最小化返工与安全风险。后续若需调整分期，必须在此处更新并记录原因。

**执行勾选清单（每完成一个阶段请勾选）**：
- [x] **P0**：软沙盒 + Evidence Pack v1 + BashTool 统一执行 + git worktree 隔离落地
- [x] **P1**：PythonTool + 子会话沙盒一致性 + micro-pack
- [x] **P1.5**：P0/P1 收口门禁（协议/证据/审批/变更集/导出）→ P2 强制前置
- [x] **P1.6**：Token Economy（Sub2API 兼容缓存/粘性会话）+ 注入确定性 + 指针化（为 P2/P3 铺路）
- [x] **P2**：并行与写入协调（隔离/共享 workdir）+ 自动合并 + 冲突 artifacts + worker 并行协议骨架
- [ ] **P3**：Context Pack（schema+计数器 SSOT）+ 指纹缓存 + compaction 联动 + prefix determinism
- [ ] **P4**：硬沙盒后端 + OTel + 企业治理/合规 + 远端归档/保留周期 + Attestation（可选）

### 11.2.1 状态更新（2026-01-30）：P1.6 已完成（并明确 P3 待办，防遗漏）

P1.6 的目标不是“某一家模型的缓存命中”，而是把 **OpenCode / oh-my-opencode / Sub2API** 三段链路打通，
使其具备与 Codex CLI 类似的 **token economy 基础能力**：更稳定的会话粘性、可复用的缓存 key、注入有预算且不抖动，
从而让上游/网关侧的前缀缓存（如果支持）有机会被命中。

**P1.6 已落地（Done）**：
- OpenCode：
  - 支持 `wire_api=responses`，并在走 Responses 线路时注入 `promptCacheKey=sessionID`（用于 Sub2API/OpenAI 前缀缓存命中）。
  - 新增可控的 `stickySessionHeaders`：对 OpenAI 默认发送 `session_id/conversation_id`，并可对非 OpenAI 网关强制开启。
  - DeepSeek usage 统计归一：把 `cached_tokens` 映射到 `cache.read`，并避免把 `reasoning_content` 回放进历史（降低 token 膨胀与提示词漂移）。
- oh-my-opencode：
  - 修复跨 session 注入兜底风险（缺失 sessionID 时不再回退主会话 pending），避免“并行子会话”污染主会话上下文。
  - 同优先级注入改为确定性排序（按 source+id），降低并发注册导致的前缀抖动。
  - 增加注入预算与指针化（Pointers-not-Paste）：超长内容落盘为 `.opencode/context-capsules/<sha>.md`，提示词只注入 `<context_pointer>`（稳定前缀 + 降 token）。
- Sub2API：
  - OpenAI：sticky-session 增加 `x-opencode-session` 兜底；保证同一会话稳定命中同一上游账户/连接池。
  - Gemini v1beta：优先使用 `session_id` 生成 sticky hash（避免多账号轮询导致的上下文漂移）。
  - Anthropic `/v1/messages`：优先 `session_id` header 做 sticky-session，确保同会话稳定。
- 端到端验收（蓝绿双跑）：新环境 18081 已验证 OpenAI/Codex Responses 的真实 `cached_tokens` 命中；旧 18080 未受影响。

**P1.6 明确推迟到 P3 的点（TODO / 不要遗忘）**：
- Gemini：Cached Content（缓存内容）的自动创建/复用/失效管理仍未接入（P3 需要设计“缓存对象生命周期 + 预算策略 + 可观测性”）。
- Claude/Anthropic：若走其 prompt cache / cache-control（ephemeral 等）能力，需要在 Context Pack 与 tool schema 层做规范化适配与观测。
- 多模型统一：DeepSeek / GLM / MiniMax / Gemini/Antigravity 的缓存字段与 usage 口径需要统一的归一层（SSOT），并把命中率写入 Evidence/Tracing。
- Context Pack + prefix determinism：P3 仍需把“上下文构建/压缩/前缀稳定”做成可解释、可测试、可观测的一等公民（P1.6 只是铺路）。

**跨阶段硬门禁（P0 起始即强制；避免越迭代越乱）**：
这些门禁是“底座工程契约”，不是某个阶段的可选功能；任何阶段的实现若破坏这些门禁，都必须阻塞合并。

1) **Artifacts 不断链**：
   - 任何落盘 artifact 必须登记到 `manifest.json`（path + sha256 + kind + size）。
   - 若写入/登记失败：必须写 `events: evidence.write_failed` 并产出失败 artifact（错误摘要 + 指针）。
2) **事件必成对**：每次 tool 调用至少有 `tool.started` 与 `tool.completed`（失败也要 completed，status=error/degraded）。
3) **协议强校验**：routing/context-pack/worker-result/events/pack/manifest 等协议文件写入前 `schema.parse()`；读取后同样 parse。
   - parse 失败：必须写 `events: protocol.violation` 并生成失败 artifact（错误摘要 + 指针），保证证据链不断。
4) **边界可解释**：每次执行必须在证据中记录：`workdirMode`、可写路径集合、网络模式、命令策略评估结果（至少路径/命令/网络三维）。
   - 推荐产物化：`execpolicy.eval.json`（artifact）+ 对应 events 引用（UI/CLI 仅展示安全摘要）。
5) **审批收敛**：每次 tool run 最多允许一次“最终审批”交互（合并展示触发原因），并将评估结果写入证据。
6) **Pointers-not-Paste**：超过阈值的 stdout/stderr/长文本一律落盘为 artifact；上下文与输出只回传“摘要 + 指针”。
7) **确定性与版本化**：stableJson/canonicalization 规则必须固定；任何破坏确定性的变更必须 bump `specVersion` 或模板版本并加回归测试。
8) **软/硬透明**：`enforcement=soft|hard` 必须如实声明；`soft` 阶段的 allowlist 只能用于审批/审计，不得暗示 OS 级阻断。

P0（打底：Execution Sandbox + Evidence Pack 框架）：
- 目标：让单人能跑“主会话工具执行 → 生成证据 → 导出到项目目录”。
- 交付：
  - Execution Sandbox 抽象（先实现“受限目录 + 资源限制 + 审计”软隔离，后续接 bwrap/nsjail 等硬隔离）。
  - `isolated` workdir 的骨架（git worktree）：为 session 创建 `.opencode/worktrees/<sessionId>/` 并记录 provenance；先以“产出 patch/diff artifact”为主，自动合并/冲突处理留到 P2 完整化。
  - `BashTool` 通过 Sandbox Runner 执行（至少在 server 侧统一入口，保留现有 PermissionNext 询问）。
  - Evidence Pack Writer 最小版（pack.json/pack.md/manifest.json），落盘到 `.opencode/evidence/<sessionId>/...`。
  - 规则：工具输出超过阈值时只写 artifact 文件并返回指针。
  - 配置对账最小闭环：提供 `opencode config show --effective`（或 UI 等价），为后续企业治理与排障打基础（见 Section 17.1）。

P1（PythonTool + 子会话沙盒一致性）：
- 目标：把“Python 脚本执行”纳入同一沙盒与证据链，并保证子会话与主会话行为一致。
- 交付：
  - `PythonTool`（沙盒内执行，输入/输出以文件与 JSON 为主），默认禁网，资源上限与超时。
  - 子 session 工具调用也走 Sandbox Runner，并生成 micro Evidence Pack（每个子 session 一份）。
  - 主会话能汇总子会话 micro-pack 的指针（不粘贴全文）。
  - 可选但强烈推荐：`undo`（per-turn git 快照/回滚，feature flag，见 Section 5.2/17.3），降低“自动化误改”的心理成本。

P1.5（收口门禁：P2 前强制 Gate，确保 P0/P1 “彻底完结”）：
- 目标：把 P0/P1 的“关键不变量”做成可验证门禁，并补齐 P2 需要依赖的底座语义（审批/证据/变更集/导出/可解释边界）。
- 交付（必须）：
  - **证据失败可复盘**：补齐 `events: evidence.write_failed` 的失败证据路径；Evidence 写入失败不得静默。
  - **审批收敛**：实现 “每次 tool run 最多一次最终审批” 的合并交互（命令/路径/网络等原因合并展示），并把评估结果产物化（`execpolicy.eval.json`）。
  - **Provenance 补齐**：`pack.json` 的 `environment` 至少记录：os/runtime、repo commit/dirty、workdir 模式与关键 capability 摘要。
  - **集成层版本锁（强烈推荐）**：生成/维护 `UPSTREAM.lock.json`（见 Section 10），把上游 commit/patch sha256/toolchain 作为最小 L1/L4 provenance 记录进证据链。
  - **变更集可复验**：隔离 workdir（git worktree）场景下，生成 `patch/diff` artifact 并登记到 manifest；micro-pack 必须能携带变更集指针。
  - **显式导出最小闭环**：提供最小 `opencode evidence export <sessionId> --out ...`（或等价）实现，并强制路径/symlink/allowlist 校验；导出过程必须写 events。
- 执行计划参考：`docs/plans/2026-01-28-opencode-sandbox-context-p1_5-implementation-plan.md`
- Exit Gate（建议）：
  - 任意一次 bash/python/tool/task（含子会话）执行后：`.opencode/evidence/<id>` 下 pack.json/pack.md/manifest.json/events.jsonl/micro-pack.json（子会话）均可生成；
  - tool run 的 evidence 中可解释展示：backend/enforcement + capability 摘要 + execpolicy eval；
  - 若证据写入失败：有 `evidence.write_failed` 事件与失败 artifact 指针。

P2（并行与写入协调：隔离 workdir 默认 + 可切共享 workdir）：
- 目标：让“并行”真正可用，同时避免多代理写入冲突造成不可控；并把“并行取证（worker）+ 并行改代码（workdir）”统一纳入证据链与回滚策略。
- 交付：
  - **隔离 → 合并**：
    - 默认隔离 workdir（git worktree；每个 session 一个可写工作区）。
    - 子任务结束输出 patch + manifest（可复验变更集），主会话自动合并回主 workdir（优先 3-way apply），冲突生成 artifact 并要求决策。
    - 合并后必须跑最小门禁（format/lint/test 任选其一），并把结果写入 `checks[]`（macro Evidence Pack 口径一致）。
  - **共享 workdir 的写入协调**：
    - 共享 workdir（按需开启），并发写入采用“并行读、串行写”（锁/队列），并对同文件并行写入意图做检测与排队。
    - 锁/队列/排队决策必须写 events（可复盘为什么没并行、为什么排队）。
  - **Worker 并行协议骨架（A/B/C）**（见 Section 2.3）：
    - 产物化：`routing-run-request/1.0`（request.json）+ `worker-*.result.json` + `routing.capsule.md` 全部落盘，且写入/读取都有 Zod contract tests。
    - 调度：并发上限、取消、超时、降级（worker 不可用时写 `events: worker.unavailable` + risks）。
    - 安全：worker 默认只读/禁网；若访问本地服务（loopback）必须显式 allowlist 并在证据中声明软/硬能力边界（见 Section 12.1）。

P3（上下文工程：Capsule + 指纹缓存 + compaction 合并）：
- 目标：把“省 token / 高命中 / 超长上下文”做到工程可控。
- 交付：
  - **Context Pack SSOT**：落地 `context-pack.json（v1）` schema（计数器与可审计性的 SSOT，见 Section 16.2.1），并做到 UI/CLI “非黑盒”可解释展示（见 Section 16.2.2）。
  - Capsule（关键事实+指针）作为默认输入层；与 `SessionCompaction`/`SessionSummary` 联动，且 compaction 输出必须含证据指针（避免摘要漂移）。
  - Context Pack 指纹（模板版本+摘要版本+文件哈希）用于复用与命中统计；本地缓存为 SSOT，provider prompt caching 只作为加速器（见 Section 3.2/21.3）。
  - scoped LRU/TTL（文件内容/检索结果/上下文包）与命中率统计面板（至少日志可查、可 grep）。
  - 前缀确定性（prefix determinism）落地：toolsetFingerprint + block fingerprints + MCP toolset freeze（见 Section 16.4），并补齐回归测试（同输入 → 同 cacheKey）。
  - 抗提示注入与消耗治理：把“默认安全（safe timeline + 指针化）”做成机制，而非靠提示词约定（见 Section 16.3.3）。

P4（生产级/企业级增强）：
- 目标：把“可观测、可治理、可合规”做全。
- 交付：
  - **硬沙盒后端**：Linux(bwrap/nsjail)/macOS(sandbox-exec)/Windows(Job Object 等) 统一抽象，且后端必须声明真实能力（backendCaps），避免“写了 allowlist 但实际绕过”。
  - **可观测性**：OTel tracing 与 Evidence Pack 的 traceId/spanId 关联；建议对齐 OTel GenAI SemConv（见 Section 8.2），内容外置为 artifacts。
  - **企业级治理**：requirements（不可覆盖）+ managed defaults（可覆盖但下次启动重置）（见 Section 17.2），组织级策略模板（域名白名单、敏感路径、命令黑名单、脱敏规则）。
  - **远端归档与保留周期**：Evidence Pack 可选远端归档（对象存储/WORM 可选）、Retention、访问审计（谁查看了什么）。
  - **供应链与合规**：可选对接 SLSA/in-toto attestation；Python/工具链 SBOM（CycloneDX/SPDX）作为 artifact 进入 Evidence Pack（见 Section 14.2）。
  - **运维与单人体验（必须可长期用）**（见 Section 19）：
    - 一键清理：`opencode evidence clean --older-than <days>`、`opencode cache clear`（示例）
    - 索引与检索：evidence 本地索引（按 sessionId/时间/claim 类型检索），避免用户手动翻目录
    - 故障自救：缓存/compaction 异常时提供“禁用缓存/强制重建 context-pack”的开关与证据化说明

验收建议（每个阶段都可验收）：
- P0：能跑 bash 工具且生成 evidence；产物指针可点击可复验（默认在 `.opencode/`，需要时可导出到 `./evidence/`）。
- P1：能跑 python 且子会话也能生成 micro evidence（micro-pack 可合并）。
- P1.5：证据失败可复盘（evidence.write_failed）；每次 tool run 最多一次审批；pack.json provenance 补齐；隔离 workdir 有可复验 patch；提供最小 evidence export。
- P2：并行跑多个子任务（含 worker 并行），最终合并到主 workdir，并通过门禁（tests/lint/format 至少一项，结果写入 checks）。
- P3：同类任务重复执行能稳定命中（上下文指纹命中率可观测）；context-pack 计数器可解释。
- P4：硬沙盒后端可声明能力边界；OTel 关联可用；企业策略可下发与审计。

## Section 12 — 威胁模型与默认安全决策（生产级/企业级）

为了达到生产级与企业级，本方案明确假设：模型输出不可信、用户输入可能包含提示注入、依赖与外部网络不可控。
因此安全策略采用“默认拒绝 + 显式授权 + 全链路审计”，并将其落到可执行的默认决策上：

- **网络默认策略：分级模式（推荐）**
  - `plan`：默认禁网（只读探索、上下文构建）；避免信息外泄与不确定依赖。
  - `limited`：仅允许域名白名单（例如文档站、包仓库、企业代理）；强制记录出站访问摘要。
  - `full`：可配置，但仍要求显式开启与审计记录；企业场景建议仍使用白名单而非全放开。
- **文件系统默认策略**
  - 源码目录以只读挂载进入沙盒；写入只允许 workdir 与 `.opencode/` 状态目录。
  - 任何跨目录写入必须触发权限提示，并写入 Evidence Pack Provenance。
- **工具默认策略**
  - 所有工具执行（bash/python/未来的 npm/git/formatter）必须通过 Sandbox Runner 统一入口。
  - 工具输出优先落盘，回传“摘要 + 指针”，避免将敏感数据或巨量输出注入上下文。
- **缓存隔离默认策略**
  - 本地缓存按 project/worktree 分域，必要时细化到 session/user；防止跨租户复用带来的侧信道风险。
  - 外部模型侧的 prompt caching 视为“可用但不可完全控”的加速器：只有在明确的租户边界与策略下启用。

以上默认值的目标是：单人使用可用、团队协作可控、企业合规可审计。

### Section 12.1 — 本地服务访问（Loopback Allowlist）与 SSRF 风险（必须显式治理）

全自动路由并行（Worker B/C）在本地/企业环境里经常需要访问“本地服务”：例如本地 KB（PG/Qdrant）、本地图谱（Neo4j）、
本地 MCP server、以及未来的企业内网网关。这在安全上仍然属于“网络访问”，不能因为是 `localhost` 就放任不管：

- **风险 1：SSRF**（Server-Side Request Forgery）
  - 模型可能被提示注入诱导访问 `http://127.0.0.1:<port>/admin` 等敏感端口，读取或修改不该触达的本地服务。
- **风险 2：侧信道/数据泄露**
  - 即便是本机服务，也可能承载敏感信息（API key、私有笔记、企业数据）。

因此本方案要求：
- 本地服务访问必须走 allowlist（host+port+protocol），默认只允许“明确配置的服务”。
- 对每次本地服务调用写入 Evidence Pack：
  - `events`: service name、target host/port（可脱敏）、请求摘要、状态码/耗时
  - `risks`: 若访问被拒绝/降级，必须记录“能力降级”以便复盘
- 在 `plan` tier 下，默认禁止一切网络（含 loopback）；如果你希望“plan 也能查本地 KB/Graph”，必须显式开启 `planLocalServices=true`
  并写入 Evidence Pack provenance（这在企业里尤其重要）。

## Section 13 — Execution Sandbox（每 session 沙盒）详细设计

Execution Sandbox 是“执行隔离”的统一抽象，必须支持：按 session 分配、资源限制、可追溯产物、可控导出。
建议采用以下目录布局（宿主侧）：

- `.opencode/sandboxes/<sessionId>/root/`：沙盒根（可选，取决于后端）
- `.opencode/worktrees/<sessionId>/`：**git worktree 工作区（默认隔离模式，可写）**
- `.opencode/artifacts/<sessionId>/`：执行产物输出目录（日志、stdout/stderr、临时文件、patch）
- `.opencode/evidence/<sessionId>/`：Evidence Pack 输出目录（pack.json/pack.md/manifest.json）

挂载策略（核心）：
- 将项目源码目录（worktree/directory）以只读方式 bind-mount 到沙盒内固定路径（例如 `/workspace/src`）。
- 将 workdir 以读写方式挂载到 `/workspace/work`；工具默认在 workdir 中执行。
- 将 artifacts/evidence 目录以读写挂载到 `/workspace/out`（但导出仍走 allowlist 网关）。

后端选择（分平台）：
- Linux：优先 bubblewrap(bwrap) 或 nsjail（namespace/seccomp/cgroups）；不可用时降级软隔离。
- macOS：优先 sandbox-exec profile（限制写入路径与网络）；不可用时降级软隔离并提示风险。
- Windows：优先 Job Object（限制进程树、时间、内存）+ 目录限制；必要时结合 Windows Container。

资源限制（所有平台都要有同等语义）：
- 超时：默认 2-5 分钟，允许工具覆盖但需审计。
- 内存/CPU：按任务等级（plan/limited/full）配置。
- 进程树：必须可终止（kill tree），避免后台进程泄露到宿主。

### Section 13.1 — Sandbox Runner API（建议 TypeScript 接口）

为了让“主会话/子会话/插件”都能复用同一套沙盒能力，Sandbox Runner 必须是 server 侧的稳定接口。
下面是建议的最小接口（PoC v1 足够，后续可扩展）：

```ts
export type SandboxBackend = 'auto' | 'soft' | 'bwrap' | 'nsjail' | 'sandbox-exec' | 'job-object';

export type SandboxEnforcement = 'soft' | 'hard';

export type SandboxNetworkPolicy =
  | { mode: 'deny_all' }
  | { mode: 'allowlist'; allowedDomains: string[] }
  | { mode: 'full'; note?: string };

export type WorkdirMode = 'isolated' | 'shared';

export type SandboxCapability = {
  // All paths are resolved relative to project root; backend enforces boundary.
  readonlyPaths: string[];
  writePaths: string[];
  exportPaths: string[]; // allowlist for "export stage" back to repo path
  allowedCommands?: string[]; // optional strict allowlist (prefer for enterprise)
  blockedCommands?: string[]; // denylist for quick safety
  network: SandboxNetworkPolicy;
  workdirMode: WorkdirMode;
};

export type SandboxLimits = {
  timeoutMs: number;
  maxProcesses?: number;
  maxMemoryMb?: number;
  maxCpuSeconds?: number;
};

export type SandboxRunRequest = {
  sessionId: string;
  toolName: 'bash' | 'python' | string;
  command: string;
  args?: string[];
  cwd?: string; // typically /workspace/work inside sandbox
  env?: Record<string, string>;
  stdinArtifactPath?: string; // optional: write stdin to artifact and pass via file
  capability: SandboxCapability;
  limits: SandboxLimits;
};

export type SandboxRunResult = {
  backend: SandboxBackend; // resolved backend (after auto selection / fallback)
  enforcement: SandboxEnforcement; // MUST be recorded to Evidence Pack for transparency
  exitCode: number;
  timedOut: boolean;
  stdoutArtifactPath: string;
  stderrArtifactPath: string;
  producedArtifacts: Array<{ path: string; sha256: string; kind: string }>;
};

export interface SandboxRunner {
  backend(): SandboxBackend;
  run(req: SandboxRunRequest): Promise<SandboxRunResult>;
}
```

要点：
- **sessionId 是一等公民**：让每个 session 都能拥有自己的隔离 workdir、产物目录与证据目录。
- **capability = 权限的可执行形态**：PermissionNext 的 ask/allow/deny 最终必须映射为 capability（可执行的边界），并写入 Evidence Pack provenance。
- **输出必须“产物化”**：stdout/stderr 默认落盘并返回路径（指针），避免直接把大段输出塞回上下文。

#### Section 13.1.1 — ExecPolicy（prefix-rule）与 SandboxPermission：把“可执行权限”工程化（借鉴 Codex 的落点）

你关心“生产级/企业级”时，最容易踩坑的是：权限系统停留在“口头约定”，最后变成“看似有权限弹窗，但实际边界不清晰”。
Codex 的开源仓库里提供了一个非常可借鉴的思路：把命令治理做成**可解释、可测试、可合并**的 policy-as-code。

**A) 命令级 ExecPolicy：prefix-rule + allow/prompt/forbidden**
- 思路：把 shell 命令先 token 化（类似 `shlex`），然后用“前缀规则”匹配。例如：
  - `["git", "status"]` 可能默认 allow
  - `["git", "push"]` 可能 prompt
  - `["rm", "-rf"]` 可能 forbidden
- 规则文件允许：
  - `decision = allow|prompt|forbidden`
  - `justification`（为什么有这条规则；当 forbidden 时给出替代方案）
  - `match/not_match` 示例（作为“规则自带单测”，加载时验证）
- 这套机制与 PermissionNext 不冲突：PermissionNext 仍做“高层能力询问”（例如是否允许运行 shell、是否允许访问某目录/网络），
  ExecPolicy 做“命令级细粒度门禁”，让“默认值更安全、拒绝更可解释”。

**B) SandboxPermission（可执行能力枚举）：把 capability 拆成可审计的 permission set**
- Codex 社区讨论中出现了很清晰的枚举：Disk 读写范围（cwd/指定目录/全盘）、临时目录写入、网络访问等。
- 对我们落地的建议：
  - `SandboxCapability` 保留“路径/网络/命令”三大维，但在 Evidence Pack 中同时写入一个离散的 `sandboxPermissions[]`（便于审计与企业策略约束）。
  - `sandboxPermissions[]` 是“语义层”，backend 负责映射到具体实现（bwrap/nsjail/sandbox-exec/job-object）。

**C) 协议化输出：每次 execpolicy 评估都产出 JSON 结果并进入 Evidence Pack**
- Codex 的 execpolicy CLI 会输出 JSON 评估结果（匹配了哪些规则、最终 decision 是什么）。
- 我们同样要求：每次 Shell/Python 执行前，把“策略评估结果”写成 artifact（例如 `execpolicy.eval.json`），并记录：
  - matchedRules（含 justification）
  - decision（最终最严格：forbidden > prompt > allow）
  - policyHash/policyVersion
  - commandFingerprint（stable tokenization + stableJson）

这样做的收益是：你未来要做企业版时，才有可能实现“requirements/managed policy 下发 + 审计复盘 + 合规证明”。

### Section 13.2 — “文件/资料工作台”（像 GPT Web UI 一样用沙盒管理上传文件，避免 token 爆炸）

你观察到 GPT-5.x Web UI 会在“沙盒环境”里用 Python 处理 PDF、整理文件夹、生成中间产物——这背后的工程价值，
并不是“Python 更神奇”，而是 **“把大对象变成可追溯产物（artifacts），上下文只传指针与摘要”**。

因此本方案明确把“资料处理”作为沙盒的重要职责之一（PoC 可先做最小实现，后续逐步增强）：

**目标**：
- 让用户提供的资料（PDF/图片/表格/压缩包/代码片段）进入“session 资料工作台”，所有处理都在沙盒内完成。
- 生成可复验的中间产物（抽取文本、结构化 JSON、索引、摘要），并登记到 Evidence Pack。
- 主模型/主代理只消费 capsule + 指针（manifest entries），避免把原文塞进 prompt 导致 token 爆炸。

建议的目录结构（每个 session）：
- `.opencode/artifacts/<sessionId>/inputs/`：原始输入（只读对 agent；写入由系统完成）
- `.opencode/artifacts/<sessionId>/derived/`：派生产物（抽取文本、OCR、结构化 JSON、切片片段）
- `.opencode/artifacts/<sessionId>/indexes/`：可选索引（例如向量化前的切片、倒排索引缓存）

**输入对象的“去重与缓存”**（命中率与成本控制的关键）：
- 每个输入文件计算 `sha256`，以 `inputId = sha256` 作为稳定标识。
- 若同一 `sha256` 在同项目内已抽取过（缓存存在且版本匹配），则复用派生结果：
  - 复用的事实必须写入 Evidence Pack（`events: cache_hit`），避免“看起来做了但其实复用”不透明。

**资料处理的最小工具集（建议作为 PythonTool 的内置脚本注册表扩展）**：
- `doc.extract_pdf_text`：PDF -> text（产物：`.txt` + `.json` 元数据）
- `doc.ocr_image`：image -> text（产物：`.txt` + `.json` 元数据；可延后到 P2）
- `doc.unpack_archive`：zip/tar -> 目录（产物：展开目录 + 文件清单）
- 所有脚本必须：
  - 在沙盒内执行（受 capability/limits 控制）
  - 输出落盘为 artifacts
  - 在 Evidence Pack 的 `artifacts[]/manifest.json` 登记 sha256

**上下文注入规则（防止“资料越多越慢”）**：
- 默认不把原文注入 prompt；只注入：
  - 一段 capsule（<= N tokens）
  - 指向 `.opencode/artifacts/...` 的 pointers（路径 + sha256）
  - 必要时才按“预算驱动”抽取少量 snippet（snippet 本身也应落盘并登记）

这套机制能把“超长资料”变成可管理的资产：你不需要懂 token，也能自然获得“越用越稳、越用越省”的体验。

#### Section 13.2.1 — 资料工作台 PoC 范围拆分（P1/P2 可交付）

你要的是“先单人自用打磨，再走通用平台商业化”。因此资料工作台必须按阶段拆分，避免 P1 一上来就被 PDF/OCR/Office 文档拖垮，
同时确保 P1 就能形成闭环（可用、可证据化、可缓存、可扩展）。

**P1（单人自用：最小闭环，但不简陋）**：
- **输入管理**：把“用户输入的文件/目录/压缩包”落到 `.opencode/artifacts/<sessionId>/inputs/`，并生成 `inputs.json`（name/size/sha256/mime/addedAt）。
- **通用去重复用**：`inputId = sha256(file_bytes)`，同 inputId 的派生结果可跨 session 复用（写入 Evidence Pack `events: cache_hit`）。
- **先覆盖“文本型资料”**（价值最高、依赖最少）：
  - `md/txt/json/yaml/csv/log/code` → 生成 `derived/<inputId>/text.txt` + `derived/<inputId>/chunks.json`
  - `chunks.json` 必须包含：chunk_index、start/end byte 或 line、content_hash、snippet_preview（小片段）
- **压缩包支持**：`doc.unpack_archive`（zip/tar）把内容展开到 `derived/<inputId>/unpacked/` 并生成清单（file list + sha256）。
- **PDF（P1 可做“best-effort”）**：
  - 默认走 `doc.extract_pdf_text`，但允许降级：若依赖不可用则产出“不可解析”证据（metadata + 提示安装/策略）而不是 silently fail。
  - 对你单人自用可接受的做法：显式开关允许在沙盒内创建 venv 并安装锁定依赖（全程写入 Evidence Pack，且网络必须 allowlist）。
- **上下文注入闭环**：
  - 主代理默认只拿：`derived/<inputId>/capsule.md` + `chunks.json` 的 topK 指针
  - 需要原文时才按预算拉 snippet（snippet 也要落盘并登记 sha256）

**P2（更接近 GPT Web UI：资料处理质量与覆盖面升级）**：
- **PDF 稳定解析**：页级/段级边界、可追溯到 page number；必要时提取表格/图片；输出 `derived/<inputId>/pdf.pages.json`。
- **OCR（图片/扫描 PDF）**：`doc.ocr_image`（可选本地 OCR 或企业云 OCR），但必须经过策略审批与脱敏。
- **Office/富文本**：docx/pptx/xlsx → text + structure（先做 docx，后扩展）。
- **索引与检索联动**：可选把 `chunks.json` 直接喂给 Chelingxi-OS 的 KB ingestion（通过 MCP/HTTP），形成“上传资料 -> 进入大脑”的通路。
- **企业级包装**：Python runtime/依赖离线打包（wheelhouse/SBOM/签名），避免生产环境联网装依赖。

### Section 13.3 — 沙盒内置工具带（Tool Belt）：用“工具检索/抽取/对账”换取超长上下文与低幻觉

你注意到我在这个环境里频繁使用 `rg`（ripgrep）做检索，这是典型的“上下文工程手段”：
**不是把全仓库/全文档塞进模型上下文，而是用工具先定位最相关的片段，再把“少量高价值证据”注入 Context Pack**。

这类工具的价值不是“让模型上下文窗口变大”，而是让你在有限窗口里做到：
- 更高相关性（少看无关文件/段落）
- 更低成本（少 token）
- 更低幻觉（证据来自工具输出，而不是模型猜测）

因此本方案明确：**主代理与子代理都应当能在沙盒内使用一组“内置工具带”**。并且这些工具的输出必须：
- 默认落盘为 artifacts（stdout/stderr/结构化结果），再以 pointers 注入上下文（pointers-not-paste）
- 尽量结构化（JSON），并在写入/消费时做 schema 校验（Zod）

下面给出推荐的 v1 工具带（按场景分组，P0-P2 可逐步落地；不要求一口气全装齐）：

**A) 代码场景（Repo/LSP/Refactor）**
- `rg`（ripgrep）：文本检索，建议优先用 `rg --json` 输出，便于稳定解析与证据化
  - 用法倾向：先 `--files`/`--type` 收敛，再 `--json` 获取 matches；按 score/path 稳定排序（见 Section 2.3.5）
- LSP（language server）：符号/引用/定义跳转（Worker A 的“精准定位”核心能力）
  - TypeScript：`typescript-language-server` / `tsserver`（示例）
- `git`：diff/log/blame/status（用来生成 repoFingerprint、以及把“变更”证据化）
- 结构化重构工具（可选但很强）：
  - `ast-grep`：基于 AST 的结构化搜索/替换（比纯文本更稳，降低误改风险）
  - `comby`：结构化模式替换（语言无关但比 sed/regex 更可控）
- 质量门禁工具（把“正确性”从主观变成客观）：
  - `tsc/tsgo`、`eslint`、`prettier`、`vitest/bun test`（按项目栈）

**B) 通用“结构化数据”场景（配置/表格/日志/JSON/YAML）**
- `jq`：JSON 处理（抽取字段、裁剪、规范化），非常适合把长 JSON 变成“摘要 + 指针”
- `yq`：YAML/JSON 转换与查询（适合配置与流水线文件）
- `python`（受控脚本）：作为“胶水语言”，把 CSV/日志/文本做结构化抽取与对账（输出 JSON artifacts）
- （可选）`duckdb`/`sqlite3`：本地小型分析任务（商业/运营/日志分析）用 SQL 做聚合，比让模型手算更可靠

**C) 文档/资料场景（PDF/图片/压缩包/Office）**
- `unzip`/`tar`：压缩包展开（配合 `doc.unpack_archive`）
- PDF（两条路线，按平台能力选择其一或两者兼容）：
  - Poppler：`pdfinfo`/`pdftotext`（快、稳定、易部署）
  - Python：`pypdf`/`pdfplumber`（更灵活，适合提取结构/表格，但要治理依赖供应链）
- OCR（可选）：`tesseract`（本地）或云 OCR（企业），必须纳入策略审批与脱敏
- 文档转换（可选）：`pandoc`（docx/markdown/html 等互转，适合作“资料工作台”的派生链）

工具带治理要点（避免“工具越多越失控”）：
- 所有工具都必须走 Sandbox Runner（统一超时/资源/网络/文件写权限），并写 events 形成可解释时间线。
- 对于可能泄露敏感信息的工具输出（例如 `git diff`、日志、PDF 原文），默认只写 artifact 并在 UI 里展示“指针 + 摘要”（见 Section 16.2.2）。
- 工具版本应尽量锁定并写入 Provenance（企业级可进一步做 SBOM/签名），保证可复现与可审计。

### Section 13.4 — 产物可检索写作规范（rg-friendly artifacts）：把“输出”也做成上下文工程

你提到的点非常关键：**不仅要让系统会 `rg` 检索代码/资料，我们生成的产物（尤其是 `.md`）本身也要“易检索、易对账、易压缩”。**
这本质上是“上下文工程”的最后一公里：把输出变成“可反复召回的结构化资产”，而不是一次性阅读的作文。

**核心原则（强烈建议写进规范，P0 就执行）**：
1) **稳定前缀 + 稳定字段名**：关键行必须用固定前缀（从行首开始），避免“同义反复”导致检索召回不稳定。
2) **少即是多**：`.md` 里只放摘要/结论/指针；长内容落到 `.json/.txt/.patch` artifact，再引用 path+sha256。
3) **可机器解析**：每个 Markdown artifact 都要有统一的元信息块（frontmatter）与稳定的段落结构。
4) **ID 可追溯**：每个重要结论/任务节点都带 `ulid` 或稳定 id，且 id 必须来自 session/routingRun，不得随机生成后丢失上下文。

**双层写作（推荐最佳实践：机器优先英文、人类阅读中文）**：
- **机器可读层（Machine Index）**：关键行前缀固定为英文大写（`CLAIM:` / `EVIDENCE:` / `RISK:` / `NEXT_ACTION:` 等），以便：
  - `rg '^CLAIM:'` 一把搜出所有结论
  - compaction 能稳定抽取要点（不靠自由写作摘要）
  - 后续可演进到“半结构化解析”（即使不用 LLM 也能提取）
- **人类可读层（Human Notes）**：正文解释、背景、推理过程用中文；但尽量把“长原文/长日志/大输出”落盘为 artifact，正文只引用指针。
- **关键细节**：前缀必须保持英文（ASCII + `:`），但冒号后面的内容可以是中文；这样同时满足“AI 好解析/好检索”和“你读起来舒服”。
- UI/CLI 展示可以本地化：例如把 `CLAIM` 在 UI 显示为“结论”，但底层文件仍保留 `CLAIM:` 行首，保证检索与稳定性。

**推荐的 Markdown artifact 模板（v1）**（所有 `capsule.md`/`pack.md`/`routing.capsule.md` 都尽量贴这个结构）：

```md
---
specVersion: artifact-md/1.0
artifactKind: capsule|pack|routing-capsule|note|report
artifactId: "<ulid>"
sessionId: "<sessionId>"
createdAtUtc: "<iso8601>"
source: "opencode"
redactionPolicyVersion: "<string>"
langPrimary: "zh"            # 人类阅读的主要语言
machineTags: "en"            # 行首前缀语言（固定英文，利于 rg/解析）
---

# <title>

## Machine Index (stable prefixes; values can be zh)
DECISION: <one-line decision>            # 可选
CLAIM: <one-line claim>                  # 可多条，每条一行
EVIDENCE: <manifestRef or path#Lx>       # 每条 CLAIM 至少一条 EVIDENCE（不确定就写 UNKNOWN）
RISK: <one-line risk>                    # 可多条
OPEN_QUESTION: <one-line question>       # 可多条
NEXT_ACTION: <one-line next step>        # 可多条

## 说明（中文，面向你阅读；长内容落盘为 artifact）
- 背景：...
- 取舍：...
- 约束：...

## Pointers
- ARTIFACT: .opencode/artifacts/... (sha256=...)
- EVENT: .opencode/evidence/.../events.jsonl (filter: traceId=...)
```

**为何这能提升“超长上下文体验”**：
- `rg '^CLAIM:'` / `rg '^EVIDENCE:'` 能直接把“关键事实与证据指针”召回给 worker/主代理，避免把全文塞进 prompt。
- compaction 时可以稳定保留这些“结构化要点”，而不是让模型自由发挥写摘要（降低摘要漂移与幻觉）。
- cacheKey 相关的内容（claims/pointers）更稳定，复用更可靠。

**推荐内置的检索 query（便于用户与 agent 形成习惯）**：
- 找本项目所有关键结论：`rg -n \"^CLAIM:\" .opencode/evidence`
- 找所有风险：`rg -n \"^RISK:\" .opencode/evidence`
- 找待办/后续：`rg -n \"^NEXT_ACTION:\" .opencode/evidence`
- 找引用链：`rg -n \"^EVIDENCE:\" .opencode/evidence`

**注意**：
- 不要在这些关键前缀行里放动态时间戳/随机数；时间线属于 `events.jsonl` 的职责。
- 不要在 `.md` 里粘贴大段工具输出；大段输出要落盘为 artifact（并登记 sha256），`.md` 只放“摘要 + 指针”。

## Section 14 — BashTool + PythonTool（沙盒内执行）落地规范

PoC 选择 3（BashTool + PythonTool）时，关键不是“加两个工具”，而是把它们统一纳入同一治理链路：

- **统一入口**：BashTool 与 PythonTool 都不直接 `spawn` 宿主进程，而是调用 Sandbox Runner 的 `run()`。
- **统一产物**：stdout/stderr 与关键输出落入 `.opencode/artifacts/<sessionId>/...`，并在 Evidence Pack 中登记 sha256。
- **统一权限**：每次执行都带上能力集（文件写入范围、网络策略、允许命令列表），并将审批写入 Provenance。

PythonTool 的生产级默认建议：
- 默认禁网；默认不允许在线安装依赖（pip install）。
- 允许的两种依赖模式：
  1) **内置脚本/内置依赖**：随 opencode 发布（最可控，适合企业）。
  2) **显式依赖锁定**：仅允许读取 `requirements.txt`/lock 文件并在沙盒内创建 venv；依赖下载需走企业代理/白名单并记录。
- Python 输出优先结构化（JSON）+ 落盘文件（报告/补丁），模型回传只包含摘要与指针。
- 对脚本执行参数、输入文件、输出文件清单进行完整审计（事件 + artifacts）。

### Section 14.1 — PythonTool 的“可控脚本注册表”（避免任意代码执行失控）

为避免 PythonTool 变成“任意代码执行后门”，PoC v1 就应引入一个非常简单但强约束的机制：**脚本注册表**。

- 脚本来源分两类（与上面的两种依赖模式对齐）：
  1) **内置脚本（推荐默认）**：随 OpenCode 发布，放在固定目录（例如 `packages/opencode/src/tools/python/scripts/`），并在构建时生成 `scripts.manifest.json`（path + sha256）。
  2) **项目脚本（可选）**：仅允许从项目内的受控目录读取（例如 `.opencode/scripts/`），并要求显式开关 `python.allowProjectScripts=true`。
- 运行时只能按 `scriptId` 调用，而不是任意路径：
  - `python.run({ scriptId: 'summarize-json', inputArtifact: '...', outputArtifact: '...' })`
- 每次执行必须写入 Evidence Pack：
  - `events`: scriptId、参数、输入 artifact、输出 artifact
  - `artifacts`: 脚本文件本身的 sha256（可复现与审计）

这套机制的价值是：单人使用很顺滑（不用每次解释怎么跑），企业使用也可控（“能跑哪些脚本”是显式白名单）。

### Section 14.2 — Python 依赖供应链与离线化（从“自用能跑”走向“企业可用”）

你非常关心“低幻觉 + 高质量 + 可审计”。在 PythonTool 场景里，最大的风险不是脚本逻辑，而是**依赖供应链与环境漂移**：
今天能跑，明天 pip 拉到不同版本就跑不出来；或者联网安装把不可信依赖带进来。

因此本方案把 PythonTool 的生产级演进定义为两条硬约束（P1 可先弱化，P2/P4 必须补齐）：

**(1) 可复现（Reproducible）**
- 每次 Python 执行都必须记录到 Evidence Pack：
  - python 版本、平台、脚本 sha256
  - 依赖 lock（含 hash）或 `pip freeze`（artifact）
  - 运行命令、stdout/stderr、输出文件清单与 sha256
- 同一 `scriptId + inputs.sha256 + deps.lock.sha256 + script.sha256` 应该得到可复现产物（或明确解释差异）。

**(2) 最小联网（Offline-first for Enterprise）**
- 企业/商用默认不允许“运行时联网安装依赖”。
- 推荐的离线安装方式（示例）：
  - 预先构建 `wheelhouse/`（离线 wheels 仓库）并随版本发布或在企业制品库托管
  - 使用 `pip install --no-index --find-links wheelhouse -r requirements.lock` 安装
  - `requirements.lock` 必须包含版本 + hash（例如 `--hash=sha256:...`），避免投毒
- 可选增强（P4）：生成 SBOM（CycloneDX/SPDX）并把 SBOM 作为 artifact 进入 Evidence Pack。

推荐演进路线（与阶段对齐）：
- P1：允许“显式开关 + allowlist 网络”的在线依赖安装（只为你单人自用提速），但必须写证据与风险（risks）。
- P2：引入 wheelhouse/lock-hash，默认离线；在线安装只作为 fallback（且需要明确批准）。
- P4：企业级制品链（签名/制品库/SBOM）与策略下发（well-known），做到可审计与可管控。

## Section 15 — Evidence Pack v1（最小可验收 schema + micro/macro 合并）

Evidence Pack 的目标是“proof-carrying handoff”，因此 schema 必须稳定、可合并、可验证。建议最小 v1 包含：

- `specVersion` / `packId` / `task`（title/intent/successCriteria）
- `environment`（execution.kind/id、os、runtime、repo commit/dirty）
- `claims[]`（可检验断言；每条指向 evidence）
- `artifacts[]`（path + sha256 + kind）
- `checks[]`（命令、状态、log artifact）
- `events[]`（tool 调用、权限审批、导出、合并、冲突）
- `capsule`（handoff + pointers + openQuestions）

micro/macro 合并规则（多代理并行的关键）：
- 每个子 session 输出 micro-pack（只包含它的 artifacts/claims/checks/events）。
- 主 session 合并为 macro-pack：按 sha256 去重 artifacts；按 claimId 或内容哈希去重 claims；冲突显式化（claim 冲突/证据不足）。
- macro-pack 必须包含“最终门禁结果”（tests/lint/format）与合并策略（rollback steps）。

与可观测性（OTel）关联：
- 在 events/provenance 写入 traceId/spanId，使一次交付既可离线审计，也可在线追踪性能与失败原因。

### Section 15.1 — pack.json（Canonical）最小示例（v1）

下面给出一个“够用但不简陋”的最小 Canonical 示例（字段可增不减；新增字段必须向后兼容）：

```json
{
  "specVersion": "evidence-pack/1.0",
  "packId": "EP-2026-01-25-session-<sessionId>",
  "task": {
    "title": "User request",
    "intent": "Implement sandbox + context control + caching",
    "successCriteria": ["Evidence Pack generated", "BashTool executed in sandbox"],
    "constraints": ["Default deny network", "Pointers-not-Paste"]
  },
  "environment": {
    "execution": { "kind": "sandbox", "id": "sandbox:<sessionId>", "backend": "auto" },
    "os": "<platform>",
    "runtime": { "node": "<version>" },
    "repo": { "root": "<projectRoot>", "worktree": "<worktreePath>", "commit": "<sha>", "dirty": false }
  },
  "claims": [
    {
      "id": "claim:tool:bash:1",
      "type": "execute",
      "statement": "Executed bash tool inside sandbox with policy tier=limited",
      "evidence": ["artifact:stdout:1", "artifact:stderr:1"],
      "verification": [],
      "confidence": 0.8
    }
  ],
  "artifacts": [
    { "id": "artifact:stdout:1", "kind": "command-output", "path": ".opencode/artifacts/<sessionId>/bash/stdout.txt", "sha256": "<sha256>" },
    { "id": "artifact:stderr:1", "kind": "command-output", "path": ".opencode/artifacts/<sessionId>/bash/stderr.txt", "sha256": "<sha256>" }
  ],
  "checks": [
    { "id": "check:bash:1", "command": "bash <command>", "status": "pass", "artifact": "artifact:stdout:1" }
  ],
  "events": [
    { "ts": "<iso8601>", "actor": "session:<sessionId>", "type": "permission", "summary": "PermissionNext allow bash run", "traceId": "<traceId>", "spanId": "<spanId>" },
    { "ts": "<iso8601>", "actor": "tool:bash", "type": "execute", "summary": "sandbox run", "traceId": "<traceId>", "spanId": "<spanId>" }
  ],
  "capsule": {
    "handoff": "Key facts + pointers only (<= N tokens)",
    "pointers": [".opencode/evidence/<sessionId>/manifest.json"],
    "openQuestions": []
  },
  "risks": [],
  "rollback": { "strategy": "git checkout <files> or revert patch", "steps": [] }
}
```

规范要点（保证“省 token + 高命中 + 可合并”）：
- `pack.json` 必须使用稳定序列化（canonical JSON：稳定键顺序、稳定数组排序规则、换行/缩进固定），避免前缀缓存失效。
- 所有 `artifacts[].path` 必须是项目内相对路径，且存在于 `manifest.json`；导出时仍需 allowlist 校验。
- **写入必须原子化**：artifact/pack/manifest 建议采用 `write tmp → sha256 校验 → rename → 更新 manifest` 的顺序；manifest 作为 SSOT，避免“半文件/断链”。
- **默认不跟随 symlink**：writer/export 阶段使用 `lstat`；遇到符号链接必须拒绝或显式 allow，并写入审计事件（避免路径逃逸）。

### Section 15.2 — manifest.json（L1 索引）最小示例（v1）

`manifest.json` 的职责是“完整性校验 + 可点击指针”。建议至少包含：

```json
{
  "specVersion": "evidence-manifest/1.0",
  "packId": "EP-2026-01-25-session-<sessionId>",
  "generatedAtUtc": "<iso8601>",
  "entries": [
    { "path": ".opencode/evidence/<sessionId>/pack.json", "sha256": "<sha256>", "kind": "evidence-pack" },
    { "path": ".opencode/evidence/<sessionId>/pack.md", "sha256": "<sha256>", "kind": "evidence-view" },
    { "path": ".opencode/artifacts/<sessionId>/bash/stdout.txt", "sha256": "<sha256>", "kind": "command-output" }
  ]
}
```

### Section 15.3 — pack.md（View）模板（v1）

人类可读视图必须“短小但可对账”，且坚持 Pointers-not-Paste：

```md
## Evidence Pack

### What Was Done (Claims)

- [claim:tool:bash:1] Executed bash tool inside sandbox (evidence: .opencode/artifacts/<sessionId>/bash/stdout.txt, .opencode/artifacts/<sessionId>/bash/stderr.txt)

### Proof Pointers (Artifacts)

- Manifest: .opencode/evidence/<sessionId>/manifest.json
- Key outputs:
  - .opencode/artifacts/<sessionId>/bash/stdout.txt

### Gates (Checks)

- check:bash:1 PASS

### Sandbox Trace

- execution: sandbox backend=auto session=<sessionId>
- network: deny_all (default)
- privileged actions: none

### Risks & Rollback

- risks: none recorded
- rollback: revert patch / discard workdir
```

### Section 15.4 — micro-pack → macro-pack 合并算法（明确冲突规则）

为避免“合并靠感觉”，合并必须是可复现算法（同样输入 → 同样输出），并把冲突显式化：

1) **输入集合**：`microPacks[]`（每个子 session 的 pack.json + manifest.json）。
2) **artifact 去重**：以 `sha256` 为主键去重；同 hash 允许多个 path（软链接/复制）但必须记录别名映射。
3) **claim 去重**：
   - 若有稳定 `claim.id`（推荐：`claim:<sessionId>:<seq>`）则按 id 去重；
   - 否则对 `type + statement + evidence(sorted)` 做内容哈希去重。
4) **冲突处理**：
   - 同一“目标文件/同一检查项”出现一正一负结论，必须生成 `risk` 或 `claim` 冲突条目，并在 `pack.md` 标红提示（可扫描）。
   - 冲突必须指向冲突证据（两个 artifact 路径 + sha256），并要求主代理/人类决策或触发复验（再跑 check）。
5) **输出**：macro-pack 写入主 session 的 `.opencode/evidence/<mainSessionId>/`，并在 `events` 中记录合并输入（micro packId 列表）与合并策略版本。

## Section 16 — 上下文工程（Deterministic Template + Token Budget + 可观测命中）

要复刻 GPT-5.x/Codex 这类系统“省 token + 高命中 + 长上下文”的体验，工程上必须做到：

1) **确定性模板**：system prompt、工具描述、上下文序列化顺序固定；避免在前缀注入时间戳/随机字段。
2) **预算驱动**：每次调用明确 token 预算；先放 Capsule 与关键指针，再放必要文件切片，最后才放低优先级历史。
3) **指纹缓存**：Context Pack 生成 hash（模板版本 + compaction 版本 + 文件内容哈希），用于复用与命中统计。
4) **层级压缩**：原文 → summary → capsule；压缩产物必须可追溯（manifest entry）以避免“摘要漂移”。
5) **命中可观测**：记录 cached_tokens（若模型侧提供）、本地命中（Context Pack/cache hit），并把指标写入 OTel 与 Evidence Pack。

注意：外部模型提供的 prompt caching（如 OpenAI 的 exact-prefix caching）可作为加速器，但你仍需要本地的
“确定性模板 + 指纹缓存 + 指针化输出”，否则很难稳定命中且无法审计。

### Section 16.1 — 除了“资料工作台”，还必须补齐哪些底层基础设施？

你提到的“沙盒里用 Python 处理资料 + 建目录管理输入”确实是关键一环，但它只是“超长上下文/低成本/低幻觉”的底座之一。
为了真正复刻 GPT-5.x/Codex 这类系统的工程优势，我们还需要把下面这些基础设施一起做齐（很多已经在本方案其它章节出现，这里做成清单，避免遗漏）：

1) **Router-first（先路由，再生成）**
   - 默认先并行跑 A/B/C worker 拿证据（LSP/KB/Graph），主代理只在证据齐备后输出最终答案/执行（见 Section 2.3）。
   - 价值：减少“拍脑袋回答”，降低幻觉；并行降低延迟。

2) **Tool-first + Schema-first（工具优先 + 结构化输出）**
   - 能用工具得到确定答案的，就不要让模型凭空猜；工具输出尽量 JSON 化并做 Zod 校验。
   - 价值：让系统更像“参谋部”，而不是“写作机器人”；也更利于缓存与去重。

3) **Context Ledger（上下文台账）+ Delta 注入**
   - 系统要记住“哪些文件片段/摘要/规则已经注入过模型”，下一轮只注入变化（patch、diff、增量摘要）。
   - 价值：极大降低重复 token；并且提升 prefix 缓存命中（前缀更稳定）。

4) **层级记忆：事实表（Facts）/胶囊（Capsule）/证据索引（Manifest）三件套**
   - Facts：结构化 key-value（例如“服务名/端口/依赖/决策”）
   - Capsule：短 handoff（给下一位 agent/下一轮调用）
   - Manifest：指针 + 哈希（可复验）
   - 价值：把“对话”变成“可复用的工程资产”，并天然支持多代理协作与 compaction。

5) **后台索引与预热（Prefetch/Warmup）**
   - LSP 索引、文件哈希、依赖图、KB embeddings、Graph edges 这些都不应该等用户提问才开始算。
   - 价值：交互速度更快；并行 worker 更像“即时响应”而不是“现算现等”。

6) **模型分层与温度策略（Tiering Policy）**
   - 轻量模型用于：抽取/压缩/分类/对账；重模型用于：关键决策/复杂改动/最终交付。
   - 结合低温度（抽取）与较高温度（创意）策略，避免把“创造性”带进事实抽取。

7) **自动验证闭环（Self-check via Gates）**
   - 对代码任务：tests/lint/typecheck/format；对资料任务：hash 校验/解析页数一致/引用可点开。
   - 价值：把“正确性”从主观变成客观门禁；Evidence Pack 固化验证过程（见 Section 18）。

8) **最小泄露与脱敏（Least Disclosure + Redaction）**
   - 不把敏感原文塞进 prompt；导出前脱敏；缓存隔离到租户边界。
   - 价值：这不是“锦上添花”，而是走向企业级/商用的硬前置（见 Section 12/17/20）。

9) **可观测性（OTel）+ 成本预算**
   - 把 token、缓存命中、worker 耗时、失败原因做成指标；否则“省 token/高命中”无法持续优化。
   - 价值：让系统能被迭代，而不是凭感觉调参（见 Section 8）。

10) **可恢复执行（Replayable）**
   - 关键步骤都能重放：同一 request + 同一 repo/kb snapshot + 同一脚本版本 → 产出可复现的 artifacts。
   - 价值：对你这种“高信任成本/低人工审计能力”的使用者，复现能力就是安全感来源。

这 10 条里，资料工作台对应的是 “Artifacts 化 + 指针化 + 派生结果缓存”；但要做到“无限接近低幻觉”，还必须把 Router-first、结构化输出与验证闭环一起做成默认行为。

### Section 16.2 — Context 计数器（用户可见）与“为什么会从 54% 掉到 10%”

你在 Codex 插件/ChatGPT UI 看到的“上下文使用量计数器”，以及“执行任务时占用从 54% 变成 10%-20%”的现象，
在工程上非常典型：**它往往不是模型突然变聪明，而是系统做了“调用级上下文重建 + 压缩/裁剪 + 指针化回填”**。

重要澄清（避免误解）：
- 一个“会话窗口”不等于“每次模型调用都把整个历史喂进去”。生产级系统都会为每次调用单独构建 Context Pack。
- 计数器通常反映的是“下一次模型调用实际注入的 tokens 占模型窗口比例”，而不是“历史累计 tokens”。

因此我们需要把计数器与 compaction 做成一等能力（并写入 Evidence Pack，避免黑箱）：

**(1) 调用级 Context Pack（可审计）**
- 每次模型调用前，Context Builder 生成 `context-pack.json`（artifact）并登记到 Evidence Pack：
  - system/tool 模板版本
  - 注入了哪些段（capsule / 文件切片 / 历史摘要 / 引用的 evidence pointers）
  - 每段 token 估算（可用 provider tokenizer 或近似估算）
  - 本次调用的 `budgetTokens` 与最终占比
- UI 计数器展示的百分比 = `contextPack.tokens / model.contextWindowMaxTokens`。

#### Section 16.2.1 — context-pack.json（v1）schema（计数器与可审计性的 SSOT）

为了让“计数器”和“压缩/裁剪”不变成黑箱，Context Pack 必须有稳定 schema，并作为 Evidence Pack 的 artifact 被索引。
建议 v1 最小字段如下（示例，最终以实现为准）：

```json
{
  "specVersion": "context-pack/1.0",
  "contextPackId": "<ulid>",
  "sessionId": "<sessionId>",
  "messageId": "<messageId>",
  "createdAtUtc": "<iso8601>",
  "model": {
    "providerId": "<provider>",
    "modelId": "<model>"
  },
  "window": {
    "maxTokens": 128000,
    "budgetTokens": 60000
  },
  "tokenEstimate": {
    "method": "provider|tiktoken|approx",
    "version": "v1"
  },
  "versions": {
    "systemTemplate": "v1",
    "toolsTemplate": "v1",
    "capsuleSchema": "v1",
    "stableJson": "v1"
  },
  "ledger": {
    "previousContextPackId": "<optional>",
    "mode": "full|delta",
    "notes": "<optional>"
  },
  "segments": [
    {
      "id": "seg:capsule",
      "kind": "capsule|system|tools|files|history_summary|routing_capsule|evidence_pointers",
      "priority": "p0|p1|p2",
      "tokenEstimate": 1234,
      "sources": [
        { "kind": "artifact|file|evidence", "ref": ".opencode/artifacts/.../x.json", "sha256": "<optional>" }
      ],
      "preview": "<short, optional>"
    }
  ],
  "totals": {
    "segments": 6,
    "tokenEstimate": 54321
  }
}
```

落盘路径建议（稳定，便于检索与缓存）：
- `.opencode/artifacts/<sessionId>/context/<contextPackId>/context-pack.json`

约束：
- `segments[]` 是“计数器”的直接来源：UI 展示“用了多少”必须能解释为“哪几段占了多少 token”。
- 每个 segment 都必须有可追溯来源（sources 指针），否则 compaction/裁剪后无法复盘“丢了什么信息/为何仍然可信”。

**(2) 自动 compaction（让占用“掉下来”的关键机制）**
- 当计数器超过阈值时，系统自动触发“压缩 worker”（可以是轻量模型，也可以是规则+模板）：
  - 输出：新的 Capsule（关键事实/决策/未决问题）+ 指针（manifest entries）
  - 旧的长历史不再直接注入 prompt，只保留可检索的指针与摘要
- 推荐阈值（可配置）：
  - `softThreshold = 0.60`：开始后台 compaction（不阻塞）
  - `hardThreshold = 0.80`：下一次调用前必须 compaction（阻塞式）
  - `emergencyThreshold = 0.92`：强制裁剪低优先级历史，只保留 Capsule + 必需文件切片

**(3) “一个会话里有多个子代理/自动切换”的合理解释（我们如何借鉴）**
- 你猜测的方向接近事实：很多系统会在同一 UI 会话下，内部并行/串行运行多个执行单元：
  - A/B/C worker（路由并行）各自有独立的“调用级上下文包”
  - 子会话 delegate_task 也有自己的上下文与证据（micro-pack）
- 主会话最终只合并“capsule + pointers”，所以主会话的下一次调用上下文会显著变小，计数器自然会从 54% 掉到 10%-20%。

**(4) 防幻觉的关键：计数器下降不能靠“删信息”，必须靠“资产化 + 可追溯”**
- compaction 不是删掉真相，而是把真相从 prompt 里搬到 artifacts 里，再通过 Manifest/sha256 指针可追溯地引用。
- 这也是 Evidence Pack 与资料工作台的价值：你不用看大段上下文，但永远能点回去验证。

这套机制会在单人阶段就显著改善体验（稳定、省钱、不容易跑偏），也为商用阶段提供可解释性与合规审计基础。

#### Section 16.2.2 — UI/CLI 的“非黑盒”展示：最小可解释时间线（默认安全，按需升级可见性）

你提出的“执行过程要不要展示一点，增加信任与掌控感”是非常关键的产品点：**生产级 agent 系统不能是黑盒**。
但你也说得对：商用场景不能把所有细节都展示给所有用户（可能暴露机密、提示词、内部策略、甚至形成攻击面）。

推荐把展示做成“分级可见”（同一套事件流，不同渲染策略）：

1) **默认视图（safe，面向所有用户）**：
   - 只展示阶段与结果：`routing(A/B/C)`、`context_pack`、`tool:bash/python`、`checks`、`export`
   - 展示可量化指标：耗时、缓存 hit/miss、context 预算占比（来自 `context-pack.json`）、产物数量
   - 展示可点击指针：Evidence Pack 的 `manifest.json` / 关键 artifacts（但不自动展开原文）

2) **开发者视图（verbose，本地自用）**：
   - 在用户显式开启时展示更多：执行的命令（可脱敏）、stdout/stderr 摘要、patch 预览、worker 的结构化输出详情
   - 仍然遵守脱敏与 allowlist（避免把密钥/个人信息直接打到终端滚屏）

3) **企业视图（audited，RBAC）**：
   - 默认仍是 safe；只有具备权限的审计角色才可展开“更细的证据”
   - 强制记录“谁看了什么证据”（access log 也进入 Evidence Pack/events 或单独的审计日志）

工程落地建议：
- UI/CLI 的时间线数据源应来自同一套 **events/provenance + trace spans**（见 Section 8/pack schema），避免 UI 侧自造状态导致不一致。
- 对用户来说，“可解释”不等于“展示所有文本”，而是：每个结论都有证据指针；每个阶段都能看到发生了什么、用了多少预算、命中了哪些缓存。

### Section 16.3 — 上下文工程手段库（Playbook）：把“大上下文”变成“可检索资产”，把“低幻觉”做成默认

你强调的这句话非常关键：我们追求的不是“把模型上下文窗口做得更大”，而是：
**在有限窗口里塞更相关、更可验证、更可复用的证据**。这正是“超长上下文体验”的工程本质。

下面按三类手段补齐与强化，尽量对齐 GPT-5.2/Codex 的可验证机制（不猜内部实现，只做可落地的工程化对齐）：

#### Section 16.3.1 — 检索/裁剪更智能：少塞、塞对、可缓存（Evidence-first Retrieval）

目标：把“全仓库/全文档/全历史”变成“可检索证据池”，再把“少量高价值证据”注入 `context-pack.json`。

1) **二阶段检索（召回 → 精排 → 预算裁剪）**
   - 召回（Recall）：优先用工具/索引拿到候选集合（快、可重复、低幻觉）：
     - 代码：`rg --json`（文本）、LSP（符号/引用）、文件树/依赖图
     - 文档：倒排索引（BM25/PGroonga）、向量召回（Qdrant/embeddings）
   - 精排（Rerank）：对候选做二次排序，减少“看起来相关但其实不相关”的噪声：
     - 轻量 reranker（优先）：规则 + 打分特征（路径、扩展名、近邻、最近修改、命中密度、引用次数）
     - 可选：轻量模型 rerank（只输出分数/理由，不输出长文本）
   - 预算裁剪（Budgeted Selection）：按 `context.window.budgetTokens` 选 topK 片段，并做稳定排序（防缓存抖动）。

2) **Query Rewrite（查询改写）作为“上下文工程”的第一道工序**
   - 机制：把用户自然语言先改写成更适合检索的 queries（关键词、实体、路径限定、同义词、语言/文件类型过滤）。
   - 落地形态：作为一个轻量 worker（或规则引擎）输出结构化结果：
     - `queries[]`、`filters`、`expectedKinds`（files/symbols/docs）
   - 关键：改写结果必须产物化并可缓存（否则“每次都改写不同”会破坏命中）。

3) **去重与近重复（Dedup / Near-Dedup）**
   - 为什么：重复片段会“浪费 token、污染注意力、降低命中率”，也会让模型产生“似是而非的综合幻觉”。
   - v1 可先做简单但高收益的规则：
     - **内容哈希去重**：chunk/content 的 `sha256` 相同直接去重。
     - **重叠去重**：同一文件相邻切片如果行区间重叠，合并或只保留覆盖面更好的一个。
   - v2 可选增强（不阻塞 PoC）：SimHash/MinHash 做近重复聚类，保留“代表切片”。
   - 去重过程也应写 Evidence Pack（`events: dedupe_applied` + 产出 `dedupe.report.json`）。

4) **“证据片段”默认指针化（pointers-not-paste）**
   - 召回阶段产生的长输出（全文件、长日志、长 PDF）默认只落盘，不直接进入 prompt。
   - 注入上下文的应该是：
     - `preview`（短摘要/短片段）
     - `sources[]`（artifact/file/evidence pointers + sha256）
   - 这与资料工作台（Section 13.2）一致：大对象变资产，小对象进上下文。

5) **稳定性要求：检索与裁剪必须“确定性”**
   - 同样输入（intent/repo/config 不变）应得到同样候选排序与同样注入片段（否则缓存/复盘都会崩）。
   - 工程要求：
     - 结构化输出（尽量 JSON）
     - 稳定排序（tie-breaker 固定，例如 `score desc, path asc, startLine asc`）
     - 避免浮点抖动（可把分数变为 `score_bps` 整数或固定小数位字符串）

建议产物（示意，便于审计与缓存）：
- `.opencode/artifacts/<sessionId>/retrieval/<id>/query-rewrite.json`
- `.opencode/artifacts/<sessionId>/retrieval/<id>/hits.json`
- `.opencode/artifacts/<sessionId>/retrieval/<id>/dedupe.report.json`

#### Section 16.3.2 — 压缩必须可控：分层摘要 + Ledger/Delta + 可追溯（Compression with Guarantees）

目标：让“上下文变小”不是靠删信息，而是把信息搬到 artifacts，并保持可追溯与可复用。

1) **分层记忆：Facts / Capsule / Manifest（不要用单一 summary 扛全部）**
   - Facts（结构化事实表）：用于“稳定不变的事实/配置/结论”，尽量结构化（key-value/列表）。
   - Capsule（handoff）：用于“下一步要做什么 + 关键证据指针 + 未决问题”。
   - Manifest（证据索引）：用于“所有事实都能点回去验证”（路径 + sha256）。
   - 规则：Facts/Capsule 都不得凭空新增事实；每条关键事实必须能引用 sources/pointers。

2) **Context Ledger（上下文台账）与 Delta 注入**
   - 机制：系统要记住“哪些段已经注入过模型”，下一轮只注入变化（diff/新增证据/新的 capsule）。
   - 落地形态：
     - `context-pack.json` 的 `ledger.previousContextPackId` + `ledger.mode=delta`
     - `segments[].sources[]` 与 `segments[].id` 形成可对账的台账
   - 价值：
     - 降 token（避免重复注入）
     - 提升 prefix cache 命中（前缀更稳定）
     - 复盘更清晰（知道这轮到底新增了什么）

3) **Compaction 的“输出契约”要收敛**
   - Compaction 不是写作文：它应输出固定结构（Capsule/Facts/指针），而不是长篇叙事。
   - 推荐把 compaction 输出也做成 artifact（例如 `capsule.md + facts.json`），并登记到 Evidence Pack。
   - 如果 compaction 发生冲突/不确定，允许明确输出 `unknown` / `openQuestions[]`，而不是硬编结论（低幻觉关键）。

4) **按需回填（Rehydration on demand）**
   - 当主代理需要更多细节时，不是“把所有历史拉回来”，而是：
     - 通过 pointers 精确回填对应 artifacts/snippets
     - 仍然受 `budgetTokens` 约束，必要时替换掉低优先级 segment
   - 这样可实现“看起来超长上下文”的体验：信息都在，但只有需要时才付 token 成本。

#### Section 16.3.3 — 抗提示注入 + 控制消耗：把“低幻觉”做成默认治理策略（Secure-by-default）

目标：让系统在面对“资料中的恶意指令/用户诱导/无限循环耗费”时，仍然稳定、可控、可审计。

1) **指令/数据隔离（Instruction-Data Separation）**
   - 原则：检索到的网页/文档/PDF/代码注释，默认都是“数据”，不能变成“系统指令”。
   - 落地：
     - 在 Context Pack 中把检索内容放入专门 segment（例如 `evidence_pointers`/`files`），并标注为 untrusted。
     - 系统模板明确：任何来自资料的“指令性文本”都必须忽略，只能作为证据阅读。

2) **Schema-first + Output Validation（让模型输出先过门禁）**
   - 任何计划写入 artifacts/触发工具/生成结构化结果的步骤，都必须：
     - 先输出结构化 JSON（或至少结构化片段）
     - 用 Zod parse 校验
   - parse 失败的默认处理应是：降级、要求补充证据、或触发复验（而不是“将错就错继续执行”）。

3) **证据引用强约束（Citation Required）**
   - 主代理的关键 claims 默认要求“有证据指针”：
     - 能引用就引用（manifest entry）
     - 不能引用则必须承认不确定，并触发 routing/检索补证据
   - 这是把幻觉成本从“输出阶段”前移到“取证阶段”的关键机制。

4) **消耗控制（Unbounded Consumption Guardrails）**
   - 预算层面：
     - token 预算（每次调用、每个 worker、每个 session）
     - 时间预算（workerTimeoutMs、maxWallClockMs）
     - 并发预算（maxWorkersInFlight、maxBackgroundWorkers）
   - 行为层面：
     - 工具输出上限（超阈值自动落盘，只回指针）
     - 复试/重试上限（避免无限重试）
     - 循环检测（同一意图 + 同一输入重复失败，触发“暂停 + 请求人工确认”）
   - 证据要求：每次触发预算/限流/熔断，都必须写 `events`，否则用户无法理解“为什么这次系统停了/降级了”。

5) **最小泄露与默认脱敏（对齐企业/商用）**
   - 终端/UI 默认展示 safe 摘要，不直接展示敏感原文（命令输出、diff、文档原文）。
   - 需要查看时通过 pointers 打开 artifacts（并可在企业模式下记录 access log）。

这三类手段的共同点是：它们都把“不可控的对话”变成“可验证的资产流”（artifacts + pointers + schema + events），
从而同时改善：上下文长度、成本、幻觉与可解释性。

### Section 16.4 — Prompt/Tools 的“前缀确定性”细节：把缓存命中做成工程纪律（对齐 Codex Harness 的可验证做法）

你在 Codex/GPT-5.x 体验里观察到“token 用量会突然从 50% 掉回 10%”，其背后的通用解释通常是：
系统没有把“完整对话历史”继续塞给模型，而是通过**按调用重建 Context Pack + compaction + 指针化产物**把有效上下文压缩为“短摘要 + 索引指针”。
要让这套机制同时做到“高缓存命中”，关键不是“更大上下文窗口”，而是**前缀确定性**。

结合 OpenAI 对 Codex Harness 的公开说明（prompt caching 依赖 exact prefix match），我们在实现上必须额外落以下纪律（否则 cacheKey 再漂亮也会被 prompt 前缀抖动毁掉）：

1) **把“调用前缀”拆成稳定 Block，并给每个 Block 单独 fingerprint**
   - 推荐的调用前缀顺序（必须固定，且写入 `context-pack.json` 作为 SSOT）：
     1) `permissions_instructions`（仅对 sandboxed shell/exec 工具生效；包含 sandbox_mode + approval_policy 概述）
     2) `developer_instructions`（来自全局配置/团队策略）
     3) `user_instructions`（AGENTS.md/目录级规则聚合后的最终结果）
     4) `toolset`（工具列表与 schema；见下一条）
     5) `environment_context`（cwd/worktree + runtime 信息）
     6) `capsule + pointers`（本轮任务证据摘要与指针）
   - 每个 block 都计算 `sha256(stableText/stableJson)` 并记入 context pack，这样你能解释“为什么这次 cache miss”（哪个 block 变了）。

2) **工具列表必须稳定排序（toolset determinism），并将“toolsetFingerprint”纳入 cacheKey**
   - prompt caching 对 tool 列表同样敏感：工具的顺序、描述文本的小变化、甚至 MCP 的动态变更，都可能导致前缀不一致。
   - 要求：
     - tool list 必须按稳定键排序（例如 `toolName asc`），禁止“发现顺序”决定最终顺序。
     - 对每个 tool 的 schema 做 canonicalization（stableJson），生成 `toolSchemaFingerprint`。
     - 汇总为 `toolsetFingerprint = sha256(stableJson({ tools: [{name, schemaHash, version}] }))`。
     - toolsetFingerprint 必须进入 `context-pack.json.totals.fingerprints`，并且进入本地 cacheKey 的 `configFingerprint`。
   - MCP 工具变更治理：
     - 任何 `tools/list_changed`（或等价事件）必须写入 events，并触发“本轮之后再生效”的 freeze 策略（避免 mid-turn cache 抖动）。
     - 企业/商用默认：MCP 工具集变更需要重新开始 session（或至少重新建 routingRun），避免隐式工具注入。

3) **当 sandbox/approval/cwd 变化时：更新对应 block，但不要让无关内容跟着抖**
   - sandbox_mode/approval_policy 变化，只应影响 `permissions_instructions` block；cwd 变化，只应影响 `environment_context` block。
   - 其它 block（AGENTS、toolset、capsule 模板）必须保持不变，否则每次目录切换都会把缓存全打碎。

4) **compaction 的输出必须“结构化 + 可追溯”，并且可作为下一轮 stable prefix 的一部分**
   - compaction 不是“让模型写一段更短的话”，而是产出：
     - `capsule.md`（按 Section 13.4 的 rg-friendly 格式）
     - `facts.json`（key-value SSOT）
     - `manifest pointers`（引用链）
   - 这些都要落盘并登记 sha256：未来“跨轮次记忆”优先引用这些产物，而不是重新把对话粘回去。

5) **把“动态噪声”从前缀移走：时间戳、traceId、随机 id 都应该出现在 events/manifest，而不是 system 前缀**
   - 这条看似细节，但决定了你能不能稳定拿到 prefix cache hit。
   - 规则：凡是不影响语义、仅用于观测/追踪的字段，都写入 `events.jsonl`；不要写进 system/developer instructions 的稳定段落。

以上规则的目的很朴素：让“缓存命中/超长上下文/低幻觉”变成可复现的工程结果，而不是靠模型大小与运气。

## Section 17 — 配置与治理（对齐 OpenCode 现有 Config 分层）

为避免把能力“写死在代码里”，所有关键策略必须可配置，并且遵循 OpenCode 现有配置加载机制：
远端 well-known（组织默认）→ 用户全局配置 → 自定义 config path → 项目配置 → `.opencode/opencode.json(c)` → 环境变量覆盖。
（见 `packages/opencode/src/config/config.ts` 的加载顺序）

### Section 17.1 — 借鉴 Codex：配置层叠（workspace/repo/home/system）与优先级（必须可对账）

Codex 的公开配置体系有两个对我们非常有价值的点：**配置层叠（stack）**与**可输出 effective config**。
这会直接决定你未来做团队协作/企业版时，能不能“可运维、可治理、可排障”。

对 OpenCode 现有加载机制的适配建议（优先复用现有 JSON/C config，不强制换格式）：

- **来源优先级（从高到低）**：
  1) CLI flags / 一次性覆盖（例如 `--sandbox`、`--approval-policy`）
  2) Profile（例如 `--profile dev|work|safe`，只覆盖差异项）
  3) 项目/工作区配置：`.opencode/opencode.json(c)`
  4) 目录向上查找的团队 defaults：`$CWD/.opencode/` → ... → `$REPO_ROOT/.opencode/`
  5) 用户全局：`~/.opencode/`
  6) 系统：`/etc/opencode/`（企业分发）
  7) 内置默认值

- **目录向上查找（Team Config 语义）**：
  - 当 cwd 在 repo/worktree 内时，从 `$CWD` 向上查找 `.opencode/`，直到 repo root。
  - 合并顺序建议：“离 cwd 越近优先级越高”，方便在子目录做局部覆盖（例如 `apps/mobile/.opencode/...`）。

- **必须提供“对账接口”**：
  - CLI：`opencode config show --effective`（示例）
  - 输出：最终值 + 每个字段来源（source path）+ policyVersion/policyHash

### Section 17.2 — 企业级治理钩子：requirements（不可覆盖）与 managed defaults（可覆盖但下次启动重置）

为了让未来商用/企业版可控，建议从第一天就预留两层治理钩子（即便 P0-P1 先不实现，也要把接口/语义定下来）：

- **requirements（强约束）**
  - 限制允许的 `approval_policy` 与 `sandbox_mode`（例如禁止 `never` 与 `danger-full-access`）。
  - 可选限制 `mcpServers` allowlist：按“工具身份”匹配（stdio server 按 command；http server 按 url），不匹配则禁用。
  - 任何不满足 requirements 的请求必须拒绝，并写入 `events: policy_rejected`（字段名 + 原因）。

- **managed defaults（企业默认值）**
  - 管理员设置启动默认值（例如默认 `workspace-write` + `on-request` + `network_access=false`）。
  - 用户可在运行时临时切换（例如安装依赖），但下次启动回到 managed defaults（企业可控性关键）。

### Section 17.3 — Feature flags + Maturity（避免 PoC/实验能力污染生产）

借鉴 Codex：把易变/高风险能力全部放进 feature flags，并标注成熟度（Experimental/Beta/Stable）。
对我们而言，最值得立刻纳入 feature flags 的包括：

- `exec_policy`：命令级 ExecPolicy（见 Section 13.1.1）
- `unified_exec`：统一 PTY-backed exec（更稳定 stdout/stderr 采集）
- `shell_snapshot`：对重复命令做环境快照（加速与复现）
- `undo`：每 turn 自动快照与回滚（降低误改风险）
- `remote_compaction`：可选远端 compaction（provider/部署支持时）
- `web_search_request`：允许模型发起 web search（仅在 `limited/full` 且审计开启时）

建议新增/扩展的配置项（示例命名，最终以 schema 为准）：
- `sandbox`：
  - `backend`: `auto|bwrap|nsjail|sandbox-exec|job-object|soft`
  - `network`: `plan:deny_all, limited:allowlist, full:configurable`
  - `allowedDomains[]` / `blockedCommands[]`
  - `localServicesAllowlist[]`: `[{ name, host, port, protocol }]`（用于 loopback/内网服务的显式白名单）
  - `planLocalServices`: true/false（默认 false；是否允许 plan tier 访问 allowlist 的本地服务）
  - `limits`: timeoutMs/cpu/memory/processes
  - `workdirMode`: `isolated|shared`（默认 isolated）
- `evidence`：
  - `enabled`: true/false（默认 true for PoC）
  - `paths`: evidenceDir/artifactsDir（默认 `.opencode/evidence`、`.opencode/artifacts`）
  - `redaction`: 脱敏规则（token/PII/secret patterns）
  - `retentionDays`：保留周期（默认本地 7-30 天）
- `context`：
  - `budgetTokens`：预算上限与分配比例（capsule/files/history）
  - `compaction`: auto/prune 策略（复用现有 compaction 配置并扩展 capsule）
  - `cache`: LRU/TTL/size caps（与现有 cache eviction spec 对齐）
- `routing`：
  - `enabled`: true/false（默认 true）
  - `maxRoutingRunsInFlight`: 1（默认 1；新输入取消旧输入）
  - `maxWorkersInFlight`: 3（默认 3）
  - `maxWallClockMs`: 15000（默认 15s）
  - `workerTimeoutMs`: 8000（默认 8s）
  - `topK`: 20（默认 20，可按 tier 降级到 10）
- `cacheStore`：
  - `backend`: `memory|disk|redis`（默认 `memory+disk`；P0-P2 不强依赖 redis）
  - `redisUrl`: 可选
  - `namespace`: 默认按 project/worktree；企业加 tenant/workspace 前缀
- `providers`（可选，按 adapter 支持）：
  - `promptCaching`: true/false（默认 true 但仅作为加速器）
  - `cacheHints`: provider-specific（例如 prompt_cache_key 等；不可作为正确性依赖）
 - `approvals`（建议显式分组，避免与 sandbox 混淆）：
   - `policy`: `untrusted|on-request|on-failure|never`（企业用 requirements 约束可选值）
   - `readOnlyMode`: `on|off`（也可通过 `/approvals` 动态切换）
 - `shellEnvironmentPolicy`：
   - `includeOnly[]`: 仅转发这些 env var（默认推荐 `PATH`、`HOME` 等最小集合）
   - `denyPatterns[]`: 禁止转发敏感 env（如 `*_TOKEN`、`*_KEY`）
 - `features`：
   - `execPolicy/unifiedExec/shellSnapshot/undo/remoteCompaction/webSearchRequest` 等 boolean 开关，并标注 maturity
 - `otel` / `telemetry`（企业强烈建议预留）：
   - `enabled`: true/false
   - `exporter`: `otlp-http|otlp-grpc|console`
   - `environment`: `dev|prod`
   - `logUserPrompt`: true/false（企业默认 false）

组织级策略（企业）建议由远端 well-known 下发默认值，并在 Evidence Pack 记录“策略版本/策略来源”。

## Section 18 — 验证门禁与回归策略（每阶段可验收）

为了保证 PoC 不会“看起来能跑但不可交付”，每个阶段都要绑定最小门禁：

- P0：BashTool 进入沙盒执行；生成 `.opencode/evidence/<sessionId>/...`；manifest 校验 sha256；失败也必须生成失败证据。
- P1：PythonTool 同上；并验证子 session 也走同一沙盒路径（micro-pack 存在且可合并）。
- P2：隔离 workdir 合并回主 workdir 后，必须跑一组门禁（至少 format/lint/test 任选其一），并把结果写入 checks。
- P3：在重复任务上观察上下文命中指标（本地指纹命中 + cached_tokens 若可用），并记录到 tracing/evidence（并落到 `.opencode/evidence` 的 events/claims）。

回归策略（上线安全）：
- 所有新能力必须有 feature flag（例如 `experimental.sandbox.enabled`、`experimental.evidence.enabled`）。
- 任何沙盒后端不可用时，必须可降级到 soft 模式并提示风险（而不是静默放开）。
- Evidence Pack 写入失败不得导致核心任务失败（可降级为只写 pack.md + 最小 manifest）。

### Section 18.1 — 最小 Evals（单人也能跑的“质量护栏”）

你强调“我不懂代码，但 Jarvis 必须自行保证质量”，因此除了 tests/lint 之外，还需要一套最小 eval，
专门覆盖 agent 系统最容易悄悄退化的地方（检索、引用、压缩、证据链）。

推荐 v1 Evals（P1-P3 都可逐步落地）：

1) **Routing 契约回归**（schema + stableJson）
   - 目标：`request.json` / `worker-*.result.json` 字段不漂移；stableJson 序列化结果稳定（hash 可复现）。
   - 失败信号：字段缺失/类型变化、排序规则变化导致 cacheKey 抖动。

2) **Citation 可点击性**（KB/RAG）
   - 目标：Worker B 的 citations 必须能定位到真实 chunk/file（存在、边界合法、hash 对得上）。
   - 失败信号：引用路径不存在、line 范围越界、contentHash 不一致（会导致“看起来引用了但实际不可复验”）。

3) **Compaction 不漂移**（Capsule/Manifest）
   - 目标：compaction 产出的 capsule 每条关键结论必须指向至少一个 manifest entry（pointers-not-paste）。
   - 失败信号：capsule 只有叙事没有证据指针（会导致幻觉与信任成本回升）。

4) **Evidence 断链检测**
   - 目标：routing/context-pack/tool 执行相关 artifacts 都必须出现在 manifest.json（含 sha256）。
   - 失败信号：UI 看得到结果，但 evidence 缺失/sha256 缺失（企业场景直接不可用）。

执行方式建议（不强绑具体实现）：
- `opencode debug eval`（示例命令）：跑一组固定的离线样本与合成任务，输出一份 Evidence Pack（eval 自己也要证据化）。
- eval 的输出应进入 `.opencode/evidence/<evalRunId>/...`，便于对比“上周/本周是否退化”。

## Section 19 — 运维与单人体验（“能长期用”的必要细节）

单人长期使用时，最常见的问题不是功能缺失，而是“状态目录膨胀、缓存污染、证据难找”。因此必须提供：

- 一键清理：`opencode evidence clean --older-than 30d`、`opencode cache clear`（示例）
- 一键导出：将 `.opencode/evidence/<sessionId>` 导出到仓库可提交目录，用于 PR/CI 归档
- 索引与检索：本地索引 evidence（按 sessionId/时间/claim 类型检索），避免用户手动翻目录
- 故障自救：当 compaction/缓存导致行为异常时，提供“禁用缓存/强制重建上下文包”的开关
- 通知钩子（可选但很实用）：当一个 turn 或长任务完成时运行 notify hook（脚本/系统通知），避免用户一直盯着终端

企业场景扩展：
- evidence 远端归档（对象存储）与保留策略（WORM 可选）
- 与 CI 门禁对齐：将 checks 输出映射为 CI artifacts，并在 policy-as-code 中验证

## Section 20 — 走向商用：多租户云端与移动端的“正确默认值”（不推翻本地能力）

你问的多租户问题非常关键，因为它会直接影响我们现在“沙盒/上下文/缓存/证据”的设计是否能平滑演进到商用。
这里给出一个偏行业最佳实践、且对你当前阶段（独立开发者自用）友好的决策框架：

### 20.1 先定大方向：云端做“控制面”，本地/云端做“数据面 + 执行面”

OpenCode/oh-my-opencode 的天然优势是：能在你的电脑上读写文件、跑测试、改代码。这在移动端天然不存在。
因此商用形态通常不是“把一切搬到云端就结束”，而是分两类能力：

- **控制面（Cloud Control Plane）**：账号/计费/策略下发/审计索引/远端归档/模型网关
- **执行面（Execution Plane）**：
  - 本地执行面（Local Runtime）：用户电脑上的 OpenCode Runtime（能访问本地文件）
  - 云端执行面（Cloud Sandbox）：云端容器/沙盒（只能访问用户上传的资料与云端数据）
- **大脑/检索面（Brain Plane）**：Chelingxi-OS 的 PG/Qdrant/Graph 等知识底座（可本地可云端，取决于场景）

这三者通过统一协议耦合：
- 工具协议（MCP/HTTP）用于“能力暴露给任意 agent”
- Evidence Pack 用于“可验证交付 + 可审计复盘”（本地与云端通用）

### 20.2 多租户存储：不是“每个租户一套 PG+向量+图数据库”才算最佳实践

“每租户一套数据库”是最隔离、最简单理解的方案，但通常只在以下情况下是最佳实践：
- 企业级高价客户（强隔离/合规/自带运维要求）
- 需要数据驻留/主权（某些行业或地区）

对大多数 SaaS 的早中期，**更常见的最佳实践是“池化（pool）为默认，隔离（silo）为可选”**：

- **Postgres（事实/交易/元数据）**
  - 默认：共享集群 + `tenant_id/workspace_id` 分区 + RLS（你现在 chelingxi-os 走的方向就很契合）
  - 可选：对高价租户提供“独立 schema / 独立 database / 独立 cluster”
  - 成本可控点：分区、冷热数据分层、按租户配额（行数/存储/IO）

- **向量数据库（Qdrant，语义记忆）**
  - 默认：共享 Qdrant 集群；每租户独立 collection 或在 payload 中强制 `tenant_id` 过滤
  - 成本可控点：向量维度、索引策略、分片/副本数、按租户上限（points/bytes）

- **图数据库（Neo4j，关系推理）**
  - 图通常是“最贵/最难做多租户”的一层（资源消耗与隔离复杂）。
  - 推荐策略：**P1/P2 阶段把图当成“可选加速器”，不要把它变成多租户的硬前置**：
    - 默认：先把边（imports/links/relations）作为结构化事实存 PG（或对象存储），需要时再异步构建/投影到图引擎
    - 企业可选：Neo4j（独立实例/独立数据库）作为高级功能
  - 这能把成本与复杂度控制在你可承受范围内，同时不牺牲路线的上限。

一句话：**先跑通“共享池化 + 严格隔离”，再为高价值客户提供“独立 silo”**，这是最稳的商用演进路径。

### 20.3 移动端为什么“无法像本地一样改文件”，以及怎么解决

移动端的限制不是 UI，而是“执行面不在本地文件系统旁边”。要保留 OpenCode 的核心能力，有两种商用形态：

1) **Hybrid（推荐默认）**：用户电脑跑一个 Local Runtime（OpenCode server/daemon），手机/云端只是控制它
   - 优点：保留“增删改查本地文件”的能力；对开发者/律师/个人助手都很关键
   - 风险：需要安全通道（端到端加密、设备绑定、策略下发、审计）
   - Evidence Pack 很关键：每次远程执行必须产证据，便于用户信任与复盘

2) **Cloud-only（补充场景）**：所有执行都在云端沙盒
   - 优点：用户不需要开电脑；移动端体验最好
   - 限制：只能处理“用户上传的资料/云端数据”，不能直接改本地项目
   - 适合：个人助理/资料分析/法律文档处理/商业分析等“资料驱动型”任务

对你现在的路线而言：第一阶段你自用，天然是 Hybrid；第二阶段商用，建议 Hybrid 作为默认能力，
再补 Cloud-only 作为覆盖移动端的扩展能力。两者共享同一套 Evidence Pack、策略、缓存与可观测性。

## Section 21 — 设计评审：风险清单与补强计划（按风险排序，避免“越迭代越乱”）

这部分把“当前设计/落地最容易踩坑的地方”显式写出来，并给出补强动作与验收标准。目标不是追求完美，
而是保证：你作为单人开发者也能把系统长期维护下去，并且为未来企业级/商用留足上限。

### 21.1 严重风险（必须优先补强）

1) **运行时尚未“强制协议门禁”（schema 已有，但还没变成写入/读取的硬约束）**
   - 风险：artifact 一旦在代码里被“随手改字段”，缓存 key 会难命中、UI/审计解析会崩、插件/核心会漂移。
   - 补强：
     - 引入统一的 `ProtocolArtifactWriter/Reader`（或等价模块）：写入前 `schema.parse()`，读取后同样 parse。
     - 一旦 parse 失败：必须写 `events: protocol.violation`，并产出“失败 artifact”（包含错误摘要与指针），保证 Evidence Pack 不断链。
   - 阶段建议：P0-P1 就做（这是后续一切的地基）。
   - 验收：任意 routing/context-pack/worker-result artifact 的 unknown key 或缺字段都会导致门禁失败（可通过契约测试复现）。

2) **事件流（events.jsonl）还没做成强约束协议**
   - 风险：时间线语义漂移会导致 UI 变成“猜测状态机”；审计/复盘会缺关键信号；商用后难以合规。
   - 补强：
     - 明确 `event/1.0` envelope（见 Section 8.1），并为关键 event type 定义子 schema（至少 routing/context/tool/permission/cache）。
     - events 默认“可展示、安全脱敏”，敏感内容一律外置为 artifacts（只在 events 里记录引用）。
     - 对 events 同样做 contract tests：保证字段不漂移、unknown key 不被静默接受。
   - 阶段建议：P0-P1。
   - 验收：CLI/UI 时间线仅依赖 events.jsonl + trace spans 渲染；不存在 UI 侧私有状态与“猜测补全”。

### 21.2 高风险（影响体验与商用安全，需要明确默认值）

3) **透明度 vs 安全：默认展示策略如果不设计，会导致未来商用“被迫回滚体验”**
   - 风险：本地自用时喜欢 verbose，但商用时 verbose 会泄露敏感信息（命令、路径、提示词、客户数据），也会扩大攻击面。
   - 补强：
     - 默认 `safe` 时间线（阶段/预算/命中/证据指针），显式开启才进入 `verbose`（见 Section 16.2.2）。
     - 企业模式增加 RBAC：只有审计角色可展开“深证据”，并记录“谁查看了什么”（access log）。
     - 脱敏策略版本化：Evidence Pack 记录 `redactionPolicyVersion`，避免“同一产物在不同版本脱敏规则下含义不一致”。
   - 阶段建议：P0 就设定默认；P3-P4 才做企业 RBAC。
   - 验收：在默认模式下，终端滚屏与 UI 不出现敏感原文；证据通过指针可追溯；导出前必经脱敏与 allowlist 校验。

4) **前缀/模板确定性（prefix determinism）很容易被无意破坏，直接影响命中与成本**
   - 风险：把时间戳/traceId/随机 id 写进 system 前缀，或非确定性序列化（浮点、对象 key 顺序）都会导致“看起来一样但缓存永远不命中”。
   - 补强：
     - stableJson 明确对齐 RFC 8785（JCS）或实现一套严格等价规则，并把 stableJson 版本写入 artifacts（见 Section 2.3.5/16.2）。
     - 模板分段：`prefix (stable)` + `dynamic suffix`；动态字段强制只出现在尾部或 events。
     - 增加回归测试：同样输入必须生成同样的 `context-pack.json` 前缀哈希与 cacheKey；变更必须 bump 版本。
   - 阶段建议：P1-P3。
   - 验收：重复任务能稳定命中；cache miss 可解释（repo/config/intent 变化），而不是“莫名其妙”。

### 21.3 中低风险（不阻塞 PoC，但要把接口/边界定好）

5) **缓存指标口径与 provider 差异：如果不统一，会被“厂商字段”带偏**
   - 风险：只看某个 provider 的 cached_tokens 可能误判系统是否真的省 token；也会让多 provider 支持变得混乱。
   - 补强：
     - 本地缓存为 SSOT：记录 routing/context-pack/tool 的本地命中；provider 缓存作为附加指标（见 Section 3.2）。
     - provider adapter 统一输出 “usage + cacheHints + cachedTokens(可选)” 的归一化结构。
   - 阶段建议：P1-P3。
   - 验收：无论换哪个模型厂商，本地命中/成本指标口径一致，能长期优化。

6) **协议模块的导出/组织形式（barrel export）属于维护性增强**
   - 风险：影响主要是可维护性（import 路径分散），不是核心正确性。
   - 补强：当 protocol 被多处引用时，再添加 `src/protocol/index.ts` 做集中导出即可。
   - 阶段建议：P2+（按需）。
   - 验收：不影响 PoC 闭环；后续引用点多了再统一。

## Section 22 — Open Questions（明确未定项，避免“设计假完成”）

下面这些点不影响 PoC v1 的闭环，但会影响后续生产/企业级落地，建议在 P2-P4 阶段逐项定案：

1) **跨平台沙盒后端选型与一致语义**：Linux(bwrap/nsjail)、macOS(sandbox-exec)、Windows(Job Object/Container) 的能力差异如何抽象。
2) **Python 运行时与依赖供应链**：是否要内置 Python runtime；若允许联网拉依赖，企业代理与 SBOM/签名如何记录。
3) **Evidence Pack 的“访问控制”**：本地/远端归档时如何分级（公开/内部/机密）、加密与脱敏策略版本化。
4) **缓存与隐私**：prompt/prefix caching 的租户边界、缓存命中统计的泄露风险与默认关闭策略（企业默认更严格）。
5) **并行写入的最终一致性**：shared workdir 下的锁策略与用户体验（排队、合并冲突的交互方式）。

## Section 23 — 外部参考

- OpenAI Codex（开源仓库：CLI harness / execpolicy / AGENTS.md / TUI 设计等）
  - https://github.com/openai/codex
- OpenAI Engineering：Unrolling the Codex agent loop（缓存命中、context window、tools 顺序、compaction 等关键工程点）
  - https://openai.com/index/unrolling-the-codex-agent-loop/
- OpenAI Developers：Codex Security（sandbox mode + approval policy、requirements/managed config、MCP allowlist 等企业治理点）
  - https://developers.openai.com/codex/security/
- OpenAI Developers：Codex Config basics（配置层叠/优先级、profiles、feature flags/maturity）
  - https://developers.openai.com/codex/config-basic
- codex-execpolicy（prefix-rule + match/not_match 规则自带测试用例；policy-as-code 的可借鉴实现）
  - https://github.com/openai/codex/blob/main/codex-rs/execpolicy/README.md
- Codex CLI SandboxPermission（社区讨论摘录的权限枚举：磁盘读写范围、网络等；适合作为 capability 语义层）
  - https://github.com/openai/codex/discussions/1174
- BentoML LLM Inference Handbook: Prefix caching（解释“共享前缀可跳过计算”“必须完全一致”“确定性序列化”等实践）
  - https://bentoml.com/llm/inference-optimization/prefix-caching
- OpenAI API: Prompt caching（exact prefix match、cached_tokens、24h retention 等）
  - https://platform.openai.com/docs/guides/prompt-caching
- RFC 8785: JSON Canonicalization Scheme（JCS，用于“同样输入 -> 同样序列化 -> 同样 hash”的确定性基础）
  - https://www.rfc-editor.org/rfc/rfc8785
- vLLM 设计文档：Automatic Prefix Caching（实现视角：KV cache / block 管理与 LRU eviction）
  - https://docs.vllm.ai/en/latest/design/prefix_caching/
- SLSA 规范：Provenance（“可验证信息”用于追溯产物来源，支撑企业级审计与供应链治理）
  - https://slsa.dev/provenance
- SLSA Blog：in-toto and SLSA（in-toto Statement/Predicate/Subject 模型，attestation bundle 可用于端到端验证）
  - https://slsa.dev/blog/2023/05/in-toto-and-slsa
- OpenTelemetry Blog：AI Agent Observability（标准化语义约定与可观测性最佳实践，适配 agent/event/tool tracing）
  - https://opentelemetry.io/blog/2025/ai-agent-observability/
- OpenTelemetry Semantic Conventions：Generative AI（GenAI spans/metrics/events 的字段口径，建议对齐）
  - https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/
  - https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-metrics/
- ReAct 论文（Reasoning + Acting 交错，结合外部工具/环境降低幻觉并提升可解释性）
  - https://arxiv.org/abs/2210.03629
- Stanford CS191W 项目：Timing Attacks on Prompt Caching（提示跨租户缓存可能带来侧信道风险）
  - https://cs191.stanford.edu/projects/Gu,%20Chenchen_CS191W.pdf
- oh-my-opencode Orchestration Guide（planning/execution 分离、delegate_task、后台并行任务等工程化编排）
  - https://github.com/code-yeongyu/oh-my-opencode/blob/master/docs/orchestration-guide.md
- ripgrep（rg，快速文本检索；支持 `--json` 输出便于结构化证据化）
  - https://github.com/BurntSushi/ripgrep
- ast-grep（AST 结构化搜索/替换，适合做“低幻觉的批量重构”）
  - https://github.com/ast-grep/ast-grep
- comby（结构化模式替换，语言无关但比 regex 更可控）
  - https://comby.dev/
- Semgrep（静态扫描/规则化检查，可作为“自动验证闭环”的补充）
  - https://semgrep.dev/docs/
- Poppler（PDF 工具链：pdftotext/pdfinfo 等，适合资料工作台的稳定提取）
  - https://poppler.freedesktop.org/
- pdfplumber（Python PDF 解析库，适合更细粒度结构提取）
  - https://github.com/jsvine/pdfplumber
- Tesseract OCR（本地 OCR 引擎；企业场景需结合脱敏与策略审批）
  - https://github.com/tesseract-ocr/tesseract
- Pandoc（文档转换工具，适合资料工作台做派生链）
  - https://pandoc.org/
- OWASP Top 10 for LLM Applications 2025（提示注入/敏感信息/无界消耗等风险的权威清单，适合作为企业级治理对齐基线）
  - https://owasp.org/www-project-top-10-for-large-language-model-applications/assets/PDF/OWASP-Top-10-for-LLMs-v2025.pdf
- OWASP GenAI：LLM01 Prompt Injection（间接提示注入与缓解思路，适合对齐 Section 12/16.3.3）
  - https://genai.owasp.org/llmrisk/llm01-prompt-injection/
- bubblewrap（Linux 无特权沙盒常用实现）
  - https://github.com/containers/bubblewrap
- nsjail（Linux namespace/seccomp/cgroups 进程隔离）
  - https://github.com/google/nsjail
- Windows Job Objects（Windows 进程树与资源限制的基础设施）
  - https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects
- Bazel Hermeticity（hermetic build 的定义与收益：隔离、可缓存、可复现；与沙盒/证据链理念一致）
  - https://bazel.build/basics/hermeticity
