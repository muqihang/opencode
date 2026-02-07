# Single‑Session Orchestration Implementation Plan（执行计划 v0.1）
> **For Codex/Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task（并在实现前用 `superpowers:using-git-worktrees` 创建隔离 worktree）。
>
> **Design SSOT**：`docs/plans/2026-02-03-single-session-orchestration-design.md`

**Goal（一句话）**：把“单会话内主 LLM + 后台小脑 + Tool Broker + SSOT 证据链”的编排做成可落地、可回放、可回归、可渐进启用的工程能力；需要动手（写文件/跑测试/高风险）时自动升级为 `fork`，派发子会话执行。

**Architecture（落地路径）**：
- **控制平面**：每轮先生成 `orchestrator.plan.json`（SSOT）→ 事件化 `orchestrator.planned`
- **数据平面**：按 plan 运行 deterministic modules（Routing/Retrieval/Verification）→ 产出 pointers/manifest
- **后台小脑**：Internal Worker Runner（`generateObject/streamObject + schema + CacheStore + EvidenceWriter + verifier`），worker 不直接用工具，只能产出 `toolRequests[]/queries[]`
- **Tool Broker**：非交互、白名单、预算、`bounceMax=1`；把 broker 调用产物 pointerize 进入 SSOT（交互输出不变）
- **外层派工**：需要写/执行时 `orchestratorMode=fork` → 走 `tool:task`/子会话（隔离与审计）

**Tech Stack**：Bun、TypeScript、Zod、现有 Evidence Pack（`EvidenceWriter` + manifest/events）、CacheStore、Routing/Retrieval/Verification runners。

---

## 0) Inputs（必须阅读对齐）

- 设计稿（SSOT）：`docs/plans/2026-02-03-single-session-orchestration-design.md`
- 关键现状代码（本计划会触达/复用）：
  - `packages/opencode/src/session/llm.ts`（注意：`LLM.stream` 内含隐式 `runRetrieval()`）
  - `packages/opencode/src/session/processor.ts`（secure-output gate 当前只对 build agent 且固定 `balanced`）
  - `packages/opencode/src/retrieval/runner.ts`（RetrievalRunner + evidencePointers）
  - `packages/opencode/src/verification/index.ts`（Verification cache + report/view）
  - `packages/opencode/src/session/capsule-assisted.ts`（可复用的“schema-first + cache + verifier + degraded”范式）
  - `packages/opencode/src/tool/task.ts`（子会话派工与 micro-pack 合并）

---

## 0.5) Hard Constraints（实施时不得破坏）

> 这些是设计稿已定案的“世界级约束”；任何实现捷径若违反它们，最终会把系统打回“不可控”。

- **Worker 不走 `LLM.stream()`**：必须用 Internal Worker Runner（`generateObject/streamObject + schema`），避免触发 `LLM.stream` 的隐式 `runRetrieval()` 等副作用。
- **Worker 不直接执行工具**：worker 只能产出 `toolRequests[]/queries[]`，执行由 Tool Broker 统一做（non-interactive + pointerize）。
- **Tool Broker 必须 non-interactive**：worker 发起的请求不得触发任何 `ask()`；不满足白名单/预算/权限 → `rejected` 并事件化。
- **`bounceMax=1`（硬约束）**：worker↔Tool Broker 最多一次回填，禁止“循环检索→循环改写→循环检索”。
- **`orchestratorMode=chat` 必须 0 worker**：闲聊/轻任务绝不能被“偷偷增强”拖慢或增加成本。
- **`orchestratorMode=fork` 必须下沉到子会话执行**：父会话只做计划与验收；写入/执行/高风险操作只在 `tool:task` 子会话完成（隔离+审计）。
- **SSOT：工具输出/中间产物必须 pointerize**：orchestrator/Tool Broker 流程只回填 `{pointers, summary}`，大内容一律落 artifacts/manifest。
- **`mainTools` 语义必须保留三态**：`null/缺省`=不覆写；`[]`=强制无工具；`["read",...]`=allowlist（且永远不额外增权）。
- **概念不串台**：这里的 `orchestratorPlan/orchestratorMode` 是“控制平面工作单”，不是用户可见的“Plan agent”（不要和 `OPENCODE_EXPERIMENTAL_PLAN_MODE` 的用户体验混在一起）。
- **fork 派工策略必须可配置**：引入 `forkStrategy=auto|suggest|off`（先用 env/flag 承载），用于兼容上层多智能体插件（例如 `oh-my-opencode`）并避免“双重派工”；默认 `auto`，插件接管派工时切到 `suggest`。

