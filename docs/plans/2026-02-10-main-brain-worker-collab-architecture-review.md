# 单 Session 主脑 + 2~3 小脑协作深度评审（架构评审官 + LLM Agent 系统优化顾问）

- 日期：2026-02-10
- 评审范围：
  - `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/2026-01-25-opencode-sandbox-context-design.md`
  - `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/2026-02-10-v1_6-worker-collab-diagnostic-report.md`
  - 相关实现代码（orchestrator / workers / retrieval / secure-output）
- 评审目标：判断 `retrieval_planner / evidence_critic / patch_planner` 是否真正托举主脑，并给出可落地改造方案。

---

## A. 当前系统一页图（文字版）

```text
用户请求
  -> (Prompt层) 首轮可触发 RoutingRunner(A/B/C) 注入 <routing> 指针
  -> (Processor层) prepareOrchestratorPlan -> runOrchestratorTurn
       -> 并行 workers: retrieval_planner / evidence_critic / patch_planner(按模式)
       -> tool broker 执行 retrieval
       -> critic 带 pointers 重跑
       -> renderInjection 组装 <orchestrator> -> dual-pass 判定
  -> 主脑 LLM.stream
       -> 同时还有一条独立 runRetrieval() 上下文检索链
  -> secure_output 守卫（要求 assistant_claims_json）
```

### 1) 当前架构的事实性复述（非泛化）

- Orchestrator 仅在 `build` agent + primary mode + assist/heavy 时运行；否则不启 worker。
  - 代码：`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/packages/opencode/src/session/processor.ts:609`
  - 代码：`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/packages/opencode/src/session/orchestrator/index.ts:375`

- 当前 worker 调度为并行执行，role pack 统一注入 `planPointer/policy/budget/workingSet.pointers`。
  - 代码：`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/packages/opencode/src/session/orchestrator/index.ts:393`
  - 代码：`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/packages/opencode/src/session/orchestrator/index.ts:125`

- worker 提示词目前均为极短单句，输出为 `llm-worker-result/1.0` 的 notes/toolRequests。
  - 代码：`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/packages/opencode/src/session/orchestrator/workers/retrieval-planner.ts:133`
  - 代码：`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/packages/opencode/src/session/orchestrator/workers/evidence-critic.ts:134`
  - 代码：`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/packages/opencode/src/session/orchestrator/workers/patch-planner.ts:186`

- Broker 会将每个 toolRequest 产物化为 `tool-broker-pointer`，并回传 `artifacts + topK` 指针。
  - 代码：`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/packages/opencode/src/session/orchestrator/tool-broker.ts:75`

- Critic 在初次 degraded 后可重跑，并将 broker 指针回灌进 working set。
  - 代码：`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/packages/opencode/src/session/orchestrator/index.ts:309`

- 注入到主脑的 orchestrator 文本会被强裁剪（notes 2 条 + pointers 3 条）。
  - 代码：`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/packages/opencode/src/session/orchestrator/index.ts:215`

- 最终输出会经过 secure-output 守卫，缺少 `<assistant_claims_json>` 会直接降级。
  - 代码：`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/packages/opencode/src/secure-output/worker.ts:110`

### 2) 小脑增强主脑的正向链路（有证据）

1. 能触发：真实回放显示 worker 启动、执行、重跑都发生。
2. 能回注：`<orchestrator>` 注入确实进入主脑 system。
3. 能审查：dual-pass 与 secure-output 两级守卫都在运行。
4. 能观测：存在 `orchestrator.worker.lifecycle` 事件与 `tool-broker-pointer` 产物。

### 3) 小脑削弱主脑的负向链路（有证据）

1. 入口退化：空 pointers 时 retrieval/critic 都会回退到 `planPointer` 字符串检索。
2. 中段失真：topK 里常混入路径/文件名噪声，正文证据不足。
3. 注入压缩：主脑得到的是“状态摘要”而非“可判定证据摘要”。
4. 末端断层：主脑未稳定给出 claims block，secure-output 再次降级。

