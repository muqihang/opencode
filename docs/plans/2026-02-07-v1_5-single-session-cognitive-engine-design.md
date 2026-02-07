# opencode V1.5 Single-Session Cognitive Engine Design（Refactored）

> Date: 2026-02-07  
> Owner: Principal Architect（design-only rework）  
> Scope: 单 session 认知内核（SCK）升级为可商用、可插件化、可审计基座  
> Priority: **B（能力上限）先于 A（可靠性收敛）**

---

## 0) 术语与边界（强约束）

### 0.1 两层架构边界

- **SCK（Single-Session Cognitive Kernel）**：本次 V1.5 主体；负责单 session 内的主脑 + 小脑 + 工具代理 + 证据链 + 缓存 + 门控 + 可观测 + 回放。
- **MSD（Multi-Session Dispatcher）**：外层派工；负责跨 session 任务拆分与调度。
- **强约束**：MSD 不能替代 SCK；每个子 session 也必须运行同一套 SCK 内核。

### 0.2 不允许混淆的职责分层

- **基座（opencode core）负责**：认知控制流、worker 编排、tool broker、evidence/cache、verification/gating、observability/replay。
- **插件（domain plugins）负责**：领域 policy/schema/risk/profile。
- **插件禁止事项**：不得反向修改核心控制流（不能替换 orchestrator 主流程、不能绕过 broker、不能绕过 gate）。

---

## 1) As-Is vs To-Be

### 1.1 As-Is（V1 已有能力）

- 已有单 session 编排链路：`plan -> role-pack -> worker-runner -> tool-broker -> retrieval -> inject`。
- 已有 context-pack、context-pack-cache、compaction、capsule-assisted 的上下文压缩能力。
- 已有 evidence artifact/manifest/events 与 replay 基础。
- 已有 worker schema 校验、tool allowlist、timeout/降级语义。

### 1.2 To-Be（V1.5 目标）

- 在 DeepSeek 128K + 无微调前提下，通过工程编排实现“弱模型可商用品质”。
- B 阶段先提升能力上限（上下文利用率、协作强度、检索规划）；A 阶段收敛可靠性（低幻觉、证据完整、unknown-first）。
- 基座可扩展但不被插件绑死：插件可配置策略，不可篡改控制流。

### 1.3 当前差距（必须补齐）

- 证据链和 claim 级门控未形成统一图结构（claim graph）。
- 自适应 test-time compute 不足，难以按难度动态调度 worker/model/depth。
- 缺少双阶段合成协议，主脑答复前纠偏能力不足。
- pointer-first 的按需水合与防膨胀保护不完整。
- 离线评测尚未形成插件级 CI 阻断闭环。

---

## 2) Core vs Plugin Boundary（含不变量）

### 2.1 基座职责（Core Responsibilities）

- 维护单 session 主控制流与状态机。
- 统一 worker 调度、预算、并发、超时与降级。
- 统一 tool broker（权限、配额、审计、pointerize）。
- 统一 evidence 链（artifact/manifest/events）与引用完整性。
- 统一 cache policy、失效策略与污染防护。
- 统一 claim gate、unknown-first 与输出风险控制。
- 统一 SLO、error budget、回放与审计数据。

### 2.2 插件职责（Plugin Responsibilities）

- 提供领域约束：`policy/schema/risk/profile`。
- 提供领域 benchmark 配置与阈值建议。
- 提供 worker 触发偏好（在 core 允许范围内）。
- 不得直接执行工具、不得写入核心状态、不得修改 core 状态机。

### 2.3 Core Invariants（不可破坏，14 条）

| # | 不变量 | 可验证方式 |
|---|---|---|
| I1 | `orchestratorMode=chat` 必须 0 worker | turn 事件统计 + 回放检查 |
| I2 | worker 不得直连工具，只能经 broker | worker result schema + broker event |
| I3 | tool broker 必须 non-interactive | broker config snapshot |
| I4 | `bounceMax <= 1`，禁止递归回填循环 | broker telemetry |
| I5 | 所有工具结果必须 pointerize 落 artifacts | manifest 完整性检查 |
| I6 | mainTools 三态语义不变（`null/[]/allowlist`） | plan artifact diff |
| I7 | `unknown-first` 为 B/A 全阶段最小底线 | answer gate log |
| I8 | claim 无证据不得“确定性陈述” | claim gate report |
| I9 | 插件不能替换 core 主控制流 | plugin loader 校验 |
| I10 | core policy 优先级高于 plugin policy | policy merge trace |
| I11 | side-effect 任务必须 fork 子 session | mode decision event |
| I12 | 缓存 key 必须含 schema/version/policy hash | cache key linter |
| I13 | 每 turn 必须有 traceId 且事件可回放 | events.jsonl 审计 |
| I14 | plugin 启用前必须通过兼容性矩阵校验 | plugin compat check |

