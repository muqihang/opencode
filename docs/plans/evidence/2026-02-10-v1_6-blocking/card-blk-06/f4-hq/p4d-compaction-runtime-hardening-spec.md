# F4-HQ P4D Compaction Runtime Hardening Spec

## 背景与目标

任务：`F4-HQ-P4D-COMPACTION-RUNTIME-HARDENING-01`

本次修复聚焦真实运行中的两个用户可见痛点：

1. LLM assisted 固定 12_000ms 超时导致在实际环境下频繁超时，且无法按场景调参。
2. assisted 失败时前台摘要静默回退 deterministic，用户无法判断当前看到的是哪一类摘要，也无法知道降级原因。

同时补强 compaction report 的运行态可观测字段，确保用户与下游系统都可判定：
- 当前 UI 实际展示来源（deterministic / llm）
- assisted 当前状态（success / degraded / failed / disabled）
- 降级原因、超时参数、摘要格式版本

---

## 复现证据与根因

复现会话证据（用户最新实测）显示：

- `capsule.assisted.input.json` 的 `hintText` 以 `# Capsule` 开头，夹带 `specVersion/sessionId/generatedAtUtc/sha256/plugin_prompt` 等机器字段；
- `capsule.assisted.md` 显示模型调用超时，原文含 `Operation timed out after 12000ms`；
- `compaction.report.json` 缺少 UI 运行态字段，无法直接判断本轮最终展示来源与 assisted 状态。

根因归纳：

1. 超时硬编码：`capsule-assisted` 调用 `withTimeout(..., 12_000)`，无配置能力。
2. 静默降级：assisted 非 success 时仅保留 deterministic 文本，无用户可见降级说明。
3. 观测缺口：`compaction-report/1.0` 未定义运行态标记字段，事件与报告信息不对齐。
4. hint 缺乏强制校验：未对 assisted 输入 hint 作“人类摘要格式”约束，存在被机器块污染风险。

---

## R1~R4 修复设计

### R1. assisted 超时可配置（默认 30_000ms）

实现：

- 新增配置键：`experimental.compaction_llm_timeout_ms`
- 默认值：`30000`
- 支持环境变量覆盖：`OPENCODE_EXPERIMENTAL_COMPACTION_LLM_TIMEOUT_MS`

关键点：

- `Config` 层统一合并：`project config > env > default(30000)`
- `SessionCompaction` 将实际 timeout 透传给 `CapsuleAssistedRunner`
- `CapsuleAssistedRunner` 使用传入 `timeoutMs`，不再硬编码 `12000`

### R2. 强制校验 hint 使用人类摘要

实现：

- 在 `capsule-assisted` 增加 hint 安全门：
  - 必须以 `# Compaction Summary` 开头；
  - 禁止出现机器字段：`specVersion/sessionId/generatedAtUtc/sha256/plugin_prompt`。
- 若输入不合规，回退到固定的人类摘要模板（`# Compaction Summary` 格式）。

结果：即便上游误传 `# Capsule` 机器块，也会被 fail-safe 归一化为人类摘要格式。

### R3. 失败/超时可解释（用户可见）

实现：

- assisted 跳过（非 disabled）时，更新前台 summary：
  - 保留 deterministic summary 主体；
  - 追加一行降级说明：
    - `LLM 摘要不可用（原因：timeout），当前显示 deterministic 摘要`
    - 或 `LLM 摘要不可用（原因：failed），当前显示 deterministic 摘要`

这样用户不再“看起来像没发生任何事”，可明确知晓当前展示为 deterministic 且原因可判定。

### R4. report + 事件运行态字段补强

`compaction-report/1.0` 新增字段：

- `ui_view_source`: `"deterministic" | "llm"`
- `assisted_status`: `"success" | "degraded" | "failed" | "disabled"`
- `assisted_reason_code`: `string | null`
- `assisted_timeout_ms`: `number`
- `summary_format_version`: `string`

运行时同步策略：

- 先写初始 report（默认 deterministic/disabled/human-summary）；
- assisted 分支完成后再落盘更新 runtime 字段；
- `compaction.assisted_skipped` / `compaction.assisted_applied` 事件直接复用 report runtime 值，确保字段一致。

---

## 变更清单（实现文件）

- `packages/opencode/src/session/compaction.ts`
- `packages/opencode/src/session/capsule-assisted.ts`
- `packages/opencode/src/session/compaction-protocol.ts`
- `packages/opencode/src/config/config.ts`
- `packages/opencode/src/flag/flag.ts`
- `packages/opencode/test/session/compaction-structured.test.ts`

---

## 兼容性与安全性

- 维持 fail-closed：未放松 `CapsuleAssistedVerifier` 的引用校验与降级机制；
- 未改动 `packages/app/**`；
- 无 destructive git / 无 push。

