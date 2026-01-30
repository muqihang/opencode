# P1.6 E组（Task 7–12）实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 `opencode_src` 内完成 P1.6 Task 7–12（文档优先，其次 DeepSeek 兼容性/可观测性最小代码 + TDD），不触碰 oh-my-opencode / sub2api。

**Architecture:** 先完成 4 份 notes 文档（Task 7/10/12/12.1），再以 TDD 完成 Task 8/9 代码与测试，最后可选补充 Task 11 配置片段；每个任务单独提交。

**Tech Stack:** TypeScript + Bun, Markdown

---

### Task 7/10/12/12.1: API notes 文档

**Files:**
- Create: `docs/plans/2026-01-29-deepseek-v3_2-api-notes.md`
- Create: `docs/plans/2026-01-29-zai-glm-4_7-api-notes.md`
- Create: `docs/plans/2026-01-29-minimax-m2_1-api-notes.md`
- Create: `docs/plans/2026-01-29-gemini-antigravity-api-notes.md`

**Step 1:** 写 Task 7（DeepSeek V3.2 notes：KV/disk cache 命中字段、prefix 特性、过期/构建延迟、实践建议；thinking mode 回放规则；tools strict/beta base url/schema；anthropic compat 但 cache_control 可能无效）

**Step 2:** 写 Task 10（GLM-4.7 notes：usage.cached_tokens 字段位置、thinking 默认开启/关闭、tool calling 语义、推荐 OpenAI-compatible 路径）

**Step 3:** 写 Task 12（MiniMax M2.1 notes：Anthropic-compatible caching 字段、tool + interleaved thinking 回放原则、OpenAI-compatible cache 文档不可靠）

**Step 4:** 写 Task 12.1（Gemini + Antigravity notes：Gemini Cached Content 仅显式/P1.6 不自动化；Antigravity 平台说明与上游；stickySessionHeaders + session_id；配置片段）

**Step 5:** 按任务书提交 4 个 docs commit

---

### Task 8: DeepSeek cache-hit observability（TDD）

**Files:**
- Modify: `packages/opencode/src/session/index.ts`
- Test: `packages/opencode/test/session/compaction.test.ts`

**Step 1:** 新增失败测试：`prompt_cache_hit_tokens` 应映射为 `tokens.cache.read`

**Step 2:** 运行 `bun test test/session/compaction.test.ts` 确认失败

**Step 3:** 最小实现：仅对 `providerID === "deepseek"` 读取 `prompt_cache_hit_tokens`

**Step 4:** 重跑同一测试确认通过

**Step 5:** `git commit -m "feat(deepseek): normalize cache-hit usage into cache.read [AI:Codex]"`

---

### Task 9: DeepSeek reasoning 回放规则（TDD）

**Files:**
- Modify: `packages/opencode/src/session/message-v2.ts`
- Test: `packages/opencode/test/session/message-v2.test.ts`

**Step 1:** 新增失败测试：`deepseek-reasoner` 历史中不回放 `reasoning` part

**Step 2:** 运行 `bun test test/session/message-v2.test.ts` 确认失败

**Step 3:** 最小实现：仅在 `deepseek-reasoner` 过滤 `reasoning` part

**Step 4:** 重跑同一测试确认通过

**Step 5:** `git commit -m "fix(deepseek): do not replay reasoning_content in history [AI:Codex]"`

---

### Task 11（可选）: 配置片段补充

**Files:**
- Modify: `docs/plans/codex-cli-notes.md`

**Step 1:** 追加 DeepSeek/GLM/MiniMax provider snippet（短、可复制）

**Step 2:** `git commit -m "docs(models): add DeepSeek/GLM/MiniMax config snippets [AI:Codex]"`

---

### Final: 回归测试

**Step 1:** 运行 `bun test`

**Step 2:** 至少确保：`test/provider/openai-wire-api.test.ts`、`test/session/llm-sticky-session-headers.test.ts` 与新增 DeepSeek tests 通过
