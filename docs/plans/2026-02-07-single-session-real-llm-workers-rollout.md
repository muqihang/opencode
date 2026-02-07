# [V1] Single-Session Real LLM Workers Rollout & Ownership（Task11 + Task12）

> **定位**：本文件是 `Task11（集成与标志位）+ Task12（文档所有权）` 的统一发布与事故处置手册。  
> **目标**：保证真实 LLM workers 可以按门禁平滑上线，并且可在分钟级通过 flag 一键回退。  
> **范围**：仅覆盖单会话 orchestrator 的 `assist/heavy` worker 路径，不改变 `chat` 轻量路径。

---

## 1) 发布所有权与责任边界

- **Task11（代码与运行时集成）**：负责 flags、shadow/canary 行为、集成测试与运行时策略生效。
- **Task12（文档与发布纪律）**：负责 Gate 定义、kill switch 清单、事故 runbook、指标门禁和回滚/验证口径。
- **值班责任**：值班同学可直接执行 flag 级回退，不依赖代码回滚或数据回滚。

---

## 2) Gate A/B/C 发布门禁（dogfood -> 5% canary -> default on）

### Gate A：Dogfood（内部可控验证）

- **流量范围**：内部/开发环境，仅 `deep` 模式，单 worker（`evidence_critic`）。
- **目标**：验证真实 worker 调用链路、事件完整性、降级正确性。
- **建议 flags**：
  - `OPENCODE_EXPERIMENTAL_ORCHESTRATOR=1`
  - `OPENCODE_EXPERIMENTAL_ORCHESTRATOR_LLM_WORKERS=1`
  - `OPENCODE_EXPERIMENTAL_ORCHESTRATOR_SHADOW_MODE=1`（先影子观测，再灰度注入）
  - `OPENCODE_EXPERIMENTAL_ORCHESTRATOR_WORKER_BADGE=1`（仅内部可见）
- **放行条件（连续 24h）**：
  - worker 触发轮次无致命中断（fatal interruption）
  - 关键事件齐全：`orchestrator.worker_started/completed/degraded/timeout`
  - 回退演练通过（见第 6 节）

### Gate B：5% Canary（真实流量小比例）

- **流量范围**：`auto` 模式按会话或 turn 哈希放量至 **5%**。
- **目标**：验证真实用户分布下延迟/错误率/成本/证据覆盖。
- **建议 flags**：
  - `OPENCODE_EXPERIMENTAL_ORCHESTRATOR=1`
  - `OPENCODE_EXPERIMENTAL_ORCHESTRATOR_LLM_WORKERS=1`
  - `OPENCODE_EXPERIMENTAL_ORCHESTRATOR_SHADOW_MODE=0`
  - `OPENCODE_EXPERIMENTAL_ORCHESTRATOR_WORKER_BADGE=1`（内部构建可见，外部可按需关闭）
- **放行条件（连续 72h）**：
  - 满足第 3 节全部指标门禁
  - 无 Sev1/Sev2 事故
  - 降级路径 C -> B -> A -> Shadow -> Off 演练可在 10 分钟内完成

### Gate C：Default On（默认开启）

- **流量范围**：`auto` 默认开启真实 workers，`chat` 仍维持轻量无额外 worker。
- **目标**：在默认体验下保持可控收益（质量提升、风险受控）。
- **保持约束**：
  - worker 仍为只读/no-ask/no-write
  - `fork` 安全路径不变（写入/执行仍走子会话机制）
  - kill switch 永久保留

---

## 3) 指标门禁（Latency / Error Rate / Cost / Evidence Coverage）

> 以下门禁用于 Gate A -> B -> C 的升降级判定；任何一项持续超阈值都应触发降级或回退。

### 3.1 Latency（附加时延）

- `P50` worker 附加时延 `<= 350ms`
- `P95` worker 附加时延 `<= 1200ms`
- `chat` 路径不应出现系统性附加时延抬升

### 3.2 Error Rate（稳定性）

- worker 触发轮次的致命中断率 `< 0.1%`
- worker 失败必须 100% 降级为主链路可继续（不打断主回答）
- `timeout + degraded` 比例在 canary 阶段需保持在可接受预算（建议 `< 3%`）

### 3.3 Cost（成本与预算）

- worker token 开销必须受 `rolePack.budget.maxOutputTokens` 约束
- canary 阶段 worker 增量 token 成本相对 baseline 不超过预算线（建议 `< 20%`）
- 复现型请求的 worker cache 命中率建议 `>= 35%`

### 3.4 Evidence Coverage（证据覆盖）

- 对“需证据”任务，事实声明的 pointer 覆盖率需达标（建议 `>= 90%`）
- 不满足证据门槛时必须返回 `unknown/unsupported`，禁止无证据硬断言
- canary 相比 baseline，应观测到 unsupported factual claims 明显下降（目标 `>= 40%`）

---

## 4) Kill Switch 清单（flag 级一键回退）

> 原则：先收敛影响面，再保留最小观测能力；若仍异常，直接全量关闭。

