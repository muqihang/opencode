# F4-HQ-ARCH-AUDIT-DEEPSEEK-01 架构评审报告（2026-02-14）

- 任务类型：只读架构评审（未修改任何生产代码/配置/测试）
- 评审范围：
  - `packages/opencode/src/session/**`
  - `packages/opencode/src/secure-output/**`
  - `packages/opencode/src/retrieval/**`
  - `packages/opencode/test/session/**`
  - `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/f4-hq/**`
- 评审方法：本地证据审查（代码+测试+历史审计文档）+ 外部权威资料对照（DeepSeek 官方文档 / 论文 / 工程文档）

## Executive Verdict

**BLOCKED**

### BLOCKED 理由（核心）
1. **“4+3” 未完全闭环**：
   - `Command Evidence Ledger` 的事件流是 append-only，但 manifest 仍为 upsert 重写，不满足“全链条 append-only”目标。证据：`packages/opencode/src/evidence/events.ts:257`、`packages/opencode/src/evidence/events.ts:266`、`packages/opencode/src/evidence/writer.ts:392`。
   - `Progress Monotonicity Constraint` 依赖进程内 `Map/Set`，重启后无法保证严格单调和 hard-stop 冻结连续性。证据：`packages/opencode/src/session/orchestrator/writer.ts:50`、`packages/opencode/src/session/orchestrator/writer.ts:52`、`packages/opencode/src/session/orchestrator/writer.ts:60`。
2. **确定性恢复链存在断点**：secure-output 验证仍传 `contextPackId: "unknown"`，与“可追溯恢复检查点”目标不一致。证据：`packages/opencode/src/secure-output/worker.ts:663`。
3. **DeepSeek 特性利用“有接入、但未充分工程化”**：
   - 已有 deepseek reasoning 参数清理与 reasoning 生命周期处理；
   - 但温度/采样策略和 `orchestrator_v16_deepseek_thinking` 仍偏“开关透传”，缺少行为级策略分支与量化验收。证据：`packages/opencode/src/provider/transform.ts:50`、`packages/opencode/src/provider/transform.ts:305`、`packages/opencode/src/session/processor.ts:687`。

---

## Current State Map

### A. 核心架构（“4+3”）

| 机制 | 状态 | 结论 | 本地证据 |
|---|---|---|---|
| 1) Command Evidence Ledger（Append-only 命令证据账本） | **Partial** | 事件日志 append-only 成立；manifest 仍可被 upsert 重写 | `packages/opencode/src/evidence/events.ts:257` / `packages/opencode/src/evidence/events.ts:266` / `packages/opencode/src/evidence/writer.ts:392` |
| 2) State Anchor Replay（状态锚点重放） | **Implemented** | replay fail-closed + compaction 前置检查已落地 | `packages/opencode/src/session/anchor-snapshot.ts:66` / `packages/opencode/src/session/compaction.ts:392` |
| 3) Delta Probes（增量取证） | **Implemented（局部仍可加强）** | retrieval probe journal + dedupe；compaction delta report 已写入 | `packages/opencode/src/retrieval/runner.ts:402` / `packages/opencode/src/retrieval/runner.ts:932` / `packages/opencode/src/session/compaction.ts:649` |
| 4) Reference Check Integrity Gate（file:line grounding，fail-closed） | **Implemented（strict 场景）** | file:line 解析与行号校验、strict fail-closed、生效事件齐备 | `packages/opencode/src/session/reference-check.ts:4` / `packages/opencode/src/session/reference-check.ts:135` / `packages/opencode/src/session/reference-check.ts:218` / `packages/opencode/src/session/processor.ts:749` |
| 5) Progress Monotonicity Constraint | **Partial** | cycle/rerun/stop 逻辑存在，但状态只在进程内维护 | `packages/opencode/src/session/orchestrator/writer.ts:50` / `packages/opencode/src/session/orchestrator/writer.ts:163` |
| 6) Deterministic Resume Checkpoint | **Partial** | context-ledger + anchor + compaction state 有基础；secure-output 验证链仍未绑定 contextPackId | `packages/opencode/src/session/context-ledger.ts:33` / `packages/opencode/src/session/llm.ts:748` / `packages/opencode/src/session/compaction.ts:589` / `packages/opencode/src/secure-output/worker.ts:663` |
| 7) Failure Taxonomy + Fallback DAG | **Implemented** | taxonomy 归一化 + degraded 事件 DAG 字段已标准化并可观测 | `packages/opencode/src/session/orchestrator/degraded-taxonomy.ts:181` / `packages/opencode/src/session/orchestrator/writer.ts:200` / `packages/opencode/src/session/processor.ts:723` |

