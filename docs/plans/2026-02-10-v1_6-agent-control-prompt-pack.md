# V1.6 执行 AI 总控指令包（D1 可直接开跑）

> 日期：2026-02-10
> 作用：把已定版决策稿转成可执行、可验收、可回滚的 6 代理并行执行
> 说明：本阶段只做阻断补证与执行治理，不做业务代码改造

## 1) 这套指令“跑什么”

- 跑的是 **P0-A 阻断补证任务 + I 前5补证任务**，不是功能开发冲刺。
- 目标是把“设计正确”变成“执行可验证”：每张卡必须产出证据，并可签收。

核心输入文档：
- `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/2026-02-10-v1_6-final-collab-architecture-decision.md`
- `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/2026-02-10-v1_6-blocking-execution-cards.md`

## 2) 一次发给“总控代理”的母 Prompt（推荐）

```text
你是 V1.6 阻断执行的总控代理（Evidence-first）。

【目标】
在今天内启动 6 个执行代理，分别承接 CARD-BLK-01~06，并建立日报与签收节奏。

【必须读取】
1) /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/2026-02-10-v1_6-final-collab-architecture-decision.md
2) /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/2026-02-10-v1_6-blocking-execution-cards.md
3) /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/2026-02-10-v1_6-d1-kickoff-runbook.md
4) /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/templates/2026-02-10-v1_6-blocking-daily-template.md

【角色分配（固定，不得重叠）】
- Exec-AI-SECURE  -> CARD-BLK-01
- Exec-AI-ORCH    -> CARD-BLK-02
- Exec-AI-RETRIEVAL -> CARD-BLK-03
- Exec-AI-SESSION -> CARD-BLK-04
- Exec-AI-WORKER  -> CARD-BLK-05
- Exec-AI-PMO     -> CARD-BLK-06

【硬约束】
- 不扩题到 P1/P2 实现。
- 不改阈值，不改决策口径。
- 不执行高风险命令（删除/reset/rebase/clean/force push/sudo/chmod -R/chown -R）。
- 当前阶段不改业务代码；只允许文档、证据、回放与分析产物。

【统一输出契约】
每个代理输出必须包含：
1) 当前结论
2) 证据路径（绝对路径）
3) 未覆盖风险
4) 下一步
5) Need-Decision（若有）

【总控交付】
- 生成一份 D1 启动结果：每卡 Owner/ETA/DoD/EvidencePath/RollbackAction 是否齐备。
- 生成今日日报（使用模板），并给出总状态 Green/Yellow/Red。
- 若任一卡字段缺失，标记“阻断未解除”。
```

## 3) 如果你要“直接发给 6 个执行代理”的广播 Prompt

> 用法：复制同一段发给 6 个代理，但每个代理首行 ROLE 不同。

```text
ROLE=<Exec-AI-SECURE|Exec-AI-ORCH|Exec-AI-RETRIEVAL|Exec-AI-SESSION|Exec-AI-WORKER|Exec-AI-PMO>

你是 V1.6 阻断执行代理，按 ROLE 只处理对应卡片，禁止跨卡。

【读取】
- /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/2026-02-10-v1_6-final-collab-architecture-decision.md
- /Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/2026-02-10-v1_6-blocking-execution-cards.md

【卡片映射】
- Exec-AI-SECURE -> CARD-BLK-01
- Exec-AI-ORCH -> CARD-BLK-02
- Exec-AI-RETRIEVAL -> CARD-BLK-03
- Exec-AI-SESSION -> CARD-BLK-04
- Exec-AI-WORKER -> CARD-BLK-05
- Exec-AI-PMO -> CARD-BLK-06

【硬约束】
- 不扩题到 P1/P2，不改阈值，不改口径。
- 不做高风险命令。
- 本阶段不改业务代码；只产出证据与执行文档。

【输出格式】
1) Card
2) 今日完成
3) 证据路径（绝对路径）
4) DoD 达成情况（达成/未达成）
5) Blocked
6) Risk
7) Need-Decision
8) 明日计划
```

## 4) D1 结束的通过标准

- 6 张卡都有产物路径，且与卡片 DoD 对齐。
- CARD-BLK-06 完成执行看板并收齐字段。
- 日报已产出且总状态可解释。
- 任一卡字段缺失则 D1 不通过（保持 Yellow）。