### 2.4 Extension Points（受控扩展点清单）

> 插件只能使用以下扩展点，且全部由 core 调用。

1. `onPlanCompile(input) -> pluginPlanHints`
2. `onWorkerPackBuild(input) -> roleOverrides`（不可新增越权角色）
3. `onToolPolicyResolve(input) -> policyPatch`（只能收紧，不能放宽 core deny）
4. `onEvidencePolicyResolve(input) -> evidencePatch`
5. `onOutputSchemaResolve(input) -> schemaRef`
6. `onRiskPolicyResolve(input) -> riskRules`
7. `onPreAnswerGate(input) -> gateHints`
8. `onEmit(input) -> domainEnvelope`

---

## 3) Model Routing Policy（P0 拍板、分配矩阵、升级/回退）

## 3.1 P0 Final（直接拍板）

**允许小脑使用“同供应商更小/更快模型池”。**

但必须满足硬约束：

- 角色默认模型分配（role-based default assignment）
- 自动升级闸门（低置信/高风险/高冲突触发）
- 强回退链（小模型不可用回退主模型）
- 成本/时延硬预算 + 熔断策略

## 3.2 Role-based 默认模型分配矩阵（同供应商）

| 角色 | 默认档位 | 备选升级档位 | 回退链 |
|---|---|---|---|
| `retrieval_planner` | `small-fast` | `small-balanced` | `main-default` |
| `evidence_critic` | `small-balanced` | `small-strong` | `main-default` |
| `patch_planner` | `small-balanced` | `main-default` | `main-default` |
| `response_scaffolder` | `small-fast` | `small-balanced` | `main-default` |
| `dual_pass_critic` | `small-strong` | `main-default` | `main-default` |
| `main_synthesizer` | `main-default` | `main-strong` | `main-default` |

> 默认模型解析落点：`packages/opencode/src/provider/provider.ts`（`cfg.model` / `cfg.small_model` / provider model variants）。

## 3.3 自动升级闸门（Auto Escalation Gates）

触发任一条件即升级 1 档（最多升级到 main）：

- `confidence < 0.62`
- `risk >= high`
- `conflictDensity >= 0.20`
- `unsupportedClaimRate >= 0.15`
- `toolFailureRate >= 0.30`

升级规则：

- 每 turn 最多升级 2 次。
- 升级后仍失败则触发强回退链。
- 升级事件必须记录 `gate_reason`, `from_model`, `to_model`。

## 3.4 强回退链（Hard Fallback Chain）

- 小模型不可用（timeout/5xx/rate-limit）连续 2 次：直接回退 `main-default`。
- broker/tool 失败且证据不足：回退“unknown-first 答复”。
- critic 阶段失败：保留主脑草稿，但降置信并显式标注证据缺口。

## 3.5 成本/时延硬预算与熔断

- **每 turn token 硬预算**：`<= baseline_turn_tokens * 1.30`
- **worker 总时延硬预算**：`<= 8s`（超过触发 worker 短路）
- **P95 总时延 SLO**：`<= 1.35x V1 baseline`
- **熔断条件**：连续 20 turn 超预算率 > 25% 或 provider 错误率 > 15%
- **熔断动作**：关闭第 3 worker -> 降检索深度 -> 关闭 dual-pass -> 保留 unknown-first 基线

---

## 4) Plugin Contract & Versioning

### 4.1 Plugin Contract（版本化协议）

#### `plugin-manifest/1.0`

```json
{
  "pluginId": "legal-cn",
  "pluginVersion": "1.2.0",
  "pluginApiVersion": "1.1",
  "coreRange": ">=1.5.0 <1.6.0",
  "domain": "legal",
  "capabilities": ["policy", "schema", "risk", "benchmark"],
  "hooks": [
    "onPlanCompile",
    "onEvidencePolicyResolve",
    "onRiskPolicyResolve",
    "onEmit"
  ]
}
```

#### `plugin-policy/1.0`

- `toolPolicyPatch`（只能收紧）
- `evidencePolicyPatch`
- `riskPolicy`（禁用词、强制免责声明、人工升级条件）
- `outputSchemaRef`

#### `plugin-benchmark/1.0`

- `datasetRef`
- `passThresholds`
- `blockingRules`

