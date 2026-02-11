# V1.6 阻断项执行卡（定版会后 24h 内启动）

> 日期：2026-02-10
> 范围：仅覆盖定版会拍板的阻断项（P0 阻断 + I 前 5 补证）
> 原则：Evidence-first；先补证再改造；未满足 DoD 不进入 Stage1

## 0. 使用规则

- 每张卡必须包含：`Owner + DoD + EvidencePath + ETA + RollbackAction`。
- 交付物统一落盘到：`docs/plans/evidence/2026-02-10-v1_6-blocking/`。
- 会后 24 小时内必须补齐实名 Owner（本版先给执行AI代理 Owner）；未补齐视为阻断未解除。
- 本文档是执行计划，不替代决策稿；阈值和门禁以决策稿为准。
- D1 启动会脚本：`docs/plans/2026-02-10-v1_6-d1-kickoff-runbook.md`。
- 每日报告模板：`docs/plans/templates/2026-02-10-v1_6-blocking-daily-template.md`。

## 1) CARD-BLK-01：secure-output 失配分层（I.1）

- Owner：`Exec-AI-SECURE`（首责） + 应用层负责人（签收）
- ETA：T+2 天
- 目标：区分“合同到达率”与“合同遵守率”，形成可量化根因。
- 输入证据：
  - `packages/opencode/src/session/llm.ts:111`
  - `packages/opencode/src/session/llm.ts:139`
  - `packages/opencode/src/session/llm.ts:697`
  - `packages/opencode/src/secure-output/worker.ts:110`
- 执行任务：
  1. 定义 snapshot 字段：`prompt_hash`、`contract_present`、`claims_block_present`、`degrade_reason`。
  2. 设计对账脚本（message 级），输出“到达率/遵守率”分层统计。
  3. 用最近 20 条失败样本回放，生成分层结果。
- DoD：
  - 产出 `contract_delivery_vs_compliance.md`，含分层结论和样本明细。
  - 可回答“主要失配发生在到达链路还是遵守链路”。
- EvidencePath：
  - `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-01/`
- RollbackAction：
  - 若分层统计不收敛，冻结相关修复上线，只保留观测埋点。

## 2) CARD-BLK-02：message 级重复 planned 根因（I.3）

- Owner：`Exec-AI-ORCH`（首责） + orchestrator 负责人（签收）
- ETA：T+2 天
- 目标：确认重复 planned 来源（外层触发 / 协议重入 / 预算回跳）。
- 输入证据：
  - `packages/opencode/src/session/orchestrator/index.ts:424`
  - `docs/plans/2026-02-10-v1_6-worker-collab-diagnostic-report.md:68`
- 执行任务：
  1. 定义 message 生命周期 trace 字段：`messageId`、`planId`、`cycle`、`trigger_source`。
  2. 合并同 message 全链路事件，生成序列图。
  3. 标注 10 条重复样本的首因分布。
- DoD：
  - 产出 `planned-repeat-root-cause.md` + `planned-repeat-samples.json`。
  - 给出“首要根因 Top1 + 占比”。
- EvidencePath：
  - `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-02/`
- RollbackAction：
  - 若根因不明确，不推进 breaker 参数收紧，只做观测增强。

## 3) CARD-BLK-03：topK 噪声构成标注（I.2）

- Owner：`Exec-AI-RETRIEVAL`（首责） + retrieval 负责人（签收）
- ETA：T+3 天
- 目标：给出 topK 中“正文/路径/无效”比例，支持 rerank 策略决策。
- 输入证据：
  - `packages/opencode/src/retrieval/code.ts:125`
  - `packages/opencode/src/retrieval/runner.ts:696`
- 执行任务：
  1. 抽样 50 条 hits（覆盖 code/workbench/tree 三类来源）。
  2. 人工标注类别：`snippet_valid` / `path_noise` / `invalid`。
  3. 输出按来源和 rank 的噪声分布。
