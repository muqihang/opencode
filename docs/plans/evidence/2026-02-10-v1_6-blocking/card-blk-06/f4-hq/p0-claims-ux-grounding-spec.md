# F4-HQ P0 Claims UX Grounding 规格

## 背景
- 卡点：前台会话流在非 secure mode 时仍可能显示 `<assistant_claims_json>` 及其 JSON 体。
- 卡点：verification/resume/handoff/audit 场景缺少严格 reference-check，可能把 `unknown`、通配符、越界行号写入最终文本。

## 目标
- P0-1：前台用户可见流永不展示 `<assistant_claims_json>` 标签及内部 JSON，且与 secure mode 开关解耦。
- P0-2：verification/resume/handoff/audit 意图启用严格 reference-check，违规时 fail-closed 输出 `unknown/evidence_insufficient`。

## 非目标
- 不调整 worker on/off 策略。
- 不更改业务路由或策略语义。
- 不改 `packages/app/**`。

## 设计

### 1) 前台 claims masking（与 secure mode 解耦）
- 在 `session/processor` 的 `text-start/text-delta/text-end` 统一维护 claims mask。
- `text-delta` 使用统一掩码函数处理可见增量；仅把掩码后的 delta 写入前台 text part。
- `text-end` flush 掩码尾部，确保跨 chunk 标签同样被隐藏。
- 保留 `currentRaw` 供 secure-output 校验链使用，避免破坏既有 secure-output 输入语义。

### 2) 严格 reference-check（fail-closed）
- 新增 `src/session/reference-check.ts`：
  - 意图触发：`verify/verification/resume/handoff/audit` 及对应中文关键词。
  - 仅允许引用形态：`path:line` 或 `path:line-line`。
  - 禁止：`unknown`、通配符 `*`、当前会话用户消息路径、路径越界工作区。
  - 验证：路径存在、行号范围有效。
  - 无证据同样判定失败（`evidence_missing`）。
- 在 `processor` 的 `text-end` 最终文本阶段执行检查；失败则强制替换为 `unknown/evidence_insufficient`。

### 3) 可审计事件
- fail-closed 时写入 `evidence events`：
  - `type: reference_check.failed`
  - `data.reason_codes` 记录失败原因集合。

## 回归覆盖
- R1：非 secure mode 流式前台仍不泄露 claims 标签/JSON。
- R2：verification 场景中 `unknown` / `docs/*.md` / `path:8-999` 触发 fail-closed。
- R3：合法 `file:line`、`file:line-line` 且文件与行号有效时通过。

## 验收命令
- `bun run typecheck`
- `bun test test/session/processor-secure-output-stream.test.ts test/session/orchestrator-turn.test.ts test/secure-output/secure-output.test.ts test/session/reference-check-grounding.test.ts --bail`