### 4.2 兼容策略

- 核心采用 semver；插件声明 `coreRange`。
- 仅允许 **前向兼容 minor**；跨 major 必须显式升级。
- 启动时进行 `manifest + contract + hooks + thresholds` 校验，失败即禁用插件并产生日志事件。

### 4.3 Compatibility Matrix（Core vs Plugin）

| Core Version | Plugin API 1.0 | Plugin API 1.1 | Plugin API 2.0 |
|---|---|---|---|
| 1.5.x | ✅ Supported | ✅ Supported | ❌ Rejected |
| 1.6.x | ⚠️ Legacy（deprecation） | ✅ Supported | ⚠️ Preview |
| 2.0.x | ❌ Rejected | ⚠️ Bridge needed | ✅ Supported |

### 4.4 策略冲突处理

优先级固定：`core policy > tenant policy > plugin policy > runtime hint`

- 若 plugin 放宽 core deny：直接拒绝并记录 `policy_conflict_denied`。
- 若 plugin 与 tenant policy 冲突：以 tenant policy 为准并告警。
- 所有冲突需写入 evidence 事件用于审计。

---

## 5) Governance & Isolation（安全、审计、冲突优先级）

### 5.1 多租户与插件隔离

- 证据路径分区：`tenantId/sessionId/traceId` 命名空间（不仅 sessionId）。
- 插件运行隔离：插件仅访问其声明 hooks 输入，不可直接触达内部状态存储。
- 配置隔离：provider options 与密钥按 tenant 绑定，不跨租户复用。
- 配额隔离：tenant 级 token/latency/error budget 独立统计与熔断。

### 5.2 安全与审计要求（商用基线）

必须可追溯字段：

- `traceId`, `tenantId`, `sessionId`, `messageId`
- `coreVersion`, `pluginId`, `pluginVersion`, `policyHash`, `schemaHash`
- `modelRoute`（role -> model -> escalation/fallback）
- `gateDecision`（pass/fail + reason）

必须产物：

- `events.jsonl`
- `evidence manifest`
- `claim graph snapshot`
- `route and budget report`

### 5.3 SLO 与 Error Budget

| 类别 | SLO | Error Budget（30 天） | 超预算动作 |
|---|---|---|---|
| 可用性 | Orchestrator 成功执行率 >= 99.5% | 0.5% | 禁用高阶 booster |
| 时延 | P95 turn latency <= 1.35x baseline | 5% turns | 降 worker 并发/深度 |
| 可靠性 | unsupportedClaimRate <= 5% | 5% claims | 强化 gate + dual-pass |
| 成本 | token/成功任务 <= 1.25x baseline | 10% tasks | 降级模型档位 |

---

## 6) V1.5 单 Session 目标流水线

1. `Plan Compile`（core + plugin hints merge）
2. `Context OS Build`（L0-L3 + pointer-first）
3. `Adaptive TTC`（动态 worker/model/depth）
4. `Worker Fan-out`（2~3）
5. `Brokered Tooling`（allowlist + pointerize）
6. `Claim Graph Build`（claim/evidence/conflict）
7. `Dual-pass Synthesis`（draft -> critic -> final）
8. `Gate & Emit`（unknown-first + audit）
9. `Replay & Metrics`

---

## 7) World-Class Boosters（Mandatory）

> 每个 Booster 必须具备：触发条件、协议/数据结构、开关、指标、测试、回滚。

### 7.1 Booster-1: Claim Graph + Evidence Gate

**触发条件**

- `assist/heavy/fork` 模式默认开启。
- 用户请求包含事实判断、规范引用、风险建议时强制开启。
- `chat` 模式在 `high_risk_intent=true` 时开启轻量图。

**协议/数据结构**

```ts
// claim-graph/1.0
interface ClaimNode {
  id: string
  text: string
  type: "fact" | "inference" | "instruction"
  confidence: number
  risk: "low" | "medium" | "high"
}

interface EvidenceEdge {
  claimId: string
  pointer: string
  support: "supports" | "partial" | "none"
  weight: number
}

interface ConflictEdge {
  fromClaimId: string
  toClaimId: string
  reason: "contradiction" | "stale" | "scope_mismatch"
  severity: "low" | "medium" | "high"
}

interface ClaimGraph {
  version: "claim-graph/1.0"
  claims: ClaimNode[]
  evidence: EvidenceEdge[]
  conflicts: ConflictEdge[]
  metrics: {
    unsupportedRate: number
    conflictDensity: number
    avgConfidence: number
  }
}

interface GateDecision {
  status: "pass" | "degrade" | "block"
  reason: string[]
  action: "emit" | "unknown_first" | "ask_more_context"
}
```