### B. Claims Augment 5X

| 增强点 | 状态 | 本地证据 |
|---|---|---|
| 1) Automatic Fact Extraction & Claims Drafting | **Implemented** | `packages/opencode/src/secure-output/worker.ts:345` |
| 2) Intelligent Pointer Automation（path/sha256/anchor） | **Implemented** | `packages/opencode/src/secure-output/worker.ts:168` |
| 3) Reference-Check Feedback Loop | **Implemented** | `packages/opencode/src/secure-output/worker.ts:689` |
| 4) Intent-Aware Contract Granularity（strict/light） | **Implemented** | `packages/opencode/src/session/secure-output-contract.ts:76` |
| 5) Strict Claims Seed Deep Integration | **Implemented（上下文绑定仍有缺口）** | `packages/opencode/src/session/orchestrator/index.ts:616` / `packages/opencode/src/session/secure-output-contract.ts:88` / `packages/opencode/src/secure-output/worker.ts:663` |

### C. 会话压缩增强（Compaction）

| 层级 | 状态 | 本地证据 |
|---|---|---|
| 1) Deterministic Compaction Semantic Upgrade | **Implemented** | `trigger_source`：`packages/opencode/src/session/compaction.ts:489`；`goal/active_files/next_steps`：`packages/opencode/src/session/compaction.ts:502`；`compaction.quality`：`packages/opencode/src/session/compaction.ts:630`、`packages/opencode/src/session/compaction.ts:681` |
| 2) Verified LLM-Assisted Compaction Augment | **Implemented（守门完整）** | skipped/applied + `ui_view_source`：`packages/opencode/src/session/compaction.ts:761`、`packages/opencode/src/session/compaction.ts:879`；verify-success 后才应用：`packages/opencode/src/session/compaction.ts:811`、`packages/opencode/src/session/compaction.ts:823`；JSON 泄露拦截：`packages/opencode/src/session/compaction.ts:160`、`packages/opencode/src/session/compaction.ts:849` |

---

## Defects & Blind Spots

### P0

#### P0-01：Evidence Ledger 不是“全链 append-only”
- 问题：事件文件是 append-only，但 manifest 使用 `upsert`（按 path 覆写）而不是 append-only 链式记录。
- 影响：在“高可信证据账本”语义下，manifest 可被后写覆盖，削弱不可抵赖性与法证追溯强度。
- 本地证据：`packages/opencode/src/evidence/events.ts:257`、`packages/opencode/src/evidence/events.ts:266`、`packages/opencode/src/evidence/writer.ts:392`。
- 外部映射：E6（结构化、强约束输出思路）支持“fail-closed + 强约束”工程方向；当前 manifest 约束强度不对齐该目标。

#### P0-02：Progress Monotonicity 非持久化，重启后可失真
- 问题：`cycles/stops/degraded` 使用进程内 `Map/Set`，服务重启或多进程场景下单调性与 stop 冻结不可证。
- 影响：长会话恢复时可能出现 cycle 回拨、重复写计划、hard-stop 失效风险。
- 本地证据：`packages/opencode/src/session/orchestrator/writer.ts:50`、`packages/opencode/src/session/orchestrator/writer.ts:52`、`packages/opencode/src/session/orchestrator/writer.ts:60`、`packages/opencode/src/session/orchestrator/writer.ts:163`。
- 外部映射：E8（durable execution 要求 deterministic + replay consistency）直接对应该缺陷。

### P1

#### P1-01：Deterministic Resume Checkpoint 链路在 secure-output 处断开
- 问题：验证调用仍使用 `contextPackId: "unknown"`，无法与 context-pack/anchor 对齐。
- 影响：reference-check 与 claims 验证结果可审计性下降，恢复链语义不完整。
- 本地证据：`packages/opencode/src/secure-output/worker.ts:663`、`packages/opencode/src/session/llm.ts:683`、`packages/opencode/src/session/llm.ts:701`、`packages/opencode/src/session/llm.ts:748`。
- 外部映射：E8（可恢复执行需要稳定 checkpoint identity）。