---

## 1) Worktree / 基线（必须）

### 1.1 创建隔离 worktree（建议）

> Upstream 默认分支是 `dev`（repo 约定），但本项目研发主线以 `feature/opencode-custom` 为基线（以仓库当前协作约定为准）。

```bash
git fetch origin
git worktree add .worktrees/p4-single-session-orchestrator feature/opencode-custom
cd .worktrees/p4-single-session-orchestrator
git checkout -b p4-single-session-orchestrator
```

### 1.2 基线命令（修改前后都要跑）

```bash
cd packages/opencode && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test
```

若本计划包含 UI/CLI 开关（可选：把 `Fast/Auto/Deep` 做到 app/cli），再加：
```bash
cd packages/app && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun run typecheck
cd packages/app && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test src
```

---

## 1.3) 并行执行建议（多代理拆分与合流顺序）

> 原则：**先把共享协议/开关打底，再并行做“互不改同一文件”的工作流**。避免多人同时改 `session/processor.ts`、`cache/policy.ts` 这类高冲突文件。

### 推荐拆成 6 个代理（可在 6 个 worktree 并行）

1) **Agent A（Foundation）**：Milestone 0（flags + protocols + contract tests）
   - 高复用、高依赖，必须先完成并合入主 worktree，再开并行。

2) **Agent B（Plan）**：Milestone 1 Task 1.1 + 1.2（features + stage0 plan + cache namespace/ttl）
   - 会改 `packages/opencode/src/cache/policy.ts`，建议只让一个代理负责该文件，避免冲突。

3) **Agent C（Evidence）**：Milestone 1 Task 1.3 + 1.4（plan/features artifacts + export 不断链）
   - 主要改 `packages/opencode/src/evidence/*` 与新增 orchestrator writer 文件，冲突较少。

4) **Agent D（Broker）**：Milestone 3（Tool Broker v0 + tests）
   - 只读 allowlist 从 retrieval/verification 起步，避免碰 tool 层交互 ask。

5) **Agent E（Workers）**：Milestone 4（worker runner + evidence_critic + tests）
   - 不改 `cache/policy.ts`（由 Agent B 统一处理）；只改 orchestrator 目录与 tests。

6) **Agent F（Integration）**：Milestone 2 + 5 + 6 + 7（接入 SessionProcessor / turn runner / mainTools gating / fork 升级 / secure-output 联动）
   - 这是“高冲突核心文件”工作流（`packages/opencode/src/session/processor.ts` / 可能 `prompt.ts`），务必单线程做。

### 可选并行（建议等核心联通后再开）

- **Agent G（Tooling）**：Milestone 8（`grep` pointers 输出 + tests）
- **Agent H（Eval）**：Milestone 9（offline eval 扩展 + tests）

### 合流顺序（推荐）

1) Agent A 合入（协议/开关打底）
2) Agent B/C/D/E 并行 → 逐个合入（先 B 再 C/D/E 更省冲突）
3) Agent F 最后合入（集成改动集中）
4) 可选：G/H 并行 → 合入
5) 最终：跑 `packages/opencode` 全量测试 +（如涉及 app）typecheck/test

---

## 2) Milestones（按“可回滚 + 可渐进启用”拆分）

> 约束：默认行为不变（flag off 时不影响聊天体验、不新增额外模型调用、不改变 tools 面板）。

### Milestone 0：开关与协议骨架（0 风险可先合入）

**目标**：先把“可观测/可回放”的协议与落盘路径补齐，先不改主流程行为。

#### Task 0.1：新增 feature flags（只影响实验路径）

**Files:**
- Modify: `packages/opencode/src/flag/flag.ts`
- (可选) Modify: `packages/opencode/src/config/config.ts`（增加 `config.experimental.orchestrator` 配置入口）

**Steps:**
1) 加 env flag（建议命名）：
   - `OPENCODE_EXPERIMENTAL_ORCHESTRATOR=1`（总开关）
   - `OPENCODE_ORCHESTRATOR_UX_MODE=fast|auto|deep`（会话级偏好；默认 `auto`）