**Gate 判定流程与阈值**

1. 构建 claim graph。
2. 计算 `unsupportedRate`, `conflictDensity`, `highRiskUnsupported`。
3. 判定：
   - `unsupportedRate <= 0.05 && conflictDensity <= 0.10` -> `pass`
   - `unsupportedRate <= 0.15 && highRiskUnsupported=0` -> `degrade`（unknown-first）
   - 否则 `block`（拒绝确定性答复）

**开关**

- `OPENCODE_EXPERIMENTAL_CLAIM_GRAPH_GATE`

**指标**

- `unsupportedClaimRate`
- `conflictDensity`
- `gateBlockRate`
- `unknownFirstPrecision`

**测试**

- 基线回归（当前可直接执行）：`cd packages/opencode && bun test test/session/orchestrator-*.test.ts test/verification/*.test.ts --bail`
- 需先补测试文件后执行：`packages/opencode/test/session/claim-graph-gate.test.ts`、`packages/opencode/test/verification/claim-gate-regression.test.ts`、`packages/opencode/test/session/turn-gate-e2e.test.ts`
- 补齐专项后执行：`cd packages/opencode && bun test test/session/claim-graph-gate.test.ts test/verification/claim-gate-regression.test.ts test/session/turn-gate-e2e.test.ts --bail`

**回滚**

- 关闭开关，回退至现有 claim-evidence gate（无图结构）。
- 保留 unknown-first，不可回退。

---

### 7.2 Booster-2: Adaptive Test-Time Compute

**触发条件**

- turn 进入 `assist/heavy`。
- 任一复杂度信号达到阈值：`taskComplexity>=0.6`、`uncertainty>=0.5`、`conflictDensity>=0.15`。

**协议/数据结构**

```ts
// adaptive-ttc/1.0
interface ComputeSignals {
  taskComplexity: number
  uncertainty: number
  conflictDensity: number
  riskLevel: "low" | "medium" | "high"
}

interface ComputePlan {
  workers: 1 | 2 | 3
  modelTier: "small-fast" | "small-balanced" | "small-strong" | "main-default"
  retrievalDepth: "shallow" | "balanced" | "deep"
  enableSecondPass: boolean
  hardBudget: {
    tokenCap: number
    latencyCapMs: number
  }
}
```

**预算闸门与熔断**

- 预算闸门：`tokenCap` 与 `latencyCapMs` 同时生效。
- 触发熔断：
  - 单 turn 超预算两次 -> 降 worker 数量
  - 连续 20 turn 超预算率 > 25% -> 禁用 deep retrieval
  - provider 错误率 > 15% -> modelTier 强制回落

**开关**

- `OPENCODE_EXPERIMENTAL_ADAPTIVE_TTC`

**指标**

- `avgWorkersPerTurn`
- `escalationRate`
- `budgetBreachRate`
- `qualityGainPerToken`

**测试**

- 基线回归（当前可直接执行）：`cd packages/opencode && bun test test/session/orchestrator-plan.test.ts test/session/orchestrator-worker-runner-events.test.ts test/session/orchestrator-workers-v2.test.ts --bail`
- 需先补测试文件后执行：`packages/opencode/test/session/adaptive-ttc-policy.test.ts`、`packages/opencode/test/session/adaptive-ttc-budget.test.ts`、`packages/opencode/test/session/adaptive-ttc-breaker.test.ts`
- 补齐专项后执行：`cd packages/opencode && bun test test/session/adaptive-ttc-policy.test.ts test/session/adaptive-ttc-budget.test.ts test/session/adaptive-ttc-breaker.test.ts --bail`

**回滚**

- 固定策略：worker=2、modelTier=`small-balanced`、retrievalDepth=`balanced`、secondPass=off。
- 保留 unknown-first 与降级语义。

---

### 7.3 Booster-3: Dual-pass Synthesis

**触发条件**

- `riskLevel=high` 或 `unsupportedRate>0.05` 或 `conflictDensity>0.10`。
- 插件要求强引用完整性（如法律、医疗、财务）时强制开启。

**协议/数据结构**

```ts
// dual-pass/1.0
interface DraftAnswer {
  text: string
  claims: string[]
  citations: string[]
}

interface CriticReport {
  status: "ok" | "fix_needed" | "fail"
  missingCitations: string[]
  unsupportedClaims: string[]
  rewriteHints: string[]
}

interface FinalSynthesis {
  text: string
  citations: string[]
  confidence: number
  degraded: boolean
}
```

