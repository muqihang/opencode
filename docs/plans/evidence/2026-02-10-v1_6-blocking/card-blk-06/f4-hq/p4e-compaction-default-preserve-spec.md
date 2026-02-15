# F4-HQ P4E Compaction LLM Default And Result Preservation Spec

## 背景与目标

任务：`F4-HQ-P4E-COMPACTION-LLM-DEFAULT-AND-RESULT-PRESERVATION-01`

本次修复针对 compaction 体验与运行一致性的 4 个阻塞问题：

1. LLM assisted 默认未启用，导致大量会话永远停在 `assisted_status=disabled`；
2. 同轮次存在 compaction assistant 时，主 Response 区可能被 compaction summary 覆盖；
3. assisted 失败/降级（及显式禁用）时，前台摘要缺乏明确可见的回落提示；
4. 产物与报告需持续可判定本轮是否实际走了 LLM。

---

## 证据与根因

用户提供的真实产物显示：

- `compaction.report.json` 中 `assisted_status=disabled`、`ui_view_source=deterministic`；
- `capsule.md` 前台展示为 `Compaction Summary`，但并非 LLM assisted 摘要。

对应根因：

1. `Config` 层对 `experimental.compaction_llm_augment` 的兜底是 `Flag.OPENCODE_EXPERIMENTAL_CAPSULE_LLM`，该 flag 在未设置时为 `false`，导致默认关闭；
2. UI `SessionTurn` 在选择主响应时直接取“最后 assistant 文本”，未排除 `mode="compaction"`；
3. compaction skip 分支对 `disabled` 不写用户可见提示，产生“静默像没生效”；
4. 虽已有运行态字段，但默认关闭导致报告长期停留 `disabled`，与“应尝试 LLM”的产品预期不一致。

---

## 修复方案（I1~I4）

### I1 默认策略调整（backend）

实现：

- `experimental.compaction_llm_augment` 兜底改为：
  - 配置显式值优先；
  - 环境变量 `OPENCODE_EXPERIMENTAL_CAPSULE_LLM`（支持 `true/1/false/0`）其次；
  - 最终默认值 `true`。
- `SessionCompaction` 读取 `cfg.experimental?.compaction_llm_augment ?? true`，保持 fail-closed：模型不可用/超时时降级，不阻断主流程。

结论：

- 未配置时默认尝试 assisted；
- 显式 `false` 仍可关闭。

### I2 结果保全（UI）

实现：

- 新增 `selectResponsePart` 纯函数，主响应选择时过滤 `mode="compaction"` 的 assistant 消息；
- `SessionTurn` 改用该函数计算 Response 区展示内容。

结果：

- 同轮既有普通回答又有 compaction summary 时，Response 区保持普通回答；
- compaction 内容继续留在独立压缩相关展示区，不再覆盖主交付结果。

### I3 降级可见（backend + UI 文本）

实现：

- compaction skip 分支统一追加用户可见提示：
  - failed/degraded/verify 失败：`LLM 摘要不可用（原因：timeout|failed），当前显示 deterministic 摘要`
  - disabled：`LLM 摘要已禁用，当前显示 deterministic 摘要`

结果：

- 不再出现“静默回退像没生效”。

### I4 协议与可观测性一致

保持并验证以下字段在事件/报告中可用：

- `ui_view_source`
- `assisted_status`
- `assisted_timeout_ms`
- `summary_format_version`

并通过新增回归用例验证“默认路径不再固定 disabled”。

---

## 变更文件

- `packages/opencode/src/config/config.ts`
- `packages/opencode/src/session/compaction.ts`
- `packages/opencode/test/session/compaction-structured.test.ts`
- `packages/ui/src/components/session-turn.tsx`
- `packages/ui/src/components/session-turn-response.ts`
- `packages/ui/src/components/session-turn.test.ts`

---

## 约束符合性

- 仅修改 `packages/opencode/**`、`packages/ui/**` 与证据文档；
- 未修改 `packages/app/**`；
- 本地执行，无 push、无 destructive git。