### KS-0：仅关闭 UI 提示（不影响核心逻辑）

- `OPENCODE_EXPERIMENTAL_ORCHESTRATOR_WORKER_BADGE=0`

### KS-1：关闭注入，保留影子观测

- `OPENCODE_EXPERIMENTAL_ORCHESTRATOR_SHADOW_MODE=1`

### KS-2：关闭真实 workers

- `OPENCODE_EXPERIMENTAL_ORCHESTRATOR_LLM_WORKERS=0`

### KS-3：关闭整套 orchestrator 增强（全量回退）

- `OPENCODE_EXPERIMENTAL_ORCHESTRATOR=0`
- 同时保持：
  - `OPENCODE_EXPERIMENTAL_ORCHESTRATOR_LLM_WORKERS=0`
  - `OPENCODE_EXPERIMENTAL_ORCHESTRATOR_SHADOW_MODE=0`
  - `OPENCODE_EXPERIMENTAL_ORCHESTRATOR_WORKER_BADGE=0`

### 一键回退操作要求

- 预置 4 套发布配置（A/B/C + Full Rollback），值班可直接切换。
- 任何 Sev1/Sev2 触发时，允许先执行 `KS-3` 再补充诊断。

---

## 5) 事故处理 Runbook（降级路径、观测、回滚、沟通）

## 5.1 触发条件

- 连续 15 分钟超过任一门禁阈值（第 3 节）
- 出现用户可感知失败（回答中断、显著超时、错误注入）
- 出现证据链断裂（需证据回答但无 pointer 支撑）

## 5.2 降级路径（固定顺序）

- `C(Default On) -> B(5%) -> A(Dogfood) -> Shadow -> Off(KS-3)`
- 每次降级后观测 10 分钟；若未恢复，继续下一档降级。

## 5.3 观测清单（必须留痕）

- 事件：`orchestrator.worker_started/completed/degraded/timeout`
- 计划与证据：`orchestrator.features.json`、`orchestrator.plan.json`、worker artifacts
- 性能：turn 级附加时延 `P50/P95`
- 成本：worker token 增量、cache 命中率
- 质量：pointer 覆盖率、unknown/unsupported 比例

## 5.4 回滚步骤（分钟级）

1. 执行对应 kill switch（优先 KS-2 或 KS-3）
2. 确认新请求已生效（flags 已刷新）
3. 抽样验证 10~20 个请求：无 worker 注入副作用、主链路可用
4. 记录事故时间线与门禁触发项

## 5.5 沟通模板（对内/对外）

- **内部通报（即时）**：时间、影响范围、当前档位、已执行回退、下一次更新时间（默认 30 分钟）
- **产品/支持同步**：是否影响默认用户、是否建议重试、预计恢复时间
- **复盘输出（24h 内）**：根因、触发门禁、为何未提前拦截、永久修复项与 owner

---

## 6) V1 Task11+12 的可回滚与验证口径

## 6.1 可回滚口径（Task11 + Task12）

- 本次 V1 以 **flag 控制面** 为主，不引入不可逆数据迁移。
- 回滚目标定义：5 分钟内从任意 Gate 恢复到“等价于 worker 未开启”状态。
- 判定标准：
  - `OPENCODE_EXPERIMENTAL_ORCHESTRATOR=0` 后，不再产生 worker 相关事件与注入
  - 主会话仍保持原有可用性与权限边界

## 6.2 验证口径（发布前/回滚后）

### 发布前验证

- `cd packages/opencode && bun test test/session/orchestrator-integration-v2.test.ts`
- `cd packages/opencode && bun test`
- `cd packages/app && bun test`
- `cd packages/opencode && bun test test/eval/offline-regression.test.ts`

### 回滚后验证

- 采样确认 worker badge 与 worker 事件不再出现（按回滚等级判定）
- 抽样确认 `chat`/`auto` 基础问答可用，未出现写入/执行越权
- 事故窗口内关键指标回归基线区间

---

## 7) 文档变更记录（Task12）

- `2026-02-07`：创建本 rollout 文档，作为 V1 Task11+12 的发布与事故处置单一事实来源。

---

## 8) 基线 Blocker 说明（2026-02-07）

### 8.1 当前失败点（基线复现）

- 执行命令：`cd packages/opencode && bun test test/eval/offline-regression.test.ts --bail`
- 当前失败点：`orchestratorPlanDeterminism.ok=false`
- 失败表现：`expect(result.checks.orchestratorPlanDeterminism.ok).toBe(true)` 断言失败（Received: `false`）

### 8.2 归因标签（所有权）

- 该失败项**非本次 Task11/Task12 引入**。
- 该项在 V1 发布评审中归类为“**基线已知阻塞项（determinism 旧问题）**”。

### 8.3 本次处理策略

- 本次 Task11/Task12 不在此文档范围内修复该 determinism 问题。
- 本次仅记录、对齐、纳入发布门禁上下文，避免误判为新回归。
- 后续动作：单开独立任务跟踪并修复 `orchestratorPlanDeterminism`，修复完成后再解除对应 blocker 标记。