2) 如果加 config：在 `Config.Info` 的 `experimental` 下新增：
   - `orchestrator?: { enabled?: boolean; uxMode?: "fast"|"auto"|"deep" }`
3) 测试：新增轻量 unit test 校验 flag 读取（可选，非必须）。

**Commit message:** `feat(orchestrator): add experimental flags`

#### Task 0.2：协议（Zod schema-first）+ contract test

**Files:**
- Create: `packages/opencode/src/protocol/orchestrator-plan.ts`
- Create: `packages/opencode/src/protocol/orchestrator-features.ts`
- Create: `packages/opencode/src/protocol/llm-worker-role-pack.ts`
- Create: `packages/opencode/src/protocol/llm-worker-result.ts`
- Create: `packages/opencode/src/protocol/tool-broker.ts`
- Modify: `packages/opencode/test/protocol/protocol-contract.test.ts`

**Protocol guidelines（和仓库既有风格一致）**：
- `specVersion` 必须固定 literal（例如 `orchestrator-plan/1.0`）
- `.strict()` 为默认（不接受模型“发挥”字段）
- 所有 enum 字段必须 z.enum / z.literal union

**最小 schema（建议直接按设计稿定案字段）**：
- `orchestrator-plan/1.0`：
  - `orchestratorPlanId`（ulid）
  - `sessionId`, `messageId`
  - `orchestratorMode: "chat"|"assist"|"heavy"|"fork"`
  - `uxMode: "fast"|"auto"|"deep"`
  - `mainTools?: null | string[]`
  - `workers: Array<{ id: string; model: "small"; budget: { timeoutMs: number } }>`
  - `budgets: { maxWallClockMs: number; workerTimeoutMs: number; maxOutputTokens: number; maxToolCalls: number }`
  - `evidencePolicy?: { enabled: boolean; mode: "strict"|"balanced"|"loose" }`
  - `toolPolicy: { allowed: string[]; bounceMax: 1 }`
  - `reasons: Array<{ code: string; message: string }>`
  - `inputsFingerprint: { sha256: string }`
- `orchestrator-features/1.0`：只放 deterministic features（bool/score/ids），不要塞长文本
- `llm-worker-role-pack/1.0`：planPointer + policy + budget + workingSet.pointers[]
- `llm-worker-result/1.0`：`status` + `toolRequests[]` + `notes[]`（严格限长）
- `tool-broker/1.0`：`toolRequests[]`（只允许 `retrieval` / `verification` 起步）

**Step 1: contract test 先 fail**
- 在 `protocol-contract.test.ts` 里按现有模式新增 3–5 个 fixture：
  - fixture 解析成功
  - fixture 加 `extra: "nope"` 后必须 throw（验证 `.strict()` 生效）

**Step 2: 实现 schema + 让 contract test 过**

**Run:**
```bash
cd packages/opencode && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test test/protocol/protocol-contract.test.ts
```

**Commit message:** `feat(orchestrator): add protocols (plan/features/worker/tool-broker)`

---

### Milestone 1：Deterministic Plan（Stage 0）落盘（先不影响 LLM.stream）

**目标**：每轮都能产出 `orchestrator.features.json` + `orchestrator.plan.json`，并写入 events；但暂不改变工具集、不派 worker、不触发 Tool Broker。

#### Task 1.1：Feature Extractor（确定性）

**Files:**
- Create: `packages/opencode/src/session/orchestrator/features.ts`
- Test: `packages/opencode/test/session/orchestrator-features.test.ts`

**实现要点（来自设计稿 §4/§11，必须 deterministic）**：
- `intentText`：复用 `LLM.stream` 里提取 user 文本的逻辑（或提炼成共享 helper）
- features（最小集）：
  - `hasWriteIntent`（edit/write/apply_patch/修改文件/commit 等强信号）
  - `hasExecIntent`（bash/python/run/test/install 等强信号）
  - `hasVerificationIntent`（引用/证据/核验/对账/合规）
  - `isShortChat`（字数阈值）
  - `riskScore`（0..1 简单分段即可）

