# F4-HQ-P4C-COMPACTION-UX-LLM-UNIFICATION-01 规格与修复映射

## 任务范围
- 任务：一次性交付 compaction UX + LLM augment + 语义抽取鲁棒性的统一修复。
- 约束：local-only；不改 `packages/app/**`；不做 destructive git；不 push。
- 工作树：`/Users/muqihang/chelingxi_workspace/opencode-zh-build/opencode_src/.worktrees/wt-v16-f4-hq-p4c-compaction-ux-llm-unification`

## 根因 → 修复映射（R1~R5）

### R1 前台 summary 泄漏机器字段
- 根因：`SessionCompaction.process()` 把 `Capsule.render(capsule)` 直接写入 summary part，导致 `specVersion/sessionId/sha256/plugin_prompt/compaction-input/compaction-facts` 暴露到前台。
- 修复：
  - 保留 `capsule.md` 与 `capsule.session.json` 作为审计视图。
  - 新增 `renderSummary()` 输出用户可见摘要（Goal/Decisions/Open Questions/Next Steps）。
  - summary part 改为写入 `summaryRendered`，不再写 `capsuleRendered`。
  - 对 LLM 覆盖视图增加机器字段阻断模式，避免二次泄漏。

### R2 LLM augment 门禁不一致
- 根因：`compaction.ts` 按 config 决定是否调用 assisted；`capsule-assisted.ts` 仍有 `Flag.OPENCODE_EXPERIMENTAL_CAPSULE_LLM` 硬门禁，出现“配置已开但 runner 仍 disabled”。
- 修复：
  - 删除 runner 内 env 硬门禁（`Flag.OPENCODE_EXPERIMENTAL_CAPSULE_LLM`）。
  - 以 `cfg.experimental.compaction_llm_augment` 为统一门禁（`compaction.ts`）。
  - 显式禁用时保留 `compaction.assisted_skipped` + `reasonCode=disabled` 可审计路径。

### R3 assisted 成功路径可见性
- 根因：已有路径可覆盖，但 deterministic 基线本身是机器视图，不符合“先展示可读 deterministic，再被 LLM 覆盖”的 UX 要求。
- 修复：
  - deterministic 首屏改为 human-readable summary。
  - assisted success + verifyOk 时覆盖 summary part，并保持 `compaction.assisted_applied` 与 `ui_view_source=llm`。

### R4 assisted 失败/降级回退
- 根因：降级时虽保持 deterministic，但 deterministic 以前是机器字段堆砌，不是人类可读版本。
- 修复：
  - 降级/失败保留 deterministic summary（现为 human-readable）。
  - 继续记录 `compaction.assisted_skipped`，保留 reason code（`assisted_failed/assisted_degraded/verify_failed/artifact_missing/disabled`）。

### R5 next_steps 抽取污染
- 根因：语义抽取未清洗 `known:` / `next_steps:` / 重复分隔符与低信号片段，污染进入 notes 与前台摘要。
- 修复：
  - 新增规范化链路：`stripNoise`、`cleanValue`、`stepSignal`、稳定去重 `uniq`。
  - `next_steps` 额外按 `|` 切分 + 片段级 STEP_RE 过滤，剔除低信号噪声。
  - 无有效信号时用户摘要回落 `unknown`（fail-safe）。

## 变更文件
- `packages/opencode/src/session/compaction.ts`
- `packages/opencode/src/session/capsule-assisted.ts`
- `packages/opencode/test/session/compaction-structured.test.ts`
- `packages/opencode/test/session/compaction-structured-regression.test.ts`
- `docs/plans/2026-02-15-p4c-compaction-ux-llm-unification.md`

## 风险与后续建议
- 风险1：`cleanValue/stepSignal` 为启发式规则，可能误杀边缘短句。
  - 建议：后续补充多语种/短指令样本集，持续校准阈值。
- 风险2：LLM 视图安全阻断目前基于模式匹配，仍依赖规则覆盖面。
  - 建议：后续把“前台允许字段白名单”升级为结构化渲染层。
- 风险3：assisted 异步覆盖存在短暂窗口（先 deterministic，再 LLM）。
  - 建议：前端可增加 “summary source=deterministic/llm” 状态提示。
