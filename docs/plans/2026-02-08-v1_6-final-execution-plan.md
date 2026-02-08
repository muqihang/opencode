# V1.6 单 Session 主脑+小脑落地 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 `feature/opencode-custom` 上将 V1.6 最终设计完整落地：实现可观测稳定、三小脑 LLM 化、评分触发、DeepSeek thinking/tool/caching 深度利用、并达到上线门禁。

**Architecture:** 采用“方案 B（指挥家）”作为默认主线：单 Session 内主脑 + 3 小脑，按评分动态触发，证据链与 claim gate 统一门控。实现路径按 M1~M5 分波推进，每波先测试后实现（TDD），每波合并前后执行严格门禁与可回滚验证。

**Tech Stack:** TypeScript, Bun, Zod, AI SDK, SolidJS, Git worktree, CI (`.github/workflows/test.yml`), DeepSeek API (thinking/tool calls/kv cache).

---

## 0. 执行约束（执行代理必须遵守）

- 主线固定：`feature/opencode-custom`。
- 并行上限：最多 3 路子代理。
- 每条子线必须：
  - 文件所有权隔离（禁止越权改文件）。
  - 先 RED 后 GREEN（先写失败测试，再实现）。
  - 提交信息必须中文。
  - 汇报格式固定：`Completed / Files / Tests / Risks / Questions`。
- 禁止高风险操作（需人类确认后才能执行）：删除文件/目录、`git reset/clean/rebase/checkout --/restore`、`--force push`、`sudo/chmod -R/chown -R`。
- 禁止改写历史；主协调仅允许 `merge --no-ff`。
- 若出现外部依赖阻塞，立即输出“最小阻塞包”（原因 + 人类步骤 + 恢复命令）。

---

## 1. 里程碑与分波编排（M1~M5）

- **Wave 1 / M1 可观测稳定化（可并行 3 路）**
  - WS-01：后端 lifecycle 事件绑定稳定化
  - WS-02：前端生命周期聚合与“unknown message”兜底
  - WS-03：TUI/GUI 用户语义文案与脱敏展示
- **Wave 2 / M2 三小脑 LLM 化（串行优先）**
  - WS-04：`retrieval_planner` LLM 化 + fallback
  - WS-05：`patch_planner` LLM 化 + fallback（只输出策略，不输出代码）
  - WS-06：worker 调度策略整合与回退一致性
- **Wave 3 / M3 评分触发与预算守卫（串行）**
  - WS-07：Scorer 协议与特征提取
  - WS-08：Plan 路由替换 + breaker/early-stop 收敛
- **Wave 4 / M4 DeepSeek 专项（可并行 3 路）**
  - WS-09：thinking + tool loop 协议落地（reasoning_content 生命周期）
  - WS-10：cache-aware prompt packing + cache hit ratio 指标
  - WS-11：offline-eval 扩展（legal/sales/coding + cache/claim 指标）
- **Wave 5 / M5 发布收口（串行）**
  - WS-12：V1.6 flags 与 rollout 接线
  - WS-13：发布门禁、审计报告、回滚演练文档

---

## 2. Worktree/分支固定拓扑

### Wave 1

1. `wt-v16-m1-backend-events` -> `codex/v16-m1-backend-events`
2. `wt-v16-m1-frontend-chronology` -> `codex/v16-m1-frontend-chronology`
3. `wt-v16-m1-frontend-ui` -> `codex/v16-m1-frontend-ui`

### Wave 2

4. `wt-v16-m2-retrieval-llm` -> `codex/v16-m2-retrieval-llm`
5. `wt-v16-m2-strategy-llm` -> `codex/v16-m2-strategy-llm`
6. `wt-v16-m2-integration` -> `codex/v16-m2-worker-integration`

### Wave 3

7. `wt-v16-m3-scorer` -> `codex/v16-m3-scorer`
8. `wt-v16-m3-routing` -> `codex/v16-m3-routing-budget`

### Wave 4

9. `wt-v16-m4-deepseek-thinking` -> `codex/v16-m4-deepseek-thinking`
10. `wt-v16-m4-cache-aware` -> `codex/v16-m4-cache-aware`
11. `wt-v16-m4-offline-eval` -> `codex/v16-m4-offline-eval`

### Wave 5

12. `wt-v16-m5-release` -> `codex/v16-m5-release-gates`

---

## 3. 任务清单（执行级）

### Task 0: 接管核验与环境基线（主协调）

**Files:**
- Modify: 无（只核验）

