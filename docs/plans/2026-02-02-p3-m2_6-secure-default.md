# P3 Milestone 2.6 (Secure-by-default) Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL (when executing this plan): use `superpowers:executing-plans` task-by-task.

**Goal:** 把 “指令/数据隔离 + 引用强约束 + 消耗治理” 从 prompt 约定升级为工程机制：可审计、可验证、可降级、可回放。

**Architecture (Minimal Closed Loop):**
- 在主对话输出链路里新增一个 `secure-output` 门禁：
  - 双通道：用户看到的仍是自然语言；同时要求模型附带结构化 `assistant-claims/1.0`（隐藏块，解析后落盘为 artifact）。
  - schema-first：claims JSON 必须过 Zod 严格校验；失败写 `protocol.violation` + error artifact。
  - citations required（strict/balanced）：只对 `fact` claims 强制；任意 fact 无法映射到 `pointers(path+sha256+anchor)` 或核验失败 → 明确降级（中文人话 + 下一步建议），禁止“装懂式结论”。
  - 消耗治理：对核验步骤设置预算（timeout / max scripts / input bytes），并事件化 `...requested/degraded/timeout/cancelled`。

**Tech Stack:**
- Bun + TypeScript + Zod
- Evidence system: `EvidenceWriter` + `events.jsonl` + `manifest.json`
- Toolbelt/verifier: `PythonTool` + `citation-check`（以及现有 verification worker）

---

## Definition of Done (DoD) Checklist

- [ ] **Citations Required (fact-only)**：strict/balanced 下，存在 fact claim 时每条 fact 必须能落到 pointers（path+sha256+anchor）；否则降级为 unknown/unsupported 并给出中文原因与下一步（补检索/切策略）。
- [ ] **Plan/Opinion 免责但不伪装**：plan/opinion 不强制 citations；但输出必须明确是建议/计划/推测口吻；不确定宁可 unknown。
- [ ] **反逃逸**：避免把事实伪装成 opinion 逃避核验；宁可降级也不输出假装确定的事实结论。
- [ ] **Schema-first + Protocol violation**：关键 I/O（claims artifact、gate 输出、事件）严格 schema 校验；失败写 `protocol.violation`（event payload 只含摘要 + artifact 指针，不含大段原文）。
- [ ] **Budget治理**：核验（verification）有 budget/timeout/abort；触发必须写事件；用户能从中文提示理解发生了什么、下一步怎么做。
- [ ] **测试**：`cd packages/opencode && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test` 全绿；不使用 mocks；覆盖：
  - protocol violation 的事件闭环与 error artifact
  - citations required 的降级语义
  - strict/balanced 下 “无法核验 → unknown/unsupported + 中文原因”

---

## Tasks

### Task 1: 定义输出双通道协议（assistant-claims/1.0）

**Files:**
- Create: `packages/opencode/src/protocol/assistant-claims.ts`
- Test: `packages/opencode/test/secure-output/assistant-claims.test.ts`

**Step 1: RED - 写失败测试（schema 解析）**
- 覆盖：合法输入能 parse；缺字段/多字段（strict）会失败；pointer 必须包含 `path`，fact 的 pointer 必须包含 `anchor`。

**Step 2: GREEN - 最小实现**
- 用 Zod `.strict()` 建 schema + types。

**Step 3: Verify**
- Run: `cd packages/opencode && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test`

---

### Task 2: 实现 secure-output 门禁（artifact + event + 可降级输出）

**Files:**
- Create: `packages/opencode/src/secure-output/index.ts`
- Create: `packages/opencode/src/secure-output/worker.ts`
- Test: `packages/opencode/test/secure-output/secure-output.test.ts`

**Behavior:**
- 输入：`sessionId/messageId/assistantText/mode(strict|balanced)/budget`
- 输出：`{ text, status, artifacts[] }`（text 是最终给用户看的文本；默认中文）
- 解析：从 `assistantText` 末尾提取 `<assistant_claims_json>...</assistant_claims_json>`，解析后：
  - 将 claims 落盘为 `secure-output/claims.json`（artifact）
  - 用户文本中移除隐藏块（保持自然语言可读）
- enforcement（strict/balanced）：
  - 若存在 fact claims：
    - fact pointers 为空或缺 anchor → 直接降级（unknown/unsupported）并给中文下一步
    - 有 pointers → 调用 `runVerification` 做 `citation-check` 核验；任一 fact 未 supported → 降级
  - 若 claims block 缺失或 schema 无法解析：
    - 写 `protocol.violation` + error artifact
    - 产出降级文本（中文）并提示下一步（补检索/切策略/要求结构化 claims）
- 反逃逸：
  - 在没有任何 fact claims 的情况下，对输出文本做轻量 “fact-like” 检测（保守：宁可误报）
  - 命中则视为 `classification_evasion`，降级并写事件

**Step 1: RED - 写失败测试**
- strict：fact claim 无 pointers → 必须降级；输出包含中文原因 + 下一步；写 `secure_output.degraded` 事件；写 claims/error artifact。
- balanced：fact claim 指针存在但 citation-check 失败（missing/anchor_invalid）→ 必须降级；输出包含中文原因。
- protocol.violation：claims JSON malformed → events.jsonl 包含 `protocol.violation` + error artifact 可打开。

**Step 2: GREEN - 最小实现**

**Step 3: Verify**
- Run: `cd packages/opencode && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test`

---

### Task 3: 注入 Secure-by-default 输出契约（不改 UI）

**Files:**
- Modify: `packages/opencode/src/session/llm.ts`
- Create: `packages/opencode/src/session/secure-output-contract.ts` (or inline constant)

**Behavior:**
- 在 system/developer instructions 中加入稳定的 contract：
  - 用户可见自然语言先输出
  - 末尾追加 `<assistant_claims_json>` JSON `assistant-claims/1.0` `</assistant_claims_json>`
  - 明确：fact claims 在 strict/balanced 下必须提供 pointers（path+sha256+anchor）

**Step 1: RED**
- 添加一个单测（或在 secure-output 测试中模拟无 claims block）确保 “无 claims 且含 fact-like 文本” 会降级，而不是静默放行。

**Step 2: GREEN**
- 最小把 contract 拼进 developerText 或 system blocks（避免动态字段导致缓存抖动）。

---

### Task 4: 接入主输出链路（SessionProcessor text-end）

**Files:**
- Modify: `packages/opencode/src/session/processor.ts`
- Possibly modify: `packages/opencode/src/evidence/reader.ts` (仅当需要从 events 获取 contextPackId)

**Behavior:**
- 在 `text-end` 写入 part 前调用 `secure-output`：
  - 若降级：用降级文本替换 user-visible text（不改 UI，仅文本变化）
  - 写事件：`secure_output.requested` / `secure_output.completed` / `secure_output.degraded`
  - 所有 payload 只写摘要 + artifact pointers

**Verify**
- Run package tests（同上）

---

## Commit Strategy (Small + Auditable)
- Commit 1: add plan doc + assistant-claims protocol + tests
- Commit 2: add secure-output worker + tests
- Commit 3: inject output contract + integrate SessionProcessor gate