---

## B. Top 10 问题清单（表格）

| 优先级 | 问题 | 根因 | 用户可见症状 | 影响（质量/成本/时延） |
|---|---|---|---|---|
| P0 | 检索 query 语义退化 | 空 pointers 时强制回落 `planPointer` 字符串，缺结构化检索意图 | 小脑有动作但命中不聚焦，主脑回答泛化 | 质量↓↓ / 成本↑ / 时延↑ |
| P0 | topK 证据密度低 | code retrieval 无命中时会塞 tree 路径，最终 topK 只取前 5 | critic 看到路径与文件头，难以做判定 | 质量↓↓ / 成本↑ / 时延↑ |
| P0 | critic 缺“可判定证据块”输入契约 | 仅依赖 pointers；补料是 preview 级，不保证命中条款正文 | 反复 `evidence missing`，重跑后仍 degraded | 质量↓↓ / 成本↑↑ / 时延↑↑ |
| P0 | secure-output 合同与主模型提示存在断层 | `SecureOutputContract` 参与 block 构建但未稳定出现在发给模型的 system 列表 | 最终常缺 `<assistant_claims_json>`，守卫降级 | 质量↓↓ / 成本↑ / 时延↑ |
| P1 | 同轮多检索链重叠 | routing 注入 + orchestrator broker + LLM.stream 自检索并存 | TUI 观感“循环思考”，重复检索明显 | 质量↓ / 成本↑↑ / 时延↑↑ |
| P1 | 重跑控制半失效 | `bounceMax` 存在，但 `cycle` 常固定为 1；消息级幂等不足 | 同 message 出现多轮 planned/requested | 质量↓ / 成本↑↑ / 时延↑↑ |
| P1 | 注入过度压缩 | `renderInjection` 固定裁剪 2 notes + 3 pointers | 主脑只见状态不见证据，增强收益偏低 | 质量↓↓ / 成本≈ / 时延≈ |
| P1 | 注入被路由调试词污染 | `from_model/to_model/gate_reason` 会占用 notes 预算 | 主脑读到噪音 token，证据 token 被挤占 | 质量↓ / 成本≈ / 时延≈ |
| P2 | 观测“有原始数据，缺汇总视图” | lifecycle 与 pointer artifacts 已有，但无 message 级摘要件 | 排障仍需手工拼日志 | 质量间接↓ / 运维成本↑ / 排障时延↑ |
| P2 | `pointerContextOS` 开关语义未生效 | 传 `undefined` 仍被 `?? []` 归零，开关收益被吞 | 开关打开后体感无差异 | 质量↓ / 成本≈ / 时延≈ |

---

## C. 三套方案对比（表格）

| 维度 | 保守方案（2周） | 均衡方案（推荐，4周） | 激进方案（6~10周） |
|---|---|---|---|
| 核心思路 | 只修 P0：query、topK、secure-output 断层 | 建立 `Evidence Contract v2`，重构输入输出与注入策略 | 改成多跳 agentic state machine |
| 主要动作 | 结构化 query 最小化 + 注入最小修复 | 结构化检索协议 + critic 结构化判定 + 链路收敛 + 指标闭环 | planner/critic/retrieval 自动多跳与自反馈 |
| 预期收益 | 快速止损，增强率明显提升 | 质量/成本/时延三者综合最优，利于持续演进 | 上限最高，复杂任务能力最强 |
| 风险 | 治标偏多，天花板仍低 | 需调整协议与回放门禁 | 编排复杂、时延与调参成本高 |
| 实施成本 | 低~中 | 中 | 高 |
| 回归风险 | 低 | 中 | 高 |

---

## D. 推荐方案与里程碑

### 推荐方案

推荐 **均衡方案（Evidence Contract v2）**：

- 能在 7 天内给出可见收益（止损）。
- 能在 30 天内形成稳定、可观测、可回归的协作闭环。
- 能保持现有单 Session 架构，不引入过重编排复杂度。