**Step 1: 核验分支与状态**
- Run: `git branch --show-current && git rev-parse HEAD && git status --short --branch`
- Expected: 在 `feature/opencode-custom`，无意外阻塞。

**Step 2: 核验依赖可执行**
- Run: `cd packages/opencode && bun --version && bun test test/session/orchestrator-plan.test.ts --bail`
- Expected: exit 0。

**Step 3: 建立 wave 工作清单并冻结文件所有权**
- 输出每条子线「允许文件/禁止文件」清单。

**Step 4: Commit（仅当有记录文件变更）**
- Message: `chore(v1.6): 初始化执行基线与任务编排`

---

### Task 1: M1-WS01 后端 lifecycle 事件绑定稳定化

**Files:**
- Modify: `packages/opencode/src/session/orchestrator/index.ts`
- Modify: `packages/opencode/src/session/orchestrator/worker-runner.ts`
- Test: `packages/opencode/test/session/orchestrator-worker-runner-events.test.ts`
- Test: `packages/opencode/test/session/orchestrator-turn.test.ts`

**Step 1: 写失败测试（RED）**
- 在 `orchestrator-turn.test.ts` 增加用例：`runOrchestratorTurn` 发起 worker 时必须透传 `messageId`。
- Run: `cd packages/opencode && bun test test/session/orchestrator-turn.test.ts -t "messageId passthrough" --bail`
- Expected: FAIL（`messageId` 缺失或为 `unknown`）。

**Step 2: 最小实现（GREEN）**
- 在 `runOrchestratorTurn` 调用 `WorkerRunner.run` 时显式传入 `messageId`。
- 在 `worker-runner.ts` 生命周期 emit 保持 canonical + legacy 字段并行。

**Step 3: 回归测试**
- Run:
  - `cd packages/opencode && bun test test/session/orchestrator-worker-runner-events.test.ts --bail`
  - `cd packages/opencode && bun test test/session/orchestrator-turn.test.ts --bail`
- Expected: PASS。

**Step 4: Commit**
- Message: `fix(v1.6): 修复worker生命周期事件与messageId绑定`

---

### Task 2: M1-WS02 前端 lifecycle 聚合与 unknown 兜底

**Files:**
- Modify: `packages/app/src/lib/chronology/worker-lifecycle.ts`
- Test: `packages/app/src/lib/chronology/worker-lifecycle.test.ts`

**Step 1: 写失败测试（RED）**
- 新增用例：当 `messageID` 为 `unknown` 或空时，不得污染真实 message 分组。
- Run: `cd packages/app && bun test src/lib/chronology/worker-lifecycle.test.ts -t "unknown message fallback"`
- Expected: FAIL。

**Step 2: 最小实现（GREEN）**
- 增加 unknown-message 过滤/归并策略：
  - 优先 `messageId/messageID`。
  - 对 `unknown` 提供兜底桶且不影响真实 message badge。

**Step 3: 回归测试**
- Run: `cd packages/app && bun test src/lib/chronology/worker-lifecycle.test.ts`
- Expected: PASS。

**Step 4: Commit**
- Message: `fix(v1.6): 增强worker生命周期聚合与unknown兜底逻辑`

---

### Task 3: M1-WS03 UI 可观测语义与脱敏展示

**Files:**
- Modify: `packages/app/src/components/activity/turn-activity.tsx`
- Modify: `packages/app/src/components/activity/activity-narrative.ts`
- Test: `packages/app/src/components/activity/turn-activity-logic.test.ts`
- Test: `packages/app/src/components/activity/activity-narrative.test.ts`

**Step 1: 写失败测试（RED）**
- 增加用户语义校验：显示“分析中/检索中/规划中/验证中/已降级”。
- 增加脱敏校验：不显示原始异常栈和 reasoning 原文。
- Run: `cd packages/app && bun test src/components/activity/activity-narrative.test.ts`
- Expected: FAIL。

**Step 2: 最小实现（GREEN）**
- 将 lifecycle phase + worker role 映射为用户语义文案。
- 默认折叠低层细节，仅展示摘要与 reason code。

**Step 3: 回归测试**
- Run:
  - `cd packages/app && bun test src/components/activity/activity-narrative.test.ts`
  - `cd packages/app && bun test src/components/activity/turn-activity-logic.test.ts`
- Expected: PASS。

**Step 4: Commit**
- Message: `feat(v1.6): 增加小脑过程用户语义展示与默认脱敏`

---

### Task 4: M2-WS04 retrieval planner LLM 化