**两阶段协议**

1. 主脑生成 `DraftAnswer`。
2. `dual_pass_critic` 校验引用与冲突，产出 `CriticReport`。
3. 主脑根据 report 生成 `FinalSynthesis`。

**失败降级路径**

- critic 超时/失败：
  - 若 draft 已满足最小 gate -> 直接输出 draft + `degraded=true`
  - 若 draft 不满足 gate -> 输出 unknown-first
- 第二阶段修订失败：回退 draft（降置信）并追加“证据不足”说明。

**开关**

- `OPENCODE_EXPERIMENTAL_DUAL_PASS_SYNTHESIS`

**指标**

- `citationFixRate`
- `finalUnsupportedRate`
- `dualPassFallbackRate`
- `qualityDeltaAfterCritic`

**测试**

- 基线回归（当前可直接执行）：`cd packages/opencode && bun test test/session/orchestrator-evidence-critic.test.ts test/session/orchestrator-integration.test.ts test/evidence/pack-view-pointers.test.ts --bail`
- 需先补测试文件后执行：`packages/opencode/test/session/dual-pass-protocol.test.ts`、`packages/opencode/test/session/dual-pass-degrade.test.ts`、`packages/opencode/test/evidence/dual-pass-citation-integrity.test.ts`
- 补齐专项后执行：`cd packages/opencode && bun test test/session/dual-pass-protocol.test.ts test/session/dual-pass-degrade.test.ts test/evidence/dual-pass-citation-integrity.test.ts --bail`

**回滚**

- 关闭 second pass，仅保留单 pass + claim gate。
- 强制 unknown-first 仍保持开启。

---

### 7.4 Booster-4: Pointer-first Context OS

**触发条件**

- token 预算利用率 > 70%。
- `contextSizePressure=high` 或检索结果超过阈值。
- multi-turn 长对话自动启用。

**协议/数据结构**

```ts
// context-os/1.0
interface LayeredContext {
  L0_hot: string[]
  L1_capsule: string[]
  L2_pointers: string[]
  L3_hydration_plan: {
    pointer: string
    score: number
    maxChars: number
  }[]
}

interface HydrationRequest {
  pointer: string
  reason: "missing_evidence" | "conflict_resolve" | "high_risk_claim"
  maxTokens: number
}

interface HydrationResult {
  pointer: string
  chunkHash: string
  tokens: number
  accepted: boolean
}
```

**按需水合算法（可执行）**

1. 对 pointer 计算优先级分：`priority = riskWeight * uncertainty * recency`。
2. 按分数降序取 topN（默认 5）。
3. 每次水合前检查剩余 token 预算。
4. 超预算则停止并标记 `hydration_truncated`。

**反注入膨胀保护**

- 单 pointer 最大注入 token 上限（例如 800）。
- 单 turn 总水合上限（例如 2,400 tokens）。
- 若同源 chunk 重复注入 >1 次则去重阻断。

**cache key 与失效策略（防污染）**

- key 组成：`sessionId + tenantId + schemaVersion + modelId + policyHash + pointerHash + chunkHash`
- 失效策略：
  - schemaVersion 变更 -> 全失效
  - policyHash 变更 -> 选择性失效
  - 冲突率激增（>0.25）-> 触发冷启动 1 turn

**开关**

- `OPENCODE_EXPERIMENTAL_POINTER_CONTEXT_OS`

**指标**

- `hydrationHitRate`
- `promptInflationRate`
- `cachePoisonSuspectRate`
- `contextReuseGain`

**测试**

- 基线回归（当前可直接执行）：`cd packages/opencode && bun test test/session/context-pack-*.test.ts test/session/compaction*.test.ts test/session/capsule*.test.ts --bail`
- 需先补测试文件后执行：`packages/opencode/test/session/context-os-hydration.test.ts`、`packages/opencode/test/session/context-os-cache-key.test.ts`、`packages/opencode/test/session/context-os-anti-bloat.test.ts`
- 补齐专项后执行：`cd packages/opencode && bun test test/session/context-os-hydration.test.ts test/session/context-os-cache-key.test.ts test/session/context-os-anti-bloat.test.ts --bail`

**回滚**

- 回退到现有 L0-L3 静态策略 + conservative evidence segment。
- 关闭动态 hydration，不关闭 pointer-first。

---

### 7.5 Booster-5: Continuous Offline Eval

**触发条件**

- 每次 PR、每日定时、插件版本发布前。
- core 或 plugin policy/schema/gate 变更时强制执行。