**Test cases（避免 mocks，纯字符串判定即可）**：
- “请解释这个函数” → `hasWriteIntent=false`
- “帮我改一下 xxx.ts 并跑测试” → `hasWriteIntent=true` & `hasExecIntent=true`
- “请给引用/证据” → `hasVerificationIntent=true`

**Run:**
```bash
cd packages/opencode && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test test/session/orchestrator-features.test.ts
```

**Commit message:** `feat(orchestrator): deterministic feature extractor`

#### Task 1.2：Plan Builder（Stage 0，确定性 + 可缓存）

**Files:**
- Create: `packages/opencode/src/session/orchestrator/plan.ts`
- Modify: `packages/opencode/src/cache/policy.ts`（新增 cache namespace + ttl）
- Test: `packages/opencode/test/session/orchestrator-plan.test.ts`

**规则（按设计稿定案）**：
- `uxMode=fast`：尽量 `chat`；除非 `hasWriteIntent/hasExecIntent` → `fork`
- `uxMode=deep`：更偏向 `assist/heavy`，并默认开启 `evidencePolicy`
- `hasWriteIntent || hasExecIntent`：直接 `orchestratorMode=fork`
- `hasVerificationIntent`：至少 `assist`（heavy 取决于任务长度/复杂度）
- `chat`：`workers=[]`、`mainTools:null`、`evidencePolicy` 默认不额外启用
- `assist/heavy`：最多 2 workers；`toolPolicy.bounceMax=1`

**Plan cache（必须）**：
- key payload 必须包含：`sessionId/messageId/workspaceFingerprint/toolsetFingerprint/uxMode/evidencePolicy`
- 存储：复用 `CacheStore`（namespace: `orchestrator-plan`）
- `CachePolicy` 必须支持新 namespace（否则类型/ttl 会卡住）：
  - `type Namespace` 增加：`"orchestrator-plan"`
  - `ttlMs("orchestrator-plan")`：建议 10–30 分钟
  - `policy("orchestrator-plan")`：跟随 `storeEnabled`

**fingerprint 来源（避免“算错 hash 导致 cache 抖动”）**：
- `toolsetFingerprint`：建议复用 `packages/opencode/src/session/context-blocks.ts` 的生成逻辑：
  - tools 先按 `name` 排序
  - fingerprint 输入包含 `{name, description, schema}`
- `workspaceFingerprint`：建议使用 **轻量** workspace 指纹（避免扫描全仓库）：
  - 复用 `packages/opencode/src/session/llm.ts` 的 `workspace-fingerprint/1.0` 口径（`projectId/worktree/directory/vcs`）

**Test cases：**
- 同一输入 → plan 的 `inputsFingerprint.sha256` 稳定
- `uxMode` 改变 → fingerprint 必变
- 有写/执行意图 → 一律 fork

**Commit message:** `feat(orchestrator): deterministic stage0 plan + cache`

#### Task 1.3：Plan Writer（Evidence artifacts + events）

**Files:**
- Create: `packages/opencode/src/session/orchestrator/writer.ts`
- Modify: `packages/opencode/src/evidence/writer.ts`（如需要新增 kind allowlist/分类）
- Test: `packages/opencode/test/session/orchestrator-writer.test.ts`

**落盘规范（建议）**：
- artifacts（进入 manifest）：
  - `orchestrator/<planId>/orchestrator.features.json`
  - `orchestrator/<planId>/orchestrator.plan.json`
- events：
  - `orchestrator.planned`：只放 summary + pointers（不要塞整个 plan）

**artifact kinds（建议明确，便于 export/筛选）**：
- `orchestrator-features`
- `orchestrator-plan`

**测试要点：**
- 写入后 evidence manifest 中能找到对应条目
- pointers 至少包含 `path + sha256`

**Commit message:** `feat(orchestrator): write plan/features as evidence artifacts`

#### Task 1.4：导出不断链（可选但强烈建议做，避免“证据写了但 export 丢了”）

**Files:**
- Modify: `packages/opencode/src/evidence/export.ts`

**修改点：**
1) `ALLOWLIST_KINDS` 增加：
   - `orchestrator-features`
   - `orchestrator-plan`
2) `classifyEntry()` 允许导出：
   - `.opencode/artifacts/<sessionId>/orchestrator/**`