#### P1-02：DeepSeek 温度/采样策略缺少模型级显式治理
- 问题：已有 reasoning 参数净化，但默认 `temperature/topP` 对 DeepSeek 缺少明确 profile（返回 `undefined`）。
- 影响：结构化输出、长会话稳定性在不同模型/负载下波动，schema 漂移风险提升。
- 本地证据：`packages/opencode/src/provider/transform.ts:50`、`packages/opencode/src/provider/transform.ts:305`。
- 外部映射：E1/E2/E3（DeepSeek 对 thinking/reasoning 参数与 JSON 输出有明确约束；需策略化落地）。

#### P1-03：`orchestrator_v16_deepseek_thinking` 主要停留在 rollout 结构层
- 问题：该标志位在 `processor` 内完成解析与透传，但缺少可见的行为级分支消费和验收指标闭环。
- 影响：配置看似可控，实际收益不可证，容易形成“开关存在但策略未生效”的灰区。
- 本地证据：`packages/opencode/src/session/processor.ts:337`、`packages/opencode/src/session/processor.ts:687`、`packages/opencode/src/session/processor.ts:697`。
- 外部映射：E1（reasoning 模型能力/限制需要工程侧显式策略承接）。

#### P1-04：严格引用门禁主要覆盖 verification intent，默认面未完全收敛
- 问题：strict fail-closed 很强，但依赖 intent 解析；非 strict 路径仍可能出现“看似有引用但未严格校验”的输出。
- 影响：在中长会话中，引用完整性与低幻觉目标出现策略不一致。
- 本地证据：`packages/opencode/src/session/secure-output-contract.ts:76`、`packages/opencode/src/session/reference-check.ts:218`。
- 外部映射：E6（strict schema/strict mode 的价值在于默认收敛不确定性）。

### P2

#### P2-01：Compaction quality 指标偏“覆盖率”，缺少“一致性/矛盾”维度
- 问题：现有 `semantic_coverage/known/unknown` 能度量信息密度，但不能直接衡量事实一致性。
- 影响：压缩质量可观测但不够“真实性导向”，长期会话仍可能积累轻微漂移。
- 本地证据：`packages/opencode/src/session/compaction.ts:630`、`packages/opencode/src/session/compaction.ts:681`。
- 外部映射：E7（长上下文中位置信息利用不稳，需持续做质量门禁升级）。

#### P2-02：长会话稳定性验证以单测/场景测为主，耐久回放压力证据不足
- 问题：已有大量 targeted tests，但跨重启、跨天会话、并发恢复的长期 soak 证据不足。
- 影响：上线后可能暴露慢性稳定性问题（尤其在多实例部署）。
- 本地证据：`packages/opencode/test/session/compaction-structured.test.ts:185`、`packages/opencode/test/session/context-pack-determinism.test.ts:189`。
- 外部映射：E8（durable execution 强调恢复一致性与可重放设计验证）。

#### P2-03：历史审计阻断项虽有大量修复，但“最终 GO 证据包”仍需统一再验收
- 问题：历史审计曾明确 BLOCKED，当前有多个专项回归报告通过，但缺统一门槛复核包。
- 影响：决策层难以一次性判断“是否全面达标”。
- 本地证据：`docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/f4-hq/f4-hq-artifact-audit-report.md:155`、`docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/f4-hq/p4b-compaction-llm-augment-replay-report.md:58`。

---

## DeepSeek Fit Analysis

### 1) 当前架构是否充分利用 DeepSeek 的长上下文与推理能力？
**结论：部分利用（中高），但未达“充分工程化”。**

- 已利用：
  - DeepSeek worker role 路由与模型回退策略已接入：`packages/opencode/src/provider/provider.ts:1196`。
  - reasoning 参数净化与 reasoning lifecycle 清理已落地：`packages/opencode/src/provider/transform.ts:50`、`packages/opencode/src/provider/transform.ts:154`。
  - 配套回归覆盖存在：`packages/opencode/test/session/message-v2.test.ts:681`。
- 未充分：
  - 缺少针对 DeepSeek 的显式采样 profile 与策略实验基线（温度/top_p/top_k/stop 组合）。
  - v16 deepseek thinking 开关策略化不足（更偏 rollout 元数据层）。

### 2) 是否有效抑制 DeepSeek 在结构化输出、长会话中的漂移/幻觉？
**结论：strict 场景抑制有效；全局仍存在策略不对称。**