**协议/数据结构**

```json
{
  "version": "offline-eval/1.0",
  "pluginId": "legal-cn",
  "suite": "legal_facts_v1",
  "samples": [
    {
      "id": "legal-001",
      "input": "合同终止条件...",
      "goldClaims": ["..."],
      "goldCitations": ["pointer://..."]
    }
  ],
  "metrics": {
    "taskCompletion": 0.0,
    "unsupportedClaimRate": 0.0,
    "unknownPrecision": 0.0,
    "citationIntegrity": 0.0
  }
}
```

插件级 benchmark 样本结构（最低要求）：

- 法律（legal）：`事实-条款映射`、`冲突法条`、`证据缺失场景`。
- 销售（sales）：`需求归因`、`竞品对比`、`不确定询盘`、`风险披露`。

**CI 回归门禁与阻断规则**

- 阈值（示例）：
  - `unsupportedClaimRate <= 0.05`
  - `unknownPrecision >= 0.85`
  - `citationIntegrity >= 0.95`
  - `taskCompletion >= baseline - 0.03`
- 任一硬阈值不达标 -> CI 阻断合并。

**报表格式**

- `offline-eval-report.json`（机器可读）
- `offline-eval-summary.md`（人类可读）
- 必含：插件维度、场景维度、回归对比、失败样本链接。

**开关**

- `OPENCODE_EXPERIMENTAL_OFFLINE_EVAL_GATES`

**指标**

- `pluginPassRate`
- `regressionCount`
- `hardBlockCount`
- `medianQualityDelta`

**测试**

- 阶段1（脚本不存在时先执行）：`cd packages/opencode && bun test test/eval/*.test.ts --bail`
- 阶段1（需先建立最小 runner）：建议先补 `packages/opencode/script/test-offline-eval.ts` 并在 `packages/opencode/package.json` 增加 `test:offline-eval` script
- 阶段2（脚本落地后启用 CI 阻断）：`# TODO: add script test:offline-eval`，再执行 `bun run test:offline-eval`
- 阶段2（插件子集门禁，脚本落地后）：`bun run test:offline-eval --plugin=legal-cn --suite=legal_facts_v1`、`bun run test:offline-eval --plugin=sales-b2b --suite=sales_reasoning_v1`

**回滚**

- 降级为“警告模式”仅告警不阻断（限时 7 天）。
- 7 天后必须恢复阻断，防止长期质量漂移。

---

## 8) Wave-by-Wave Execution Plan（B1/B2/A1/A2）

> **最小可靠性底线（B 阶段也必须满足）**：
> 1) unknown-first 不可关闭；2) 降级语义不可删除；3) evidence pointer 完整性校验不可移除。

### 8.1 B1（能力上限第一步：协作与模型路由）

**目标**

- 固化 role-based 模型分配与回退链。
- 引入 Adaptive TTC（基础版，不含 deep retrieval）。

**文件触点**

- `packages/opencode/src/session/orchestrator/plan.ts`
- `packages/opencode/src/session/orchestrator/index.ts`
- `packages/opencode/src/session/orchestrator/worker-runner.ts`
- `packages/opencode/src/provider/provider.ts`
- `packages/opencode/src/session/orchestrator/workers/*`

**开关**

- `OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V15_B1`
- `OPENCODE_EXPERIMENTAL_ADAPTIVE_TTC`

**验收标准**

- 2 worker 默认稳定，3 worker 条件触发稳定。
- 模型升级/回退事件可审计。
- unknown-first 命中策略在 B1 全程有效。

**失败回滚**

- 固定 worker=2、modelTier 固定、禁用动态升级。
- 保留 unknown-first 与降级。

**测试命令**

- `cd packages/opencode && bun test test/session/orchestrator-*.test.ts --bail`
- `cd packages/opencode && bun test test/provider/*.test.ts --bail`
- 需先补测试文件后执行（Adaptive TTC 专项）：`packages/opencode/test/session/adaptive-ttc-policy.test.ts`、`packages/opencode/test/session/adaptive-ttc-budget.test.ts`、`packages/opencode/test/session/adaptive-ttc-breaker.test.ts`

### 8.2 B2（能力上限第二步：上下文 OS 与证据闭环）

**目标**

- 上线 Pointer-first Context OS + 按需水合。
- 工具结果与 claim graph 所需证据统一落盘。

**文件触点**