**验收：**
- 在本地跑一次 `exportEvidence()` 后，导出目录能包含 `orchestrator/**` 的 artifacts（且 sha256 校验通过）

**Commit message:** `feat(evidence): export orchestrator artifacts`

---

### Milestone 2：把 Plan 接进主链路（仍保持默认行为不变）

**目标**：主会话每轮都会生成 plan 与事件（在 flag on 时），但不会影响 `LLM.stream` 的 retrieval/tool 行为；先获得可观测数据。

#### Task 2.1：SessionProcessor 接入（只写不改）

**Files:**
- Modify: `packages/opencode/src/session/processor.ts`
- (尽量避免) Modify: `packages/opencode/src/session/prompt.ts`（优先在 `SessionProcessor.process()` 内完成，不扩大冲突面）
- Test: `packages/opencode/test/session/orchestrator-integration.test.ts`（可选）

**实现建议：**
- 在 `SessionProcessor.process()` 调用 `LLM.stream()` 之前：
  - 读取 `uxMode`（flag/config）
  - 运行 `features` → `plan` → `writer`（all deterministic / cached）
- 只在 `Flag.OPENCODE_EXPERIMENTAL_ORCHESTRATOR` 且 agent 是 primary 且 agent.name 是 `build` 时启用（降低风险）

**关键约束：**
- 不得改变 `streamInput.tools` / 不得改变 messages / 不得触发 tool execution
- 所有失败必须降级为 no-op，并写 `orchestrator.degraded` 事件（不要打断聊天）

**Commit message:** `feat(orchestrator): integrate plan into session processor (no behavior change)`

---

### Milestone 3：Tool Broker v0（只读白名单 + non-interactive + pointerize）

**目标**：让 worker 能“用到工具结果”，但不让它直接动手；Tool Broker 执行只读模块并把输出变成 pointers（SSOT）。

#### Task 3.1：Tool Broker runner（v0 先支持 retrieval）

**Files:**
- Create: `packages/opencode/src/session/orchestrator/tool-broker.ts`
- Test: `packages/opencode/test/session/orchestrator-tool-broker.test.ts`

**v0 allowlist：**
- `retrieval`：调用 `runRetrieval()`（系统模块，非交互）

> 注：`verification` 虽然在设计稿中也属于“只读确定性模块”，但它需要 `TaskFrame.contextPackId`。在 v0 阶段建议先不纳入 Tool Broker allowlist，避免为了填 `contextPackId` 引入重复 ContextPack 构建或假 id。

#### Task 3.2：（可选）Tool Broker 支持 `verification`（在有 contextPackId 的前提下）

**前置条件：**
- Orchestrator pipeline 已能拿到本 turn 的 `contextPackId`（或明确选择“合成 contextPackId”，并接受它只用于审计字段）。

**规则：**
- 没有 `contextPackId` → 必须 `rejected`（reason: `missing_context_pack_id`）并事件化，不得用假值默默绕过。
- 有 `contextPackId` → 才允许调用 `runVerification()`，并且 `ctx.ask` 必须是 no-op（non-interactive）。

**non-interactive policy（必须）**：
- 任何 toolRequest 一律不触发 `PermissionNext.ask()` / `Question.ask()`
- 不满足 allowlist/预算 → `rejected` + `orchestrator.tool_broker.rejected` event

**pointerize（必须）**：
- broker 执行结果必须写 artifacts，并回填 `{ pointers[], summary }`
- events 里只写 summary+pointers（大内容落 artifact）

**测试要点：**
- 传入一个非法 tool id → 必须 rejected（且无 ask）
- 传入 `retrieval` → 返回 pointers（来自 retrieval runner 的 evidencePointers）

**Commit message:** `feat(orchestrator): tool broker v0 (retrieval/verification)`

---

### Milestone 4：LLM Workers v0（选 A：Internal Worker Runner）

**目标**：实现“后台小脑”：低成本、可缓存、可降级、可回放；不走 `LLM.stream`，避免隐式 retrieval/context-pack 副作用。

#### Task 4.1：Worker Runner（模板化、可复用、可测试）

**Files:**
- Create: `packages/opencode/src/session/orchestrator/worker-runner.ts`
- Create: `packages/opencode/src/session/orchestrator/worker-spec.ts`
- Modify: `packages/opencode/src/cache/policy.ts`（新增 cache namespace + ttl）
- Test: `packages/opencode/test/session/orchestrator-worker-contract.test.ts`

