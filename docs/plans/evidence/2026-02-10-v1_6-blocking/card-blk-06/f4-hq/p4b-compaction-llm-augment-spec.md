# F4-HQ-P4B-COMPACTION-LLM-AUGMENT Spec

## 背景与目标
P4 已提供 deterministic compaction 主链（`capsule.md` + `capsule.session.json` + quality/report 事件与产物）。
本卡目标是在 **不破坏 P4 确定性主链、不引入前台阻塞** 的前提下，新增一层“可验证的 LLM 增强视图”，并把应用/跳过路径显式可观测化。

核心原则：
1. deterministic baseline 永远先产出、先可见。
2. LLM augment 仅作为异步覆盖层，永不阻塞主链。
3. 只有 `assisted=success` 且 `verifyOk=true` 才允许覆盖前台可见摘要。
4. 前台默认只呈现自然语言摘要，不暴露 claims/raw JSON 中间态。

## 职责边界（双层输出）
### 第一层：deterministic baseline（强确定性主链）
- 由 `session/compaction.ts` 同步完成：
  - 写入 `capsule.session.json` / `capsule.md` / `facts.json` / `compaction.report.json`
  - 更新 session summary 文本（前台立即可见）
  - 发出 `compaction.completed`
- 该层不依赖 LLM，不受 augment 成败影响。

### 第二层：verified LLM augment（异步增强层）
- 由 `CapsuleAssistedRunner.runFromCompaction` 异步执行（fire-and-forget）。
- 仅在通过门禁时覆盖 summary 文本：
  - `status === success`
  - `verifyOk === true`
  - `viewText` 与 `view artifact` 均存在
  - `viewText` 不含禁止暴露的 JSON/claims 中间态标签

## 应用/跳过判定条件
### applied（`compaction.assisted_applied`）
满足全部条件时：
1. `experimental.compaction_llm_augment !== false`
2. `assisted.status === success`
3. `assisted.verifyOk === true`
4. `assisted.artifacts.view.path` 存在且 `assisted.viewText` 非空
5. `assisted.viewText` 未触发 JSON 泄露拦截（如 `<assistant_claims_json>` / `capsule.session.json` / `capsule.assisted.verify.json` / ```json）

事件字段：
- `compactionId`
- `status`
- `ui_view_source = "llm"`
- `coverage`
- `view_artifact`
- `verify_artifact`

### skipped（`compaction.assisted_skipped`）
任一条件不满足即跳过增强，保留 deterministic 文本。

`reasonCode` 取值：
- `disabled`：配置显式关闭（`experimental.compaction_llm_augment=false`）
- `assisted_failed`：assisted 状态为 `failed`
- `assisted_degraded`：assisted 状态为 `degraded`
- `verify_failed`：验证未通过或命中 JSON 泄露拦截
- `artifact_missing`：缺少 view text 或 view artifact

事件字段：
- `compactionId`
- `status`
- `reasonCode`
- `assisted_reason_code`
- `ui_view_source = "deterministic"`
- `coverage`
- `view_artifact`（可选）
- `verify_artifact`（可选）

## 前台输出安全约束
前台 summary 文本禁止出现：
1. `<assistant_claims_json>` 标签
2. `capsule.session.json` 原文/引用泄露
3. `capsule.assisted.verify.json` 原文/引用泄露
4. ```json 代码块

JSON 仅保留在 artifacts/evidence 中，前台只展示自然语言视图。

## 配置与默认策略
新增配置：`experimental.compaction_llm_augment?: boolean`

默认值：沿用现有实验策略，回落到 `Flag.OPENCODE_EXPERIMENTAL_CAPSULE_LLM`。

因此：
- 显式 `false`：强制关闭 augment（仅 deterministic）
- 未配置：按现有实验 flag 策略决定

## 回退策略（Fail-Closed）
1. 任意 assisted 路径异常不影响 deterministic 文本已落盘结果。
2. 只要门禁不通过，统一 `compaction.assisted_skipped`，且 `ui_view_source=deterministic`。
3. 任何不满足安全门禁的增强结果不进入前台。
4. 即使 runner 抛错，也仅记录跳过，不阻塞 `session.compacted` 主流程。