**Files:**
- Modify: `packages/opencode/src/session/orchestrator/workers/retrieval-planner.ts`
- Modify: `packages/opencode/src/session/orchestrator/worker-llm.ts`（仅必要）
- Test: `packages/opencode/test/session/orchestrator-workers-v2.test.ts`
- Test: `packages/opencode/test/session/worker-llm.test.ts`

**Step 1: 写失败测试（RED）**
- 新增用例：retrieval planner 在 LLM 输出 schema 无效/超时时进入 degraded fallback。
- Run: `cd packages/opencode && bun test test/session/orchestrator-workers-v2.test.ts -t "retrieval planner llm fallback" --bail`
- Expected: FAIL。

**Step 2: 最小实现（GREEN）**
- 使用 `runStructured` 生成结构化检索请求。
- 保留 fallback：至少输出一条 retrieval tool request（无 pointers 时）。
- 严格遵守 budget：timeout/maxToolCalls/maxOutputTokens。

**Step 3: 回归测试**
- Run:
  - `cd packages/opencode && bun test test/session/orchestrator-workers-v2.test.ts --bail`
  - `cd packages/opencode && bun test test/session/worker-llm.test.ts --bail`
- Expected: PASS。

**Step 4: Commit**
- Message: `feat(v1.6): 将检索规划器升级为LLM并保留降级回退`

---

### Task 5: M2-WS05 strategy planner LLM 化（仅策略，不执行）

**Files:**
- Modify: `packages/opencode/src/session/orchestrator/workers/patch-planner.ts`
- Modify: `packages/opencode/src/protocol/llm-worker-result.ts`（仅当需扩充 notes 约束）
- Test: `packages/opencode/test/session/orchestrator-workers-v2.test.ts`
- Test: `packages/opencode/test/session/orchestrator-worker-contract.test.ts`