**实现方式（复用 capsule-assisted 范式）**：
- 输入：`RolePack` artifact（写入 manifest）
- cache：`CacheStore`（namespace: `orchestrator-worker`；workerId 放入 cacheKey input，避免动态 namespace）
- LLM：`generateObject()` + zod schema（严格 JSON）
- verifier：对输出做 schema + budget + 内容安全（短、不可注入、不可长段落）
- degraded：任何失败都要产出 `status=degraded`，并返回可解释 reason

**CachePolicy 约束：**
- `type Namespace` 增加：`"orchestrator-worker"`
- `ttlMs("orchestrator-worker")`：建议 10–30 分钟（偏短，降低漂移风险）

**注意**：
- worker **不得**使用 `LLM.stream()`（避免隐式 `runRetrieval()`）
- worker **不得**直接执行工具；只能输出 `toolRequests[]`

**Commit message:** `feat(orchestrator): internal worker runner (schema-first + cache + verifier)`

#### Task 4.2：实现第一个 worker：`evidence_critic`（推荐）

**Why this worker first：**
- 不要求仓库新增检索算法
- 直接服务“补齐证据缺口/unknown 降级”的目标

**Files:**
- Create: `packages/opencode/src/session/orchestrator/workers/evidence-critic.ts`
- Test: `packages/opencode/test/session/orchestrator-evidence-critic.test.ts`

**输入（RolePack.task）**：
- “检查当前工作集 pointers 是否足以支持回答；不足则给出 toolRequests（retrieval/verification）与 openQuestions”

**输出（WorkerResult）**：
- `toolRequests[]`：例如 `{ toolId:"retrieval", input:{ intentTextOverride?: string } }`
- `notes[]`：短、结构化（最多 10 条，每条最多 200 字）

**测试策略（不 mock LLM）：**
- 只测 verifier 与协议完整性；LLM 调用路径用 flag 控制（测试环境不启用 worker LLM 真实调用）
- 或者：注入 fake LanguageModel（参考 `packages/opencode/test/provider/openai-wire-api.test.ts` 的 fake model 模式）

**Commit message:** `feat(orchestrator): add evidence_critic worker`

---

### Milestone 5：把 workers + Tool Broker 串起来（并发上限、bounceMax=1）

**目标**：在 `assist/heavy` 下启用 1–2 个 worker；worker 给 toolRequests → Tool Broker 执行一次 → 回填 pointers → 主 LLM 消费；禁止循环。

#### Task 5.1：Orchestrator Turn Runner（整合器）

**Files:**
- Create: `packages/opencode/src/session/orchestrator/index.ts`
- Modify: `packages/opencode/src/session/processor.ts`（或 `session/llm.ts`，择一作为唯一入口）
- Test: `packages/opencode/test/session/orchestrator-turn.test.ts`

**实现建议（顺序固定，便于回放）**：
1) Stage0 plan（已有）
2) deterministic modules（先保持现状：`LLM.stream` 仍会隐式 `runRetrieval()`；等整体联通且需要进一步降成本时，再评估把 retrieval 前置到 orchestrator 并禁用隐式检索）
3) workers 并发执行（≤2）
4) Tool Broker 执行（bounceMax=1）
5) 将 pointers/summary 写入 artifacts + 在 system prompt 注入简短 `<orchestrator>` 指针段（可选）
6) 进入主 LLM

**关键约束：**
- `orchestratorMode=chat`：0 worker（硬约束）
- `orchestratorMode=fork`：不在本 turn 内执行写入；只生成“派工建议/计划”并交给 `tool:task`

**Commit message:** `feat(orchestrator): orchestrator turn runner (workers + tool broker)`

#### Task 5.2：主 LLM 工具面板收敛（`mainTools` gating，按 plan 生效）

**Files:**
- Modify: `packages/opencode/src/session/orchestrator/index.ts`
- Test: `packages/opencode/test/session/orchestrator-main-tools.test.ts`

**规则（设计稿定案，必须区分 null vs []）：**
- `mainTools: null` 或缺省：不覆写（保持现有 tools）
- `mainTools: []`：主 LLM 不得调用任何工具（tools 传 `{}`）
- `mainTools: ["read","glob",...]`：只允许 allowlist（与现有 tools 取交集；不额外增权）