### 7 天可落地（先止损）

1. 将 secure-output 合同稳定并入“实际发给模型”的 system 前缀。
2. `retrieval_planner` 输出升级为结构化 `queries[]/filters[]/expected_evidence[]`。
3. retrieval 排序增加“正文优先”，路径型片段不占主槽位。
4. `evidence_critic` 输出固定：`sufficient/insufficient + missing_paths + conflict_pairs + confidence`。
5. 注入模板改为“证据块优先”（至少 1 条正文证据摘要 + pointer）。
6. 新增 `worker-turn-summary.json`（每 message 一份）。
7. 用诊断同类回放验证 5 个核心指标，达标后灰度。

### 30 天可落地（做强闭环）

1. 收敛检索入口：orchestrator 成为证据主链，其余检索链改为补偿链。
2. 增加消息级重跑预算器（次数上限 + breaker）。
3. 建立统一观测面板：worker lifecycle + broker pointer + secure_output + replay。
4. 完成多层提示词模板化与版本治理（role/constraint/output/eval）。
5. 上线离线回放 + 线上灰度门禁 + 自动回滚阈值。

---

## E. 可执行任务清单（按优先级）

### P0（必须先做）

1. 修复 secure-output 合同注入链路（主模型系统提示必须可见）。
2. 定义并落地 `ToolRequestV2`（结构化 query）。
3. 改造 retrieval ranking：正文证据优先，路径噪声降权。
4. 改造 critic 输出为强结构化（禁止只返回自然语言 note）。
5. 改造注入模板：证据摘要优先而非状态摘要优先。

### P1（建议尽快）

6. 新增 `worker-turn-summary.json` 聚合件（输入/输出/注入/守卫摘要）。
7. 增加 message 级重跑预算器（`planned/requested` 上限 + breaker）。
8. 收敛多检索链并发，避免同轮重复检索。
9. 修复 `pointerContextOS` 开关语义。
10. 将核心指标计算落盘为 artifacts/events，接入看板。

### P2（体系化）

11. 建立回放样本集与黄金标准（至少 20~50 样本）。
12. 将回放门禁接入 CI（夜间与预发布）。
13. 更新设计文档与实现契约，消除口径漂移。

---

## F. 风险与回滚策略

| 风险 | 说明 | 缓解策略 | 回滚策略 |
|---|---|---|---|
| Token 膨胀 | 正文片段注入后 token 上升 | snippet 字数/条数硬上限，预算裁剪 | 开关切回 pointer-only 注入 |
| 结构化解析失败 | 新协议初期可能出现 parse fail | V1/V2 双协议兼容读取 | 失败时回退旧字符串检索路径 |
| 召回下降 | 收敛检索链后可能漏召回 | 保留补偿检索链（仅 critic=insufficient 时触发） | 灰度快速回切旧链路 |
| 指标抖动 | 灰度期易出现短期波动 | 设保护阈值 + 观察窗口 | 超阈值自动回滚 feature flag |
| 历史回放不兼容 | 老产物与新协议不一致 | 双版本 parser + 迁移脚本 | 先只在新会话开启 v2 |

建议硬阈值（灰度期）：

- `critic_degraded_rate` 恶化 > 5pp：回滚
- `secure_output_pass_rate` 下降 > 3pp：回滚
- `rerun_count_per_message` > 2 持续 24h：回滚

---

## G. 你希望我们补充的证据清单（如果信息不足）

1. 诊断报告引用的真实会话 artifacts 打包（当前仓库内未完整可读）。
2. 回放当时的有效配置快照（rollout/cache/timeout 等）。
3. `hits.json` 人工标注样本（正文命中 vs 路径噪声）。
4. 线上真实用户样本（至少 30 条）用于验证增强体感。
5. 关键 message 的完整事件时间线（包含 traceId 关联）。

---

## 诊断报告与代码实现的冲突点（需复核）