- `packages/opencode/src/session/context-pack.ts`
- `packages/opencode/src/session/context-pack-cache.ts`
- `packages/opencode/src/session/compaction.ts`
- `packages/opencode/src/session/capsule-assisted.ts`
- `packages/opencode/src/session/orchestrator/tool-broker.ts`
- `packages/opencode/src/evidence/writer.ts`
- `packages/opencode/src/evidence/chain.ts`

**开关**

- `OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V15_B2`
- `OPENCODE_EXPERIMENTAL_POINTER_CONTEXT_OS`

**验收标准**

- `promptInflationRate` 显著下降。
- pointerize 完整率 100%。
- 缓存污染可检测并自动冷启动。

**失败回滚**

- 禁用动态 hydration，回退静态 L0-L3。
- 保留 pointer-first 与 evidence 校验底线。

**测试命令**

- `cd packages/opencode && bun test test/session/context-pack-*.test.ts test/session/compaction*.test.ts test/session/capsule*.test.ts --bail`
- `cd packages/opencode && bun test test/evidence/*.test.ts --bail`
- 需先补测试文件后执行（Context OS 专项）：`packages/opencode/test/session/context-os-hydration.test.ts`、`packages/opencode/test/session/context-os-cache-key.test.ts`、`packages/opencode/test/session/context-os-anti-bloat.test.ts`

### 8.3 A1（可靠性第一步：Claim Graph Gate + Dual-pass）

**目标**

- claim graph 正式纳入 gate。
- dual-pass synthesis 上线高风险场景。

**文件触点**

- `packages/opencode/src/session/orchestrator/index.ts`
- `packages/opencode/src/verification/index.ts`
- `packages/opencode/src/evidence/chain.ts`
- `packages/opencode/src/evidence/events.ts`
- `packages/opencode/src/protocol/*`（新增 claim graph / dual pass 协议）

**开关**

- `OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V15_A1`
- `OPENCODE_EXPERIMENTAL_CLAIM_GRAPH_GATE`
- `OPENCODE_EXPERIMENTAL_DUAL_PASS_SYNTHESIS`

**验收标准**

- unsupportedClaimRate 下降至目标区间。
- dual-pass 在高风险请求中的 citation 修复率达标。
- 第二阶段失败回退路径可重放可解释。

**失败回滚**

- 关闭 dual-pass，保留 claim gate。
- 若 claim graph 异常，回退简化 gate 但不取消 unknown-first。

**测试命令**

- `cd packages/opencode && bun test test/verification/*.test.ts test/evidence/*.test.ts test/session/orchestrator-*.test.ts --bail`
- 需先补测试文件后执行（Claim Graph / Dual-pass 专项）：`packages/opencode/test/session/claim-graph-gate.test.ts`、`packages/opencode/test/verification/claim-gate-regression.test.ts`、`packages/opencode/test/session/turn-gate-e2e.test.ts`、`packages/opencode/test/session/dual-pass-protocol.test.ts`、`packages/opencode/test/session/dual-pass-degrade.test.ts`、`packages/opencode/test/evidence/dual-pass-citation-integrity.test.ts`

### 8.4 A2（可靠性第二步：治理、隔离、离线阻断）

**目标**

- 完成多租户/插件隔离治理。
- 上线 Continuous Offline Eval 阻断门禁。

**文件触点**

- `packages/opencode/src/evidence/writer.ts`
- `packages/opencode/src/evidence/events.ts`
- `packages/opencode/src/provider/provider.ts`
- `packages/opencode/src/session/orchestrator/features.ts`
- `packages/opencode/src/config/config.ts`
- `packages/opencode/src/flag/flag.ts`
- `packages/opencode/src/cli/cmd/evidence.ts`

**开关**

- `OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V15_A2`
- `OPENCODE_EXPERIMENTAL_OFFLINE_EVAL_GATES`

**验收标准**

- core/plugin policy 冲突处理可追溯。
- tenant 级审计字段完整。
- CI 可阻断失败插件发布。

**失败回滚**

- offline eval 临时降级为 warning（最长 7 天）。
- 插件冲突策略回退到 core-only。

**测试命令**

- 阶段1（脚本不存在时先执行）：`cd packages/opencode && bun test test/evidence/*.test.ts test/provider/*.test.ts test/eval/*.test.ts --bail`
- 阶段1（需先补最小 runner）：建议先补 `packages/opencode/script/test-offline-eval.ts` 并在 `packages/opencode/package.json` 增加 `test:offline-eval` script
- 阶段2（脚本落地后启用 CI 阻断）：`# TODO: add script test:offline-eval`，再执行 `bun run test:offline-eval`

### 8.5 落实路线（Booster Mapping）