**验收：**
- `mainTools` 变化只影响当前 turn（不要写入全局状态）
- `orchestratorMode=chat` 默认 `mainTools:null`（避免 chat 体验变弱）

---

### Milestone 6：把“执行/写入”升级到 fork（子会话窗口执行）

**目标**：当 plan 判定 `fork` 时，父会话只做计划与验收；真正动手由子会话执行，保证隔离与审计。

#### Task 6.1：fork 自动升级策略（父会话）

**Files:**
- Modify: `packages/opencode/src/session/processor.ts`
- (可能) Modify: `packages/opencode/src/session/prompt.ts`（为了生成更好的派工 prompt）

**行为：**
- 若 `orchestratorMode=fork`：
  - 父会话输出：为什么需要 fork、需要哪些确认、可选降级方案
  - 根据 `forkStrategy` 决定是否自动派工：
    - `auto`：自动调用 `tool:task` 创建子会话（必须走 PermissionNext.ask；deny/异常/失败则降级为“提示式派工”模板并事件化）
    - `suggest`：不自动 `tool:task`，只输出“提示式派工”模板（供插件/用户接管触发）
    - `off`：不派工（只解释原因与降级方案）
- 子会话的 agent/tool 权限与 workdirMode 沿用现有 task 机制（`packages/opencode/src/tool/task.ts`）

**注意**：
- 不绕过权限询问：fork 的写入/执行必须走现有 PermissionNext（符合安全策略）

**Commit message:** `feat(orchestrator): fork escalation via task sessions`

---

### Milestone 7：secure-output/verification 与 evidencePolicy 联动

**目标**：把当前固定的 `runSecureOutput(mode="balanced")` 改为“由 plan 决定策略”，并确保 chat 不被拖慢。

#### Task 7.1：按 plan 选择 policy

**Files:**
- Modify: `packages/opencode/src/session/processor.ts`
- (可选) Create: `packages/opencode/src/session/orchestrator/policy.ts`
- Test: `packages/opencode/test/session/orchestrator-secure-output-policy.test.ts`

**规则（设计稿定案）**：
- `chat`：默认不强制额外核验；若用户显式要求引用/对账/合规 → 升级到 assist/heavy 或 `evidencePolicy.enabled=true`
- `assist`：默认 balanced（缺证据必须 unknown/降级）
- `heavy`：默认 strict
- `fork`：执行链路在子会话更严格；父会话以计划/验收为主

**Commit message:** `feat(orchestrator): drive secure-output policy from orchestrator plan`

---

### Milestone 8：工具输出 SSOT（Tool Broker 路径 pointerize；交互路径不变）

**目标**：实现“同一工具两套输出”：交互 text 保持；broker 调用必须 pointerize。

#### Task 8.1：为 `grep` 增加 `outputFormat: "text"|"pointers"`（可选但建议）

**Files:**
- Modify: `packages/opencode/src/tool/grep.ts`
- Test: `packages/opencode/test/tool/grep-pointers.test.ts`

**策略：**
- `outputFormat="text"`：保持现有行为（不破坏 CLI）
- `outputFormat="pointers"`：
  - 将 matches 写入 artifact（例如 `tool/grep/<id>/hits.json` 或复用 `retrieval` snippet 结构）
  - 返回 `{ pointers[], summary }`

**Commit message:** `feat(tool): add grep pointers output format`

---

### Milestone 9：离线 eval / 回归（世界级兜底）

**目标**：保证“迭代不会悄悄变慢/变松/变不可信”，并且能自动发现证据断链。

#### Task 9.1：Offline eval 扩展（orchestrator plan determinism）

**Files:**
- Modify: `packages/opencode/src/eval/offline.ts`
- Test: `packages/opencode/test/eval/offline-orchestrator.test.ts`（新增）

**新增 checks：**
- `orchestratorPlanDeterminism`：同一 fixture + 同一 `uxMode` → plan hash 稳定
- `toolBrokerNonInteractive`：worker toolRequests 不触发 ask（可通过注入 ctx.ask 计数器断言）

**Commit message:** `test(eval): add offline orchestrator determinism checks`

---