1. **关于“观测不足”的表述存在半冲突**
   - 报告认为缺可观测性；代码层已有 `orchestrator.worker.lifecycle` + `tool-broker-pointer`。
   - 结论：不是“无观测”，而是“缺 message 级聚合视图”。

2. **设计稿 A/B/C worker 契约 与 当前 orchestrator worker 栈并行存在**
   - 设计稿强调 routing A/B/C；当前主协作路径是 retrieval/critic/patch。
   - 结论：存在双栈并存与职责重叠，需明确“谁是证据主链”。

3. **预算默认值口径漂移**
   - 设计稿建议 `maxWallClockMs=15000 / workerTimeoutMs=8000 / topK=20`。
   - 当前实现出现 `maxWallClockMs=8000`、worker timeout 默认 12000、最终 topK 取 5。
   - 结论：需统一口径并在配置与文档中同步。

4. **secure-output 断层根因需复核**
   - 报告归因为协作层衔接不完整；代码显示更直接问题是 contract 可能未进入实际 system 消息。
   - 结论：优先复核 system 拼装链路，再谈协作层抽象问题。

---

## 量化指标体系（可监控定义）

| 指标 | 计算公式 | 数据来源 | 建议目标 |
|---|---|---|---|
| 小脑增强有效率 `worker_lift_rate` | `worker触发且critic=ok且注入含有效正文证据且secure_output=completed` / `worker触发消息数` | lifecycle + pointer + secure_output events | > 70% |
| critic 降级率 `critic_degraded_rate` | `evidence_critic(degraded)` / `evidence_critic(total)` | `orchestrator.worker.lifecycle` | < 15% |
| 有效证据占比 `useful_pointer_rate` | `正文型pointer` / `回注pointer总数` | pointer artifacts + hits | > 80% |
| 重跑次数 `rerun_count_per_message` | `orchestrator.planned(message)` - 1 | events | <= 2 |
| 最终守卫通过率 `secure_output_pass_rate` | `secure_output.completed` / `(completed + degraded)` | secure_output events | > 95% |

---

## 验证计划（测试矩阵）

| 测试层级 | 验证内容 | 验收标准 |
|---|---|---|
| 单测 | structured query schema、topK 去噪、critic 输出 schema、claims 合同注入 | schema 全过；路径噪声不进主槽位；claims block 可见 |
| 集成 | planner -> broker -> critic -> inject -> secure_output 全链路 | 有正文证据时 critic 不降级；注入含可判定证据 |
| 真实回放 | 诊断同类任务 + 20 条样本回放 | 5 核心指标达到阈值或显著改善 |
| 线上灰度 | 10% -> 50% -> 100% 分批放量 | 指标恶化触发自动回滚 |

---

## 新的小脑职责边界与提示词策略（建议）

### 职责边界

- `retrieval_planner`：仅负责“找什么证据”（结构化检索意图），不做最终结论。
- `evidence_critic`：仅负责“证据充分性/冲突审查”，输出机器可消费结构。
- `patch_planner`：仅在写入路径启用，输出策略与回滚点，不下执行命令。
- 主脑：只负责最终结论表达，必须消费 critic 结构化结果。

### 提示词策略（多层模板）

建议采用四层模板并版本化：

1. Role 层：角色边界与禁区。
2. Constraint 层：预算、禁止项、降级规则。
3. Output 层：严格 JSON schema 与字段语义。
4. Eval 层：成功判据 + 失败判据 + 重跑准入。

并为每层保留 `prompt_version`，便于回放对账与灰度。

---

## 结论

当前 two/three workers **确实参与并能托举主脑**，但托举效果被三件事显著削弱：

1. 检索入口语义不足（query 退化）；
2. 证据载荷低密度（topK 噪声化）；
3. 输出守卫断层（claims contract 未稳定闭环）。

因此优先级应是：

- 先把“证据载荷质量 + 结构化协作协议 + 守卫闭环”做实；
- 再讨论更复杂编排与模型策略。

这会直接把小脑从“状态噪音源”升级为“主脑的证据放大器”。