- 有效机制：
  - strict reference-check fail-closed：`packages/opencode/src/session/reference-check.ts:218`。
  - secure-output 反馈闭环：`packages/opencode/src/secure-output/worker.ts:689`。
  - compaction LLM augment 的 success+verify 才应用、并有 JSON 泄露拦截：`packages/opencode/src/session/compaction.ts:811`、`packages/opencode/src/session/compaction.ts:849`。
- 薄弱区：
  - 非 strict 意图路径与 `contextPackId: unknown` 造成审计链不连续：`packages/opencode/src/secure-output/worker.ts:663`。

### 3) 温度/采样、schema 稳定性、压缩时机、恢复连续性是否有系统性短板？
**结论：存在系统性短板。**

- 温度/采样：P1（缺 profile）
- schema 稳定性：P1（已做 drift normalize，但需要更强统一契约）
- 压缩时机：P2（已有阈值触发，但缺更细粒度策略实验闭环）
- 恢复连续性：P0/P1（单调状态不持久化 + secure-output 上下文链断点）

### 4) 优先级建议（高收益低风险先做 vs 推迟）

**高收益低风险（优先做）**
1. 持久化 progress monotonic ledger（P0）
2. secure-output 传递真实 `contextPackId`（P1）
3. DeepSeek 明确采样 profile + schema strict contract（P1）
4. 把 `v16_deepseek_thinking` 变成可观测行为策略（P1）

**应推迟（中高风险/研究项）**
1. 语义压缩一致性判定（矛盾检测）全面自动化
2. 跨会话长期知识蒸馏型压缩（涉及复杂回归面）
3. 多模型联合裁决（成本与延迟显著上升）

---

## Risk Register

| Risk ID | 风险描述 | 概率 | 影响 | 缓解方案 |
|---|---|---:|---:|---|
| R-001 | manifest 非 append-only 导致证据链被覆盖式更新 | 中 | 高 | 引入 manifest append-log + prev_hash 链 + 读取时完整性校验 fail-closed |
| R-002 | 进程重启后 cycle/stop 丢失引发 replay 不单调 | 高 | 高 | 持久化 progress ledger（CAS）并在 writer 启动时恢复 |
| R-003 | secure-output `contextPackId=unknown` 导致验证审计链断裂 | 中 | 高 | verification task-frame 强制绑定 contextPackId，unknown 直接降级阻断 |
| R-004 | DeepSeek 采样策略不稳定导致 schema 漂移 | 中 | 中-高 | 建立 DeepSeek profile（strict/light）+ A/B 回归指标 |
| R-005 | v16 deepseek thinking 开关仅元数据透传，策略收益不可证 | 中 | 中 | 增加行为分支与事件埋点（命中率/收益/失败率） |
| R-006 | compaction 仅 coverage 指标，无法识别事实冲突 | 中 | 中 | 增加 contradiction_rate / anchor_consistency 指标 |

---

## Improvement Roadmap

### 2周内（Quick Wins）

1. **P0：Progress Monotonicity 持久化**
   - 输出：`progress-ledger/1.1`（持久化文件 + 恢复逻辑 + 断言测试）
   - 验收：重启回放后 cycle 不回拨、stop 不解冻。

2. **P1：secure-output 绑定真实 contextPackId**
   - 输出：verification task-frame 不再出现 unknown。
   - 验收：`unknown_context_pack_ratio = 0`。

3. **P1：DeepSeek strict/light 采样与 schema profile**
   - 输出：按模型与意图设置温度/top_p 策略；保留 reasoning 参数兼容处理。
   - 验收：`schema_degraded_rate` 与 `reference_check.failed_rate` 显著下降。

4. **P1：v16DeepseekThinking 行为化**
   - 输出：至少 1 条真实策略分支 + 对应事件埋点。
   - 验收：能从 evidence events 直接观测分支命中与效果。

### 4-8周（中期重构）

1. **P0：Evidence manifest 升级为 append-only 链式账本**
   - 引入 `prev_hash`、sequence、链完整性校验。

2. **P1：Reference gate 默认面收敛**
   - strict/light 合同升级：关键意图默认 strict 或强提示降级。

3. **P1：Delta Probes 跨模块统一关联**
   - compaction/retrieval/secure-output 使用统一 probe correlation id。

4. **P2：Compaction 质量指标升级**
   - 增加一致性类指标，形成“覆盖+一致性”双轴门禁。