**Step 1: 写失败测试（RED）**
- 新增用例：patch planner 输出中禁止出现可执行代码块（```）和直接命令执行指令。
- Run: `cd packages/opencode && bun test test/session/orchestrator-worker-contract.test.ts -t "patch planner no executable output" --bail`
- Expected: FAIL。

**Step 2: 最小实现（GREEN）**
- LLM 输出仅允许“步骤计划 + 风险提示 + 依赖前置条件”。
- 引入 output 清洗：检测代码块则降级。

**Step 3: 回归测试**
- Run:
  - `cd packages/opencode && bun test test/session/orchestrator-worker-contract.test.ts --bail`
  - `cd packages/opencode && bun test test/session/orchestrator-workers-v2.test.ts --bail`
- Expected: PASS。

**Step 4: Commit**
- Message: `feat(v1.6): 将策略规划器升级为LLM并限制为策略输出`

---

### Task 6: M2-WS06 小脑整合与回退一致性

**Files:**
- Modify: `packages/opencode/src/session/orchestrator/worker-spec.ts`
- Modify: `packages/opencode/src/session/orchestrator/index.ts`
- Test: `packages/opencode/test/session/orchestrator-integration-v2.test.ts`
- Test: `packages/opencode/test/session/orchestrator-v15-b2-integration.test.ts`

**Step 1: 写失败测试（RED）**
- 新增场景：任一 planner degraded 时，流程不崩溃，进入证据审查与安全降级。
- Run: `cd packages/opencode && bun test test/session/orchestrator-integration-v2.test.ts -t "planner degraded fallback" --bail`
- Expected: FAIL。

**Step 2: 最小实现（GREEN）**
- 统一 degraded 处理：保证 broker/dual-pass 仍能执行，且最终可降级 unknown-first。

**Step 3: 回归测试**
- Run:
  - `cd packages/opencode && bun test test/session/orchestrator-integration-v2.test.ts --bail`
  - `cd packages/opencode && bun test test/session/orchestrator-v15-b2-integration.test.ts --bail`
- Expected: PASS。

**Step 4: Commit**
- Message: `fix(v1.6): 统一小脑降级路径并保持主流程可用`

---

### Task 7: M3-WS07 Scorer 协议与特征提取

**Files:**
- Create: `packages/opencode/src/session/orchestrator/scorer.ts`
- Modify: `packages/opencode/src/session/orchestrator/features.ts`
- Modify: `packages/opencode/src/protocol/orchestrator-plan.ts`
- Test: `packages/opencode/test/session/orchestrator-scorer.test.ts`（新建）
- Test: `packages/opencode/test/session/orchestrator-features.test.ts`

**Step 1: 写失败测试（RED）**
- 新建 scorer 用例：
  - 简单问答 -> `chat`
  - 中复杂检索核验 -> `assist`
  - 高风险复杂任务 -> `heavy`
- Run: `cd packages/opencode && bun test test/session/orchestrator-scorer.test.ts --bail`
- Expected: FAIL（文件/实现不存在）。

**Step 2: 最小实现（GREEN）**
- 实现 `complexity_score/risk_score/tool_need_score` 纯启发式版本（不新增 LLM 调用）。
- 在 `orchestrator-plan` 中增加 `scores`（可选字段，向后兼容）。

**Step 3: 回归测试**
- Run:
  - `cd packages/opencode && bun test test/session/orchestrator-scorer.test.ts --bail`
  - `cd packages/opencode && bun test test/session/orchestrator-features.test.ts --bail`
- Expected: PASS。

**Step 4: Commit**
- Message: `feat(v1.6): 增加评分触发器与评分协议字段`

---

### Task 8: M3-WS08 plan 路由替换 + budget 守卫

**Files:**
- Modify: `packages/opencode/src/session/orchestrator/plan.ts`
- Modify: `packages/opencode/src/session/orchestrator/prepare.ts`
- Test: `packages/opencode/test/session/orchestrator-plan.test.ts`
- Test: `packages/opencode/test/session/adaptive-ttc-breaker.test.ts`
- Test: `packages/opencode/test/session/adaptive-ttc-budget.test.ts`

**Step 1: 写失败测试（RED）**
- 增加用例：评分触发优先于旧规则；预算 overrun 触发 worker 数降级。
- Run: `cd packages/opencode && bun test test/session/orchestrator-plan.test.ts -t "score mode routing" --bail`
- Expected: FAIL。

**Step 2: 最小实现（GREEN）**
- `resolveMode` 切换为 scorer 驱动（保留旧规则兜底）。
- 强化 early-stop 与 breaker reason codes。

**Step 3: 回归测试**
- Run:
  - `cd packages/opencode && bun test test/session/orchestrator-plan.test.ts --bail`
  - `cd packages/opencode && bun test test/session/adaptive-ttc-*.test.ts --bail`
- Expected: PASS。

**Step 4: Commit**
- Message: `feat(v1.6): 以评分路由替换模式判定并强化预算守卫`

---

### Task 9: M4-WS09 DeepSeek thinking/tool loop 协议收敛

**Files:**
- Modify: `packages/opencode/src/session/message-v2.ts`
- Modify: `packages/opencode/src/provider/transform.ts`
- Test: `packages/opencode/test/session/message-v2.test.ts`
- Test: `packages/opencode/test/provider/transform.test.ts`

**Step 1: 写失败测试（RED）**
- 新增用例：同一 tool loop 回合保留 `reasoning_content`；跨用户新 turn 清理历史 reasoning。
- Run:
  - `cd packages/opencode && bun test test/session/message-v2.test.ts -t "deepseek reasoning lifecycle" --bail`
  - `cd packages/opencode && bun test test/provider/transform.test.ts -t "DeepSeek tool loop reasoning" --bail`
- Expected: FAIL。

**Step 2: 最小实现（GREEN）**
- 实现 reasoning_content 生命周期规则：同题工具链保留、跨题清理。
- 参数守卫：thinking 模式禁用不兼容参数（防 400）。

**Step 3: 回归测试**
- Run:
  - `cd packages/opencode && bun test test/session/message-v2.test.ts --bail`
  - `cd packages/opencode && bun test test/provider/transform.test.ts --bail`
- Expected: PASS。

**Step 4: Commit**
- Message: `feat(v1.6): 完成DeepSeek思考链与工具回合协议适配`

---

### Task 10: M4-WS10 cache-aware prompt 与命中率观测

**Files:**
- Modify: `packages/opencode/src/session/llm.ts`
- Modify: `packages/opencode/src/usage/events.ts`
- Modify: `packages/opencode/src/session/orchestrator/prepare.ts`
- Test: `packages/opencode/test/usage/normalized.test.ts`
- Test: `packages/opencode/test/session/compaction.test.ts`
- Test: `packages/opencode/test/session/context-pack-cache.test.ts`

**Step 1: 写失败测试（RED）**
- 新增用例：输出 `cache_hit_ratio`，并校验分母为 0 时行为。
- Run: `cd packages/opencode && bun test test/usage/normalized.test.ts -t "cache hit ratio" --bail`
- Expected: FAIL。

**Step 2: 最小实现（GREEN）**
- prompt packing 稳定前缀前置、动态内容后置。
- usage 事件新增 `cache_hit_ratio` 与来源字段。

**Step 3: 回归测试**
- Run:
  - `cd packages/opencode && bun test test/usage/normalized.test.ts --bail`
  - `cd packages/opencode && bun test test/session/compaction.test.ts --bail`
- Expected: PASS。

**Step 4: Commit**
- Message: `feat(v1.6): 增加缓存感知提示编排与命中率指标`

---

### Task 11: M4-WS11 offline-eval 扩展与门禁升级

**Files:**
- Modify: `packages/opencode/src/eval/offline.ts`
- Modify: `packages/opencode/src/eval/offline-gate.ts`
- Modify: `packages/opencode/script/test-offline-eval.ts`
- Modify: `packages/opencode/eval/suites/legal_facts_v1.json`
- Modify: `packages/opencode/eval/suites/sales_reasoning_v1.json`
- Test: `packages/opencode/test/eval/offline-gate.test.ts`
- Test: `packages/opencode/test/eval/offline-regression.test.ts`

**Step 1: 写失败测试（RED）**
- 增加用例：claim 关键项缺证据时 gate fail；cache hit ratio 低于阈值时警告或阻断（按 flag）。
- Run: `cd packages/opencode && bun test test/eval/offline-gate.test.ts --bail`
- Expected: FAIL。

**Step 2: 最小实现（GREEN）**
- 扩展报告结构：写入 claim/citation/cache 三维度指标。
- 保持输出工件：`offline-eval-report.json` / `offline-eval-summary.md`。

**Step 3: 回归测试**
- Run:
  - `cd packages/opencode && bun test test/eval/offline-gate.test.ts test/eval/offline-regression.test.ts --bail`
  - `cd packages/opencode && bun run test:offline-eval`
- Expected: PASS。

**Step 4: Commit**
- Message: `feat(v1.6): 扩展离线评测维度并强化门禁判定`

---

### Task 12: M5-WS12 V1.6 flags 与 rollout 接线

**Files:**
- Modify: `packages/opencode/src/flag/flag.ts`
- Modify: `packages/opencode/src/config/config.ts`
- Modify: `packages/opencode/src/session/processor.ts`
- Test: `packages/opencode/test/session/turn-gate-e2e.test.ts`
- Test: `packages/opencode/test/session/orchestrator-integration-v2.test.ts`

**Step 1: 写失败测试（RED）**
- 增加用例：V1.6 flags 开/关时 route 行为与门禁行为符合预期。
- Run: `cd packages/opencode && bun test test/session/turn-gate-e2e.test.ts -t "v16 rollout flags" --bail`
- Expected: FAIL。

**Step 2: 最小实现（GREEN）**
- 新增 flags：
  - `OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V16_OBSERVABILITY`
  - `OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V16_LLM_WORKERS`
  - `OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V16_SCORER`
  - `OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V16_DEEPSEEK_THINKING`
  - `OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V16_CACHE_AWARE_PROMPT`
- 将 `config.experimental` 与 rollout gate 对齐。

**Step 3: 回归测试**
- Run:
  - `cd packages/opencode && bun test test/session/turn-gate-e2e.test.ts --bail`
  - `cd packages/opencode && bun test test/session/orchestrator-integration-v2.test.ts --bail`
- Expected: PASS。

**Step 4: Commit**
- Message: `feat(v1.6): 新增V1.6实验开关并接入编排发布门控`

---

### Task 13: M5-WS13 收口审计与发布资料

**Files:**
- Modify: `docs/plans/2026-02-08-v1_6-final-design-single-session-deepseek.md`
- Create: `docs/plans/2026-02-08-v1_6-closeout-audit-report.md`
- Modify: `packages/opencode/script/v15-checklist-audit.ts`（必要时升级为 v16 审计）
- Test: `packages/opencode/test/eval/v15-checklist-audit.test.ts`（或新增 v16 对应用例）

**Step 1: 写失败测试（RED）**
- 审计脚本输出必须含：里程碑状态、未满足项、证据路径。
- Run: `cd packages/opencode && bun test test/eval/v15-checklist-audit.test.ts --bail`
- Expected: FAIL（若未覆盖 v1.6 字段）。

**Step 2: 最小实现（GREEN）**
- 更新审计脚本与报告模板，落地 V1.6 收口格式。

**Step 3: 回归测试**
- Run:
  - `cd packages/opencode && bun test test/eval/v15-checklist-audit.test.ts --bail`
  - `cd packages/opencode && bun script/v15-checklist-audit.ts`
- Expected: PASS + 生成审计报告。

**Step 4: Commit**
- Message: `docs(v1.6): 生成V1.6收口审计报告与证据索引`

---

## 4. 每波合并策略（主协调）

- 每个子分支通过专项门禁后，主协调在 `feature/opencode-custom` 执行：
  - `git merge --no-ff <branch>`
  - merge commit message：`merge(v1.6): 合并 <wave>/<workstream>`
- 每次 merge 后执行增量门禁；失败立即停止后续合并。

### 固定合并顺序

1. Wave 1: WS-01 -> WS-02 -> WS-03
2. Wave 2: WS-04 -> WS-05 -> WS-06
3. Wave 3: WS-07 -> WS-08
4. Wave 4: WS-09 -> WS-10 -> WS-11
5. Wave 5: WS-12 -> WS-13

---

## 5. 门禁命令矩阵

### 分支专项门禁

- **M1 backend**
  - `cd packages/opencode && bun test test/session/orchestrator-worker-runner-events.test.ts test/session/orchestrator-turn.test.ts --bail`
- **M1 frontend**
  - `cd packages/app && bun test src/lib/chronology/worker-lifecycle.test.ts src/components/activity/activity-narrative.test.ts src/components/activity/turn-activity-logic.test.ts`
- **M2**
  - `cd packages/opencode && bun test test/session/orchestrator-workers-v2.test.ts test/session/orchestrator-worker-contract.test.ts test/session/worker-llm.test.ts --bail`
- **M3**
  - `cd packages/opencode && bun test test/session/orchestrator-scorer.test.ts test/session/orchestrator-plan.test.ts test/session/adaptive-ttc-*.test.ts --bail`
- **M4**
  - `cd packages/opencode && bun test test/session/message-v2.test.ts test/provider/transform.test.ts test/usage/normalized.test.ts test/eval/offline-gate.test.ts --bail`
  - `cd packages/opencode && bun run test:offline-eval`
- **M5**
  - `cd packages/opencode && bun test test/session/turn-gate-e2e.test.ts test/session/orchestrator-integration-v2.test.ts test/eval/v15-checklist-audit.test.ts --bail`

### 最终总门禁（发布阈值）

1. `cd packages/opencode && bun test test/session/orchestrator-*.test.ts --bail`（连续 3 次）
2. `cd packages/opencode && bun test test/provider/*.test.ts test/evidence/*.test.ts test/eval/*.test.ts --bail`
3. `cd packages/opencode && bun run test:offline-eval`
4. `cd packages/opencode && bun test --bail`
5. `cd packages/app && bun test`

---

## 6. 回滚方案（不改写历史）

- 运行时回滚（优先）：关闭 V1.6 flags。
- 代码回滚：按 merge 逆序执行
  - `git revert -m 1 <merge_sha>`
- 每次回滚后必须重跑：
  - `cd packages/opencode && bun test --bail`
  - `cd packages/app && bun test`

---

## 7. 清理策略（每波结束后）

- 子线合并且验证通过后，清理对应 worktree 与分支：
  - `git worktree remove <path>`
  - `git branch -d <branch>`
- 清理后核验：
  - `git worktree list`
  - `git branch --list 'codex/v16-*'`

> 注意：执行清理前先确认无未提交修改；若存在修改，先由主协调确认保留或转存。

---

## 8. 执行代理汇报模板（强制）

```markdown
Completed
- ...

Files
- ...

Tests（命令 + 结果 + exit code）
- ...

Risks
- ...

Questions（最多3个阻塞）
- ...
```

---

## 9. 主协调验收清单（逐项勾选）

- [ ] 每条子线遵守文件所有权，无越界改动
- [ ] 每条子线具备 RED -> GREEN 证据
- [ ] 每条子线提交信息为中文且语义准确
- [ ] 每次 merge 均附专项门禁通过证据
- [ ] 最终总门禁全通过
- [ ] 审计报告已生成并可追溯到证据路径
- [ ] 未执行高风险禁用操作

---

## 10. 推荐执行口令（给执行代理）

请严格按本计划实施，不得跳步：

1. 使用 `superpowers:executing-plans` 加载并逐 Task 执行。
2. 每个 Task 完成后先提交中文 commit，再汇报。
3. 主协调验收通过后才进入下一个 Task。
4. 若阻塞，立即输出“最小阻塞包”，停止编码等待指令。