| Booster | 落地 Wave | 主要文件触点 | 测试命令 |
|---|---|---|---|
| Claim Graph + Evidence Gate | A1 | `session/orchestrator/index.ts`, `verification/index.ts`, `evidence/chain.ts` | `cd packages/opencode && bun test test/session/orchestrator-*.test.ts test/verification/*.test.ts --bail`；专项需先补 `test/session/claim-graph-gate.test.ts`、`test/verification/claim-gate-regression.test.ts` |
| Adaptive Test-Time Compute | B1 | `session/orchestrator/plan.ts`, `worker-runner.ts`, `provider/provider.ts` | `cd packages/opencode && bun test test/session/orchestrator-plan.test.ts test/session/orchestrator-worker-runner-events.test.ts test/session/orchestrator-workers-v2.test.ts test/provider/*.test.ts --bail`；专项需先补 `test/session/adaptive-ttc-*.test.ts` |
| Dual-pass Synthesis | A1 | `session/orchestrator/index.ts`, `evidence/events.ts`, `protocol/*` | `cd packages/opencode && bun test test/session/orchestrator-evidence-critic.test.ts test/session/orchestrator-integration.test.ts test/evidence/*.test.ts --bail`；专项需先补 `test/session/dual-pass-*.test.ts` 与 `test/evidence/dual-pass-citation-integrity.test.ts` |
| Pointer-first Context OS | B2 | `session/context-pack.ts`, `context-pack-cache.ts`, `compaction.ts`, `capsule-assisted.ts` | `cd packages/opencode && bun test test/session/context-pack-*.test.ts test/session/compaction*.test.ts test/session/capsule*.test.ts --bail`；专项需先补 `test/session/context-os-*.test.ts` |
| Continuous Offline Eval | A2 | `provider/provider.ts`, `config/config.ts`, `flag/flag.ts`, `cli/cmd/evidence.ts` | 阶段1：`cd packages/opencode && bun test test/eval/*.test.ts --bail`（并先补 runner）；阶段2：`# TODO: add script test:offline-eval` 后执行 `bun run test:offline-eval` |

---

## 9) Acceptance Checklist（可验收条目）

- [ ] Core vs Plugin 边界在代码入口层可验证（插件不可改主控制流）。
- [ ] 14 条 Core Invariants 均有对应自动检查或回放校验。
- [ ] P0 决策已生效：小脑可用同供应商小模型池。
- [ ] role-based 模型分配矩阵可配置且可审计。
- [ ] 自动升级闸门阈值可配置并有事件记录。
- [ ] 小模型失败时强回退链生效且可回放。
- [ ] 成本/时延硬预算与熔断动作可自动触发。
- [ ] core policy > plugin policy 冲突优先级可验证。
- [ ] 插件 contract/version/compatibility matrix 校验可执行。
- [ ] 多租户字段（tenantId/orgId）进入 evidence/events。
- [ ] Claim Graph + Evidence Gate 产物与判定结果可导出。
- [ ] Adaptive TTC 的预算闸门与熔断回滚可回归验证。
- [ ] Dual-pass 在高风险场景下默认开启并有失败安全回退。
- [ ] Pointer-first Context OS 支持按需水合与反膨胀保护。
- [ ] cache key 包含 schema/version/policy/pointer 关键维度。
- [ ] Continuous Offline Eval 对 legal/sales 均有样本集。
- [ ] 已完成离线评测最小 runner 落地（建议 `packages/opencode/script/test-offline-eval.ts` + `packages/opencode/package.json` 中 `test:offline-eval` script）。
- [ ] CI 门禁阈值与阻断规则已配置（前置：`test:offline-eval` script 已落地）。
- [ ] B 阶段最小可靠性底线（unknown-first + degrade）持续满足。
- [ ] Wave B1/B2/A1/A2 各自开关、验收、回滚均明确。
- [ ] 所有关键事件可在 replay 中串联完整决策链。

---

## 10) 阻塞级问题（仅 3 个）

1. 当前线上是否已有 tenant 维度标识贯穿 session/evidence/provider，如果没有需先完成统一 ID 注入。
2. `test:offline-eval` 需按两阶段执行：阶段1 先补最小 runner（建议 `packages/opencode/script/test-offline-eval.ts` + `packages/opencode/package.json` script）并先跑 `cd packages/opencode && bun test test/eval/*.test.ts --bail`；阶段2 脚本落地后启用 `bun run test:offline-eval` 作为 CI 阻断。
3. `pluginApiVersion` 的来源与发布机制是否已有统一注册中心；若无需先定义注册流程避免矩阵失真。