### 长期研究项

1. **可验证 LLM 压缩多视图裁决层**（成本受控）
2. **跨会话记忆蒸馏与长期漂移防护**
3. **低成本事实一致性在线检测器**（与 reference-check 协同）

---

## External Evidence Appendix

> 说明：以下来源通过 chelingxi-mcp（Exa/Tavily）检索；若页面无明确发布日期，标注“未标注（检索于 2026-02-14）”。

- **E1** DeepSeek API Docs - Reasoning Model (`deepseek-reasoner`)  
  链接：<https://api-docs.deepseek.com/guides/reasoning_model>  
  发布日期：未标注（检索于 2026-02-14）  
  映射：支持“reasoning 参数约束、reasoning_content 处理、400 错误语义”的策略约束依据。

- **E2** DeepSeek API Docs - JSON Output  
  链接：<https://api-docs.deepseek.com/guides/json_mode>  
  发布日期：未标注（检索于 2026-02-14）  
  映射：支持“结构化输出需要 response_format + prompt 中包含 json + max_tokens 管控”的契约设计。

- **E3** DeepSeek API Docs - The Temperature Parameter  
  链接：<https://api-docs.deepseek.com/quick_start/parameter_settings>  
  发布日期：未标注（检索于 2026-02-14）  
  映射：支持“不同任务温度建议差异化”的参数治理需求。

- **E4** DeepSeek API Docs - Change Log / Updates  
  链接：<https://api-docs.deepseek.com/updates>  
  发布日期：页面含多次更新记录（例如 2025-12-01、2025-09-29、2025-08-21）  
  映射：说明 DeepSeek API 能力快速演进，要求本地策略可配置、可观测、可回归。

- **E5** DeepSeek-R1 论文（arXiv:2501.12948）  
  链接：<https://arxiv.org/abs/2501.12948>  
  发布日期：2025-01-22  
  映射：支持“推理能力强但工程侧需稳定约束与验证闭环”的模型能力前提。

- **E6** OpenAI - Introducing Structured Outputs in the API  
  链接：<https://openai.com/index/introducing-structured-outputs-in-the-api/>  
  发布日期：2024-08-06  
  映射：支持“strict schema + fail-closed 输出门禁”作为低幻觉工程实践基线。

- **E7** Liu et al., Lost in the Middle (TACL 2024)  
  链接：<https://aclanthology.org/2024.tacl-1.9/>  
  发布日期：2024（TACL 12:157–173）  
  映射：支持“长上下文信息位置敏感、需 compaction + quality gate”的架构必要性。

- **E8** LangGraph Docs - Durable execution  
  链接：<https://docs.langchain.com/oss/python/langgraph/durable-execution>  
  发布日期：未标注（检索于 2026-02-14）  
  映射：支持“deterministic replay + checkpoint + idempotent side-effect”对恢复链的工程要求。

---

## Acceptance Criteria

> 下一轮验收建议以“可量化门槛 + 可审计证据”执行。

1. **Evidence Ledger 完整性**
   - 指标：`manifest_chain_break_count = 0`
   - 指标：`event_append_integrity_fail = 0`

2. **Progress Monotonicity 与恢复连续性**
   - 指标：`cycle_regression_count = 0`（跨重启/跨进程场景）
   - 指标：`stop_state_loss_count = 0`

3. **Deterministic Resume Checkpoint 完整绑定**
   - 指标：`secure_output_unknown_context_pack_ratio = 0`
   - 指标：`anchor_replay_fail_closed_miss = 0`

4. **DeepSeek 结构化稳定性**
   - 指标：`worker_schema_degraded_rate <= 1%`
   - 指标：`reference_check_failed_rate <= 1%`（verification intent 样本）

5. **Compaction 双层质量**
   - 指标：`compaction_quality_event_coverage = 100%`
   - 指标：`assisted_applied_without_verify = 0`
   - 指标：`ui_json_leak_incident = 0`

6. **统一发布门槛**
   - 所有 P0=0；P1 均有 owner、完成验收测试并附 replay 证据包。

---

## 附：与历史审计结论关系

- 历史审计报告曾给出 `BLOCKED`：`docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/f4-hq/f4-hq-artifact-audit-report.md:155`。
- 本轮结论：体系已显著增强（尤其 compaction 双层与 strict gate），但仍因 P0 架构项未闭环而 **继续 BLOCKED**。