## 3) Definition of Done（定案验收）

### 3.1 功能验收
- flag off：行为不变（无额外 worker 调用、无额外 tool broker）
- flag on：
  - 每轮都有 `orchestrator.features.json` + `orchestrator.plan.json` artifacts，并有 `orchestrator.planned` event
  - `chat`：0 worker（硬约束）
  - `assist/heavy`：最多 2 workers；Tool Broker `bounceMax=1`
  - worker 不直接动工具（无 tool parts / 无 ask）
  - Tool Broker 输出必须 pointerize 并入 manifest（SSOT）
  - `fork`：真正执行下沉到 task 子会话（父会话只计划/验收）

### 3.2 工程验收
- `bun test` 全绿（至少 `packages/opencode`）
- 新增协议全部纳入 contract test，避免漂移
- offline eval 新增项可跑通（若启用）

---

## 4) Rollout（建议）

- Phase 1（默认关闭）：仅内部/开发机开 `OPENCODE_EXPERIMENTAL_ORCHESTRATOR=1`，观测 artifacts/events
- Phase 2（灰度）：只对 `uxMode=deep` 开启 1 个 worker（`evidence_critic`），并严格预算
- Phase 3（默认开启 Auto）：当 offline eval 与线上事件指标稳定后，默认 `uxMode=auto`，但 `chat` 仍保持轻量
- Phase 4（插件接管派工，可选）：当需要与 `oh-my-opencode` 这类编排插件融合时，将基座设为 `forkStrategy=suggest`，由插件消费 orchestrator artifacts/events 来派工，避免双重编排抢控制权

---

## 附录 B（2026-02-07）：V1 Task11+12 进展补记（仅追加）

> 本附录仅记录本阶段进展与验收口径，不改动既有里程碑正文。

### B.1 交付边界

- Task11 负责：flags、shadow/canary 行为、集成路径联通。
- Task12 负责：发布门禁文档、事故 runbook、可回滚与验证口径沉淀。
- 新增发布文档：`docs/plans/2026-02-07-single-session-real-llm-workers-rollout.md`。

### B.2 与本实现计划的映射

- 对应本计划 `Task 11`：补全三类 flag 治理语义。
  - `OPENCODE_EXPERIMENTAL_ORCHESTRATOR_LLM_WORKERS`
  - `OPENCODE_EXPERIMENTAL_ORCHESTRATOR_WORKER_BADGE`
  - `OPENCODE_EXPERIMENTAL_ORCHESTRATOR_SHADOW_MODE`
- 对应本计划 `Task 12`：将发布策略从“建议段落”升级为可操作 runbook（Gate A/B/C + Kill Switch + 指标门禁）。

### B.3 当前发布策略（V1）

- Gate A：dogfood（`deep` + 单 worker，先 shadow）
- Gate B：5% canary（`auto` 小流量注入）
- Gate C：default on（默认开启，保留永久 kill switch）
- 降级路径：`C -> B -> A -> Shadow -> Off`

### B.4 可回滚口径（V1 Task11+12）

- 回滚方式：flag 级一键回退，优先 KS-2/KS-3。
- 回滚目标：分钟级恢复到“worker 未启用等价态”，且主链路不受阻断。
- 回滚后判定：worker 相关注入/事件停止，`chat`/基础会话可用性恢复。

### B.5 验证口径（V1 Task11+12）

- 测试与回归命令口径：
  - `cd packages/opencode && bun test test/session/orchestrator-integration-v2.test.ts`
  - `cd packages/opencode && bun test`
  - `cd packages/app && bun test`
  - `cd packages/opencode && bun test test/eval/offline-regression.test.ts`
- 指标口径：`Latency / Error Rate / Cost / Evidence Coverage` 四类门禁。
- 质量口径：需证据任务若无 pointer 支撑，必须 `unknown/unsupported`。

### B.6 Blocker 追踪（基线已知项）

- 基线复现命令：`cd packages/opencode && bun test test/eval/offline-regression.test.ts --bail`
- 当前失败点：`orchestratorPlanDeterminism.ok=false`。
- 归因标签：**非本次 Task11/Task12 引入**，归类为“**determinism 旧问题**”。
- 处理策略：本次不修复，单开后续任务追踪与修复，避免与本轮发布门禁混淆。
