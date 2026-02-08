# V1.6 能力提升共创草案（主脑 + 小脑，单 Session）

> 状态：Draft（共创中）
> 日期：2026-02-08
> 分支基线：feature/opencode-custom

## 1. 背景与目标

基于 V1 / V1.5 已落地能力，V1.6 的核心目标是：

- 在 **单 Session** 内实现“主脑 + 2~3 小脑 + 工具代理 + 证据链 + 缓存 + 门控 + 回放”的可商用品质闭环。
- 在 **DeepSeek 128K + 无微调** 前提下，通过工程编排达到“弱模型可商用”。
- 同时提升：
  - 成功率（任务完成率）
  - 能力上限（复杂任务处理能力）
  - 质量稳定性（幻觉控制与可解释性）

## 2. 当前现状（V1.5 基线）

- 角色层面已具备 3 个小脑角色：
  - evidence_critic
  - retrieval_planner
  - patch_planner
- 现状能力：
  - evidence_critic 已走 LLM 路径
  - retrieval_planner / patch_planner 当前以规则路径为主
- 管控层：
  - 有 orchestrator rollout、claim graph gate、dual-pass、offline-eval gates
- 可观测层：
  - 有 worker lifecycle 事件链路，但 TUI/GUI 显示稳定性与用户可理解表达仍需增强

## 3. V1.6 设计原则（共创初版）

1. **质量先于花哨**：不牺牲可信度换取“看起来更聪明”。
2. **动态算力分配**：不是永远 3 小脑全开，而是按风险/复杂度弹性启用。
3. **证据优先**：输出必须可追溯，unknown-first 优先于臆断。
4. **可回放可审计**：每轮决策与降级都有证据事件与工件。
5. **用户可理解**：界面展示用任务语言，不暴露工程内部术语与敏感信息。

## 4. V1.6 目标架构（草案）

### 4.1 双环控制（Control Loop）

- 外环（策略环）：决定启用几颗小脑、预算多少 token/time、是否进入双阶段。
- 内环（质量环）：对主脑草稿做证据审查、冲突检测、降级回退。

### 4.2 三层托举

- 规划层（retrieval_planner / patch_planner）：生成检索与行动策略。
- 审查层（evidence_critic + claim gate）：验证证据覆盖与风险。
- 执行层（tool broker + runner）：执行检索/工具并回填证据指针。

### 4.3 触发器升级方向

从“规则命中”升级到“评分触发器”：

- risk_score
- uncertainty_score
- complexity_score
- tool_need_score
- latency_budget

输出：chat / assist / heavy / fork + worker 组合 + 预算。

## 5. V1.6 关键能力增量（候选）

1. 三小脑全面支持 LLM 路径（保留规则回退）
2. 触发器从规则切换为评分策略
3. worker 预算控制器（早停、降级、限流）
4. claim-level 证据覆盖率评分（而非仅 turn 级）
5. 输出质量门统一化（可交付判定 + 可解释降级）
6. 多轮会话记忆蒸馏（短期事实缓存 + 证据锚点）

## 6. 指标体系（北极星）

- unsupported_claim_rate（越低越好）
- unknown_precision（该说不知道时，必须准确）
- task_completion（复杂任务完成率）
- cost_per_success（单成功任务成本）
- p95_latency（用户体感时延）

> 目标：在不显著恶化 p95 latency 与 cost_per_success 前提下，提高 task_completion 与 quality 指标。

## 7. 里程碑建议（草案）

- M1：可观测稳定化（TUI/GUI 小脑过程稳定可见，安全脱敏）
- M2：三小脑 LLM 化 + 回退策略
- M3：评分触发器 + 动态预算控制
- M4：质量门升级 + offline/online 双评测闭环
- M5：灰度上线与参数自动调优

## 8. 风险与防线

- 风险：小脑全开导致成本与时延上升
  - 防线：分级启用、动态预算、早停
- 风险：更多 LLM 路径引入不稳定
  - 防线：规则回退 + claim gate + degraded policy
- 风险：可观测泄密
  - 防线：UI 白名单字段 + 脱敏策略 + reason code 替代原始异常

## 9. 待共创决策（下一轮）

1. 三小脑默认策略：balanced 是否默认 2 脑，high-risk 才 3 脑？
2. 评分触发器初始阈值与可调参数清单
3. 主脑/小脑 token 配额分配比例
4. online A/B 试验分流策略与回滚开关
5. V1.6 发布门禁阈值（硬门槛）

---

该文档为 V1.6 共创起点，后续将结合设计代理方案做合并收敛。
