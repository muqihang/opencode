# V1.6 P1 Wave Plan Backfill（2026-02-12，append-only）

- 回填时间：`2026-02-12`
- 文档性质：`P1` 波次计划口径回填（事后补记）
- 回填边界：仅补齐当时执行计划与门禁口径描述，不新增“当时未发生”的执行事实
- 历史保护声明：不改写历史执行时间线、不改写历史提交链、不改写历史门禁结论
- 执行方式声明：`P1` 执行采用“`派发 prompt + merge gate`”方式（任务按 prompt 派发，准入按 merge gate 串行收口）
- 关联 closeout（权威收口）：
  - `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/p1-wave-closeout-2026-02-12.md`
  - `/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/docs/plans/evidence/2026-02-10-v1_6-blocking/p1-wave-closeout-2026-02-12-online-gate.md`

## 1) 回填口径（不改历史执行事实）

- 本文为 `append-only` 回填文档：补充“当时如何组织 P1 波次”的计划维度信息。
- 本文不替代 closeout，不改写 closeout；所有“已执行结果”以两份 closeout 原文为准。
- 本文不新增历史 commit，不新增历史测试结果；仅对既有事实做结构化归档。

## 2) P1-1 ~ P1-5 回填执行卡（目标 / 依赖 / 并行性 / 验收口径）

### P1-1 多层提示词模板版本化（Role/Constraint/Output/Eval）

- 目标：建立 `prompt registry + version record`，稳定输出结构并降低解析失败率。
- 依赖：依赖 `Wave-0` 治理口径冻结（canonical-index/checklist 已对齐）。
- 并行性：可与 `P1-3` 并行开发；合并准入走独立 gate，不与其他项共用一次性合并。
- 验收口径（merge gate）：
  1. `C2` 相关回归通过（`orchestrator-workers-v2` / `orchestrator-evidence-critic` / `orchestrator-integration-v2`）。
  2. 历史收口链路包含 `merge(v1.6): 合并 p1/prompt-registry`（见 closeout）。

### P1-2 检索链收敛（orchestrator 主链，LLM 检索改补偿链）

- 目标：实现“单主链 + 补偿链”路由，移除同轮双检索重复成本并保留回退路径。
- 依赖：依赖 `P1-1` 提示词基线稳定；依赖 `P0-B2 EvidenceBundleV2` 已可复用。
- 并行性：可与 `P1-3` 并行迭代；merge gate 采用串行收口，避免主链路由与指针修复同次并入。
- 验收口径（merge gate）：
  1. `C3` 回归通过（`test/session/llm.test.ts`）。
  2. `C4` 稳定性回归通过（`test/session/orchestrator-turn.test.ts`）。
  3. 历史收口链路包含 `merge(v1.6): 合并 p1/retrieval-mainchain` 与 `merge(v1.6): 合并 p1/c2-orchestrator-turn-stability`（见 closeout）。

### P1-3 pointerContextOS 语义修复与回归

- 目标：修复 pointer 语义与上下文绑定错误，提升工作集指针有效性。
- 依赖：依赖 `P1-1` 的模板/输出口径统一，避免语义修复与输出结构冲突。
- 并行性：可与 `P1-2` 并行开发；merge gate 先于 `P1-2` 主链收敛并入（按历史链路执行）。
- 验收口径（merge gate）：
  1. 纳入 `C2` 套件回归并保持 `exit code = 0`。
  2. 历史收口链路包含 `merge(v1.6): 合并 p1/pointer-context-fix`（见 closeout）。

### P1-4 评测体系扩展到 50 条样本（replay suite + nightly gate）

- 目标：形成 `50` 条样本可持续回放与 nightly 门禁，提供可量化优化收益基线。
- 依赖：依赖 `P1-2/P1-3` 主链与指针语义稳定，避免评测样本被不稳定链路污染。
- 并行性：样本准备与脚本整理可并行；最终门禁签收在核心链路稳定后执行。
- 验收口径（merge gate）：
  1. `C5` 相关回归通过（`offline-gate` / `offline-regression`）。
  2. `G1` nightly gate 命令 `exit code = 0`，并记录 `passed: yes`。
  3. 历史收口链路包含 `merge(v1.6): 合并 p1/eval-50-nightly`（见 online-gate closeout）。

### P1-5 线上灰度看板（dashboard + alert）

- 目标：建立线上灰度看板与告警链路，支撑“是否回滚”的实时判定。
- 依赖：依赖 `P1-4` 评测产物与阈值口径可用；依赖 `P1-2` 主链指标字段稳定输出。
- 并行性：可并行完成 dashboard/alert 产物开发；最终 merge gate 在 `P1-4` 门禁完成后串行准入。
- 验收口径（merge gate）：
  1. `C6` 回归通过（`test/eval/online-gate.test.ts`，`exit code = 0`）。
  2. `G2` 构建与门禁命令 `exit code = 0`；`warn` 作为风险提示记录，不判为 `fail`。
  3. 历史收口链路包含 `merge(v1.6): 合并 p1/online-dashboard-alert` 与后续修正 `fix(v1.6): skip baseline h2 breaches on empty online-gate windows`（见 online-gate closeout）。

## 3) 执行编排（派发 prompt + merge gate）

- 派发单元：以 `P1-1 ~ P1-5` 为独立 prompt 卡片派发，每卡明确目标、证据路径、门禁命令。
- 开发并行：允许 `P1-1/P1-3`、`P1-2`、`P1-4/P1-5` 在“代码开发阶段”并行推进。
- 收口串行：所有并入主分支动作均经过 merge gate；按 gate 结果串行合并，避免并行改口径。
- Gate 原则：`exit code`、测试通过率、风险级别（`fail/warn`）按 closeout 口径记录，不在本回填文档重算。

## 4) 依赖拓扑（回填版）

- 建议主链：`P1-1 -> P1-3 -> P1-2 -> P1-4 -> P1-5`。
- 并行窗口：
  - `P1-1` 与 `P1-3` 可并行开发，按 gate 串行并入；
  - `P1-4` 与 `P1-5` 可并行准备，但 `P1-5` 最终准入晚于 `P1-4`。
- 约束边界：该拓扑为历史执行口径回填，不构成对既有 closeout 结论的替代或重写。

## 5) 历史结论覆盖声明（append-only）

- 本文仅补充“计划/派发/门禁口径”维度，不改任何历史执行事实。
- 历史 `No-Go/Go` 均为时点证据；当前文档仅解释执行组织方式，不重定义历史结论。
- 若本文与收口细节存在描述差异，以两份 closeout 原文为唯一准据。