- DoD：
  - 产出 `topk-noise-breakdown.md` + `topk-noise-labeled.csv`。
  - 明确是否达到“需立即调整 topK/rerank”的触发条件。
- EvidencePath：
  - `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-03/`
- RollbackAction：
  - 若样本一致性不足（标注冲突 > 15%），扩样到 80 条后再决策。

## 4) CARD-BLK-04：pointerContextOS 开关有效性（I.4）

- Owner：`Exec-AI-SESSION`（首责） + session/processor 负责人（签收）
- ETA：T+2 天
- 目标：确认开关当前是否真正影响运行行为。
- 输入证据：
  - `packages/opencode/src/session/processor.ts:658`
  - `packages/opencode/src/session/orchestrator/index.ts:385`
- 执行任务：
  1. 设计 A/B 回放（开/关）同样本 20 条。
  2. 比较 pointer 命中率、最终 claim 可验证率、rerun 次数。
  3. 输出开关有效性结论（有效/无效/不稳定）。
- DoD：
  - 产出 `pointerContextOS-ab-report.md`，含显著性判断。
- EvidencePath：
  - `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-04/`
- RollbackAction：
  - 若无效，开关相关任务降级为 P1，避免误投开发量。

## 5) CARD-BLK-05：patch_planner lift 实证（I.5）

- Owner：`Exec-AI-WORKER`（首责） + worker 协作负责人（签收）
- ETA：T+4 天
- 目标：量化 patch_planner 对复杂写入任务的真实增益。
- 输入证据：
  - `packages/opencode/src/session/orchestrator/workers/patch-planner.ts:11`
- 执行任务：
  1. 建立 30 条 heavy 写入任务对照集（有/无 patch_planner）。
  2. 比较 `task_success`、`rerun_count`、`secure_output_pass_rate`。
  3. 计算 lift 与置信区间。
- DoD：
  - 产出 `patch-planner-lift-report.md` + 原始对照数据。
  - 给出“保留为 heavy 常驻/条件启用/降级”的建议结论。
- EvidencePath：
  - `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-05/`
- RollbackAction：
  - 若 lift 不显著，暂不提升 patch_planner 权重。

## 6) CARD-BLK-06：阻断项任务卡化与签收（执行治理）

- Owner：`Exec-AI-PMO`（首责） + 架构总控（签收）
- ETA：T+1 天
- 目标：把阻断项从“文档结论”转成“可追责执行卡”。
- 输入证据：
  - `docs/plans/2026-02-10-v1_6-final-collab-architecture-decision.md:597`
- 执行任务：
  1. 为 `P0-A1 ~ P0-A8` 与 `P0-B1 ~ P0-B5` 补齐实名 Owner、ETA、DoD、EvidencePath。
  2. 建立每日报告模板：`Done/Blocked/Risk/Need-Decision`。
  3. 设立阻断解除条件清单（逐项签收）。
- DoD：
  - 产出 `blocking-execution-board.md`（含全部签收字段）。
  - 任一项字段缺失则标记“阻断未解除”。
- EvidencePath：
  - `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/`
- RollbackAction：
  - 若 T+1 未完成卡化，暂停进入任何灰度准备动作。

## 7. 交付节奏（建议）

- D1：CARD-BLK-06 + CARD-BLK-01 启动
- D2：CARD-BLK-02、CARD-BLK-04
- D3：CARD-BLK-03
- D4：CARD-BLK-05
- D5：阻断复盘会（只审 DoD 与证据产物）


## 8. 给执行 AI 代理的使用方式

- 先读本文件，再读决策稿：`docs/plans/2026-02-10-v1_6-final-collab-architecture-decision.md`。
- 每个代理一次只接一张卡，禁止跨卡并行改口径。
- 代理输出必须包含：`结论 + 证据路径 + 未覆盖风险 + 下一步`。
- 若遇到“口径冲突”，先在卡内记录 `Need-Decision`，不得自行改阈值。

