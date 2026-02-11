# V1.6 D1 启动会 Runbook（45 分钟）

> 日期：2026-02-10
> 目的：启动阻断卡执行，确保 7 天止损目标可落地
> 会议范围：仅 `P0-A 阻断` + `I 前5补证`

## 1. 会前准备（5 分钟）

- 材料：
  - `docs/plans/2026-02-10-v1_6-final-collab-architecture-decision.md`
  - `docs/plans/2026-02-10-v1_6-blocking-execution-cards.md`
- 角色：主持人、架构签收人、6 个执行 Owner（可由 AI 代理承接）
- 输出目录：`docs/plans/evidence/2026-02-10-v1_6-blocking/`

## 2. 会议流程（45 分钟）

1) 0-5 分钟：主持人重申硬约束
- 不扩题到 P1/P2
- 不改阈值
- 未满足 DoD 不解除阻断

2) 5-20 分钟：逐卡确认（CARD-BLK-01 ~ 05）
- 每卡只回答 4 件事：
  - 首责 Owner 是否确认
  - DoD 是否可测
  - EvidencePath 是否可写
  - ETA 是否现实

3) 20-30 分钟：治理卡确认（CARD-BLK-06）
- 锁定日报格式
- 锁定签收机制
- 锁定 Need-Decision 升级路径

4) 30-40 分钟：风险盘点
- 每卡 1 条最大风险
- 对应 rollback 是否可执行

5) 40-45 分钟：会后动作
- 发布 D1 指令
- 启动 CARD-BLK-06 + CARD-BLK-01

## 3. 会后立即下发的执行 AI Prompt（可直接复制）

### Prompt-A（Exec-AI-PMO / CARD-BLK-06）

你是执行治理代理。只处理 CARD-BLK-06。
目标：24小时内把 P0-A 与 I前5补证全部任务卡化。
强约束：
1) 输出必须包含 `Owner/DoD/EvidencePath/ETA/RollbackAction`；
2) 不得改动阈值，不得改决策口径；
3) 若信息不足，先列 Need-Decision 再继续可执行部分。
交付：
- blocking-execution-board.md
- 每日跟踪表（Done/Blocked/Risk/Need-Decision）
- 阻断解除检查表

### Prompt-B（Exec-AI-SECURE / CARD-BLK-01）

你是 secure-output 分层补证代理。只处理 CARD-BLK-01。
目标：区分合同到达率与合同遵守率。
证据锚点：
- packages/opencode/src/session/llm.ts:111,139,697
- packages/opencode/src/secure-output/worker.ts:110
输出：
- contract_delivery_vs_compliance.md
- 20条失败样本对账清单
- 结论：主因在“到达链路”还是“遵守链路”

### Prompt-C（Exec-AI-ORCH / CARD-BLK-02）

你是 orchestrator 根因代理。只处理 CARD-BLK-02。
目标：定位 message 级重复 planned 的主因。
输出：
- planned-repeat-root-cause.md
- planned-repeat-samples.json
- Top1 根因占比 + 复现条件

### Prompt-D（Exec-AI-RETRIEVAL / CARD-BLK-03）

你是 retrieval 标注代理。只处理 CARD-BLK-03。
目标：完成 50 条 topK 噪声构成标注。
输出：
- topk-noise-labeled.csv
- topk-noise-breakdown.md
- 是否触发“立即改 rerank/topK”的建议

### Prompt-E（Exec-AI-SESSION / CARD-BLK-04）

你是 session 开关验证代理。只处理 CARD-BLK-04。
目标：验证 pointerContextOS 开关是否真实生效。
输出：
- pointerContextOS-ab-report.md
- A/B 对照结果与显著性判断

### Prompt-F（Exec-AI-WORKER / CARD-BLK-05）

你是 worker 增益评估代理。只处理 CARD-BLK-05。
目标：量化 patch_planner 对复杂写入任务的 lift。
输出：
- patch-planner-lift-report.md
- 30 条任务对照数据
- 建议：常驻 / 条件启用 / 降级

## 4. 启动会判定标准

- 通过：6 张卡均有 Owner、ETA、DoD、EvidencePath、RollbackAction。
- 不通过：任一卡字段缺失或 DoD 不可验证。
