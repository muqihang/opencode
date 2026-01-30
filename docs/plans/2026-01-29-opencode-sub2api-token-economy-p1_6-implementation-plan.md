# OpenCode + Sub2API Token Economy Alignment (P1.6) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `opencode` + `oh-my-opencode` achieve Codex CLI-like token economy when routed via `Sub2API`: higher `cached_tokens` hit-rate, lower repeated prompt bloat, and more deterministic prefixes; keep changes forward-compatible with the existing P2/P3 sandbox-context roadmap.

**Architecture:** Treat this as a “P2/P3 foundation patch” rather than a full redesign: (1) align OpenCode ↔ Sub2API sticky-session signals (`prompt_cache_key` + optional headers) so upstream account routing stays stable (required for prompt caching), (2) reduce oh-my-opencode prompt inflation via deterministic context ordering + budget + pointerization, (3) add observability + regression tests so future P2/P3 context-pack work doesn’t silently regress cache hit-rate.

**Tech Stack:** TypeScript + Bun (OpenCode + oh-my-opencode), Zod, OpenAI Responses API semantics (`prompt_cache_key`, `usage.input_tokens_details.cached_tokens`), Go (Sub2API), git worktree.

---

## Design Coverage Index (P1.6 items, no omissions)

This plan is a “foundation patch” aligned with the sandbox-context design:
- `docs/plans/2026-01-25-opencode-sandbox-context-design.md`

Covered design sections (P1.6 scope):
- Section 3.2: provider prompt caching alignment (use deterministic keys + stable sticky session signals)
- Section 16.4: prefix determinism (reduce prefix jitter so caching can actually hit)
- Section 5: “Pointers-not-Paste” + budget discipline for injected context (spill to file pointers)
- Section 7: oh-my-opencode orchestration safety (no cross-session injection; deterministic ordering)
- Section 17 (partial): configs/behavior must remain forward-compatible with P2/P3 (no new uncontrolled config drift)

Explicitly not covered (by design):
- Section 16 (full): Context Pack SSOT, counters, compaction linkage (owned by P3)
- Section 13 (hard backends): OS-level hard sandbox backends (owned by P4)

## Context / Evidence (read first)

- Investigation doc (root cause + code references):
  - `docs/plans/2026-01-29-opencode-sub2api-caching-investigation.md`
- Sandbox-context design doc (P2/P3 direction + “model layering” decision):
  - `docs/plans/2026-01-25-opencode-sandbox-context-design.md`

This plan intentionally does **not** implement full P3 (Context Pack + compaction + prefix determinism endgame),
but it must **not** fight P3 either.

---

## Decision Addendum (locked-in P1.6 choices)

These decisions were explicitly confirmed during review. If implementation conflicts, follow this section.

### Scope: "Full Stable Version" (3 repos)

- OpenCode (`opencode-zh-build/opencode_src`): YES, code changes in P1.6.
- oh-my-opencode (`opencode-zh-build/oh-my-opencode`): YES, code changes in P1.6.
- Sub2API (`sub2api/`): YES, code changes in P1.6 (compatibility + observability).

### Quality-first injection policy (oh-my-opencode)

- If the plugin cannot reliably determine which session a message belongs to:
  - **Do not inject context** (avoid cross-session "prompt pollution").
  - **Do not consume/clear pending context** (avoid losing context meant for the correct session).
  - Log a structured diagnostic so we can see when/why injection was skipped.

This is intentionally conservative: quality + determinism beats "always inject" behavior.

---

## Success Criteria (Definition of Done)

### Cache / Sticky Session (functional)

- When using OpenCode routed through Sub2API with model `gpt-5.2-codex`:
  - Sub2API dashboard shows **non-zero** `cache_read_input_tokens` (or equivalent `cached_tokens`) on the 2nd identical call in the same session.
  - OpenCode `opencode stats` shows non-zero `Cache Read` for the same session.

- When using OpenCode routed through Sub2API with Gemini models (e.g. `gemini-3-flash`, `gemini-3-pro-high`):
  - Sub2API dashboard shows the **same upstream account** is used across multiple turns within the same OpenCode session (sticky session is stable).
  - If/when Cached Content is configured (P3 can automate this), OpenCode `opencode stats` can surface `Cache Read` via `usageMetadata.cachedContentTokenCount`.

### Token Economy (behavioral)

- oh-my-opencode context injection:
  - Is deterministic for the same set of context entries (stable ordering, no timestamp-driven reordering).
  - Never injects pending context into the wrong session (no fallback to main session when the message session is unknown).
  - Has a strict budget; large pending context spills to a file pointer (no multi-kilobyte raw paste into the prompt by default).

### Compatibility (roadmap)

- P2/P3 can later replace the oh-my-opencode “context capsule” with a real Context Pack without changing Sub2API alignment again.
- Sandbox child-agent model layering remains supported (design doc line: default model layering / worker uses cheaper model).

---

## Non-Goals (explicitly out of scope for P1.6)

- Building the full P3 Context Pack protocol (schemas, fingerprints, LRU cache store, MCP freeze, etc.).
- Implementing the full P2 sandbox runner isolation backend (bwrap/nsjail/sandbox-exec).
- Rewriting oh-my-opencode orchestration / UI behavior (only token-economy related behavior).

---

## Implementation Plan

### Task 0: Preflight worktrees + baseline measurements (required)

**Files:** none (command-only)

**Step 0: Ensure this plan + investigation docs exist in the worktrees**

Because this plan lives under `opencode_src/docs/plans/`, if it is untracked (or not committed yet), a new git worktree may not contain it.

Preferred: commit the docs in the base repo before creating worktrees:

```bash
git -C opencode-zh-build/opencode_src status -sb
git -C opencode-zh-build/opencode_src add docs/plans/2026-01-29-opencode-sub2api-caching-investigation.md
git -C opencode-zh-build/opencode_src add docs/plans/2026-01-29-opencode-sub2api-token-economy-p1_6-implementation-plan.md
git -C opencode-zh-build/opencode_src commit -m "docs(plan): add Sub2API token-economy P1.6 plan + investigation [AI:Codex]"
```

Alternative (no commit): after creating worktrees, copy the files into the worktree’s `docs/plans/` folder.

**Step 1: Create worktrees (3 repos)**

Run:
- `git -C opencode-zh-build/opencode_src worktree add ../opencode_src-p1_6 -b feature/opencode-p1_6_token_economy`
- `git -C opencode-zh-build/oh-my-opencode worktree add ../oh_my_opencode-p1_6 -b feature/oh_my_opencode-p1_6_token_economy`
- `git -C sub2api worktree add ../sub2api-p1_6 -b feature/sub2api-p1_6_token_economy`

Expected: 3 new worktree dirs created under `opencode-zh-build/` (first 2) and workspace root (sub2api).

**Step 2: Verify clean statuses**

Run:
- `git -C opencode-zh-build/opencode_src-p1_6 status -sb`
- `git -C opencode-zh-build/oh_my_opencode-p1_6 status -sb`
- `git -C sub2api-p1_6 status -sb`

Expected: clean.

**Step 3: Baseline tests must be green**

Run:
- `cd opencode-zh-build/opencode_src-p1_6/packages/opencode && bun test test/provider/transform.test.ts`
- `cd opencode-zh-build/oh_my_opencode-p1_6 && bun test`
- `cd sub2api-p1_6/backend && go test ./...`

Expected: PASS.

**Step 4: Capture baseline cache behavior (manual)**

Do this twice (same prompt, same OpenCode session):
- Run OpenCode via Sub2API and ask a stable prompt twice (example: “Reply with OK only”).
- On Sub2API dashboard, note whether `cache_read_input_tokens` changes between 1st and 2nd call.
- In OpenCode, run `opencode stats` for that session; record `Cache Read`.

Expected right now (baseline): cache hit-rate is poor / near-zero in OpenCode vs Codex CLI.

---

### Task 1: OpenCode provider “wire_api=responses” parity + deterministic cache key injection

**Why:** Codex CLI config supports `wire_api = "responses"`. OpenCode currently doesn’t have an explicit “wire API” toggle for OpenAI-like providers, and cache-key injection depends on provider ID or `setCacheKey`. We need an explicit, auditable way to select Responses API *and* enable prompt cache key for OpenAI-like gateways.

**Files:**
- Modify: `opencode-zh-build/opencode_src-p1_6/packages/opencode/src/provider/provider.ts`
- Modify: `opencode-zh-build/opencode_src-p1_6/packages/opencode/src/provider/transform.ts`
- Modify (schema/docs): `opencode-zh-build/opencode_src-p1_6/packages/opencode/src/config/config.ts`
- Test: `opencode-zh-build/opencode_src-p1_6/packages/opencode/test/provider/transform.test.ts`
- Create: `opencode-zh-build/opencode_src-p1_6/packages/opencode/test/provider/openai-wire-api.test.ts`

**Step 1: Add config schema for wire api option (failing test first)**

Create `opencode-zh-build/opencode_src-p1_6/packages/opencode/test/provider/openai-wire-api.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { ProviderTransform } from "../../src/provider/transform"

describe("OpenAI-like gateways - wire_api=responses implies prompt cache key", () => {
  test("sets promptCacheKey when providerOptions.wire_api is responses", () => {
    const model = {
      id: "sub2api/gpt-5.2-codex",
      providerID: "sub2api",
      api: { id: "gpt-5.2-codex", url: "http://127.0.0.1:18080", npm: "@ai-sdk/openai" },
      name: "gpt-5.2-codex",
      capabilities: {
        temperature: true,
        reasoning: true,
        attachment: false,
        toolcall: true,
        input: { text: true, audio: false, image: false, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
      limit: { context: 200000, output: 32000 },
      status: "active",
      options: {},
      headers: {},
    } as any

    const result = ProviderTransform.options({
      model,
      sessionID: "ses_cache_key",
      providerOptions: { wire_api: "responses" },
    })
    expect(result.promptCacheKey).toBe("ses_cache_key")
  })
})
```

**Step 2: Run the new test (expect fail)**

Run: `cd opencode-zh-build/opencode_src-p1_6/packages/opencode && bun test test/provider/openai-wire-api.test.ts`

Expected: FAIL (no promptCacheKey for wire_api yet).

**Step 3: Implement `wire_api` support in ProviderTransform.options**

In `opencode-zh-build/opencode_src-p1_6/packages/opencode/src/provider/transform.ts`:

- Treat both `wireApi` and `wire_api` as supported spellings.
- If it’s `"responses"`, enable `promptCacheKey` (safe because this plan will also route to Responses API).

Minimal change sketch:

```ts
const wireApi = input.providerOptions?.wireApi ?? input.providerOptions?.wire_api

if (input.model.providerID === "openai" || input.providerOptions?.setCacheKey || wireApi === "responses") {
  result["promptCacheKey"] = input.sessionID
}
```

**Step 4: Run the test (expect pass)**

Run: `cd opencode-zh-build/opencode_src-p1_6/packages/opencode && bun test test/provider/openai-wire-api.test.ts`

Expected: PASS.

**Step 5: Route OpenAI SDK to Responses API when wire_api=responses**

In `opencode-zh-build/opencode_src-p1_6/packages/opencode/src/provider/provider.ts`:

- In `getLanguage(model)`, before calling `sdk.languageModel(...)`, check:
  - `model.api.npm === "@ai-sdk/openai"`
  - `provider.options.wireApi` or `provider.options.wire_api`
  - If `"responses"` and `sdk.responses` exists, call `sdk.responses(model.api.id)`
  - If `"chat"` and `sdk.chat` exists, call `sdk.chat(model.api.id)`

Minimal change sketch:

```ts
const wireApi = provider.options?.["wireApi"] ?? provider.options?.["wire_api"]
if (model.api.npm === "@ai-sdk/openai") {
  if (wireApi === "responses" && typeof (sdk as any).responses === "function") {
    const language = (sdk as any).responses(model.api.id)
    s.models.set(key, language)
    return language
  }
  if (wireApi === "chat" && typeof (sdk as any).chat === "function") {
    const language = (sdk as any).chat(model.api.id)
    s.models.set(key, language)
    return language
  }
}
```

**Step 6: Add a unit test for wire-api routing**

In `opencode-zh-build/opencode_src-p1_6/packages/opencode/test/provider/openai-wire-api.test.ts`, add a second test that stubs a minimal “SDK” object and tests a new small helper function.

Implementation detail to enable testability:
- Extract the logic into a tiny pure helper in a new module:
  - Create: `opencode-zh-build/opencode_src-p1_6/packages/opencode/src/provider/openai-wire-api.ts`
  - Export: `resolveOpenAIModelFromWireApi(sdk: any, modelID: string, wireApi?: string)`
  - Unit test that helper without touching Provider state machinery.

Test sketch:

```ts
import { resolveOpenAIModelFromWireApi } from "../../src/provider/openai-wire-api"

test("wire_api=responses selects sdk.responses", () => {
  const calls: string[] = []
  const sdk = {
    responses: (id: string) => {
      calls.push("responses:" + id)
      return { kind: "responses", id }
    },
    chat: (id: string) => {
      calls.push("chat:" + id)
      return { kind: "chat", id }
    },
  }
  const out = resolveOpenAIModelFromWireApi(sdk, "gpt-5.2-codex", "responses")
  expect(out).toEqual({ kind: "responses", id: "gpt-5.2-codex" })
  expect(calls).toEqual(["responses:gpt-5.2-codex"])
})
```

**Step 7: Update config schema docs (no behavior change)**

In `opencode-zh-build/opencode_src-p1_6/packages/opencode/src/config/config.ts`:
- Document `wireApi` (preferred) and `wire_api` (compat) under provider `options`:
  - allowed: `"responses" | "chat"`

**Step 8: Run targeted tests**

Run:
- `cd opencode-zh-build/opencode_src-p1_6/packages/opencode && bun test test/provider/openai-wire-api.test.ts`
- `cd opencode-zh-build/opencode_src-p1_6/packages/opencode && bun test test/provider/transform.test.ts`

Expected: PASS.

**Step 9: Commit**

Run:
```bash
git -C opencode-zh-build/opencode_src-p1_6 add -A
git -C opencode-zh-build/opencode_src-p1_6 commit -m "feat(provider): support wire_api=responses and cache key injection [AI:Codex]"
```

---

### Task 2: OpenCode → Sub2API sticky session headers (session_id / conversation_id)

**Why:** Sub2API uses sticky sessions to keep a conversation bound to one upstream OAuth account (required for prompt cache reuse and stable quota routing). It prioritizes `session_id`/`conversation_id` headers and falls back to `prompt_cache_key` (OpenAI) or request-body heuristics (Anthropic/Gemini). Add these headers so OpenCode behaves closer to Codex CLI **and** so Gemini/Antigravity flows can also opt into stable routing.

**Files:**
- Modify: `opencode-zh-build/opencode_src-p1_6/packages/opencode/src/session/llm.ts`
- Create: `opencode-zh-build/opencode_src-p1_6/packages/opencode/test/session/llm-sticky-session-headers.test.ts`

**Step 1: Write failing unit test by extracting a small header builder**

In `opencode-zh-build/opencode_src-p1_6/packages/opencode/src/session/llm.ts`:
- Add a small exported helper:
  - `LLM.buildGatewayHeaders({ sessionID, model, providerOptions })`
  - It returns `{ session_id, conversation_id }` only when appropriate.

Create `opencode-zh-build/opencode_src-p1_6/packages/opencode/test/session/llm-sticky-session-headers.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { LLM } from "../../src/session/llm"

describe("LLM.buildGatewayHeaders", () => {
  test("adds session_id/conversation_id when wire_api=responses for openai npm providers", () => {
    const headers = LLM.buildGatewayHeaders({
      sessionID: "ses_123",
      model: { api: { npm: "@ai-sdk/openai" } } as any,
      providerOptions: { wire_api: "responses" },
    })
    expect(headers).toEqual({ session_id: "ses_123", conversation_id: "ses_123" })
  })

  test("returns empty object for non-openai providers by default", () => {
    const headers = LLM.buildGatewayHeaders({
      sessionID: "ses_123",
      model: { api: { npm: "@ai-sdk/anthropic" } } as any,
      providerOptions: { wire_api: "responses" },
    })
    expect(headers).toEqual({})
  })

  test("can be forced on for non-openai gateways (Gemini/Anthropic via Sub2API)", () => {
    const headers = LLM.buildGatewayHeaders({
      sessionID: "ses_123",
      model: { api: { npm: "@ai-sdk/google" } } as any,
      providerOptions: { stickySessionHeaders: true },
    })
    expect(headers).toEqual({ session_id: "ses_123", conversation_id: "ses_123" })
  })
})
```

Run: `cd opencode-zh-build/opencode_src-p1_6/packages/opencode && bun test test/session/llm-sticky-session-headers.test.ts`

Expected: FAIL (helper does not exist yet).

**Step 2: Implement helper + integrate into real request headers**

In `opencode-zh-build/opencode_src-p1_6/packages/opencode/src/session/llm.ts`:

- Implement:
  - Detect OpenAI-like: `model.api.npm === "@ai-sdk/openai"` (and optionally openai-compatible).
  - Detect responses wire api: `providerOptions.wireApi/wire_api === "responses"` OR `providerOptions.setCacheKey === true`.
  - Allow forcing on: `providerOptions.stickySessionHeaders === true` (for Gemini/Anthropic gateways like Sub2API)
  - Return sticky headers:
    - `session_id: sessionID`
    - `conversation_id: sessionID`

- Then in `streamText({ headers: { ... } })` merge in this helper output.

**Step 3: Run the unit test**

Run: `cd opencode-zh-build/opencode_src-p1_6/packages/opencode && bun test test/session/llm-sticky-session-headers.test.ts`

Expected: PASS.

**Step 4: Commit**

Run:
```bash
git -C opencode-zh-build/opencode_src-p1_6 add -A
git -C opencode-zh-build/opencode_src-p1_6 commit -m "feat(sub2api): send sticky-session headers for openai gateways [AI:Codex]"
```

---

### Task 3: oh-my-opencode — session safety: never cross-inject, never consume on skip

**Why:** In the current implementation, when a message is missing `sessionID`, the injector falls back to `getMainSessionID()`.
This can accidentally inject *main-session pending context* into a different session (e.g. a subagent session), which:
- increases input tokens (irrelevant context),
- reduces cache hit-rate (prefix becomes unstable),
- can reduce task quality (model is biased by wrong context),
- can also "steal" context from the main session because pending entries are consumed/cleared.

P1.6 decision: **quality-first**. If we cannot confidently identify the session, we skip injection and we do not consume pending context.

**Files:**
- Modify: `opencode-zh-build/oh_my_opencode-p1_6/src/features/context-injector/injector.ts`
- Modify: `opencode-zh-build/oh_my_opencode-p1_6/src/features/context-injector/injector.test.ts`

**Step 1: Write failing test for "no fallback injection"**

In `opencode-zh-build/oh_my_opencode-p1_6/src/features/context-injector/injector.test.ts`, add:

```ts
it("does not fallback to main session when message sessionID is missing", async () => {
  const hook = createContextInjectorMessagesTransformHook(collector)
  const mainSessionID = "ses_main"
  const unknownMessageSessionID = "" // simulate missing/empty on the message

  // pending exists for main session only
  collector.register(mainSessionID, {
    id: "ctx",
    source: "custom",
    content: "MAIN_ONLY",
  })

  const messages = [
    createMockMessage("user", "Hello", unknownMessageSessionID),
  ]

  const output: any = { messages }
  await hook["experimental.chat.messages.transform"]!({}, output)

  // Should NOT inject MAIN_ONLY into the message without a reliable session id.
  expect(output.messages[0].parts[0].text).toBe("Hello")

  // Also should NOT consume main pending context.
  expect(collector.hasPending(mainSessionID)).toBe(true)
})
```

Run: `cd opencode-zh-build/oh_my_opencode-p1_6 && bun test src/features/context-injector/injector.test.ts`

Expected: FAIL (today it falls back and consumes).

**Step 2: Implement session safety rule**

In `injector.ts`:
- Remove the fallback `getMainSessionID()` for injection decisions.
- Treat missing/empty `message.info.sessionID` as "unknown session" -> skip injection.
- Only call `collector.consume(sessionID)` after we decide to inject into that exact session.

**Step 3: Run tests**

Run: `cd opencode-zh-build/oh_my_opencode-p1_6 && bun test src/features/context-injector/injector.test.ts`

Expected: PASS.

**Step 4: Commit**

Run:
```bash
git -C opencode-zh-build/oh_my_opencode-p1_6 add -A
git -C opencode-zh-build/oh_my_opencode-p1_6 commit -m "fix(context-injector): skip injection when sessionID is unknown [AI:Codex]"
```

---

### Task 4: oh-my-opencode — make context ordering deterministic (prefix stability)

**Why:** oh-my-opencode currently sorts context entries using `timestamp: Date.now()` to preserve registration order. Under parallel injection, registration order becomes nondeterministic; that breaks prefix determinism and harms prompt caching. We want stable ordering for the same set of entries.

**Files:**
- Modify: `opencode-zh-build/oh_my_opencode-p1_6/src/features/context-injector/collector.ts`
- Modify: `opencode-zh-build/oh_my_opencode-p1_6/src/features/context-injector/collector.test.ts`

**Step 1: Update the test to assert deterministic ordering**

In `opencode-zh-build/oh_my_opencode-p1_6/src/features/context-injector/collector.test.ts`:

- Replace the “maintains registration order within same priority” expectation with a deterministic rule:
  - within the same priority, sort by `(source, id)` lexicographically.

Test patch sketch:

```ts
it("orders deterministically within same priority (source + id)", () => {
  const sessionID = "ses_order"
  collector.register(sessionID, { id: "b", source: "custom", content: "B", priority: "normal" })
  collector.register(sessionID, { id: "a", source: "custom", content: "A", priority: "normal" })
  const pending = collector.getPending(sessionID)
  expect(pending.entries.map((e) => e.id)).toEqual(["a", "b"])
})
```

Run: `cd opencode-zh-build/oh_my_opencode-p1_6 && bun test src/features/context-injector/collector.test.ts`

Expected: FAIL (collector currently keeps timestamp order).

**Step 2: Implement deterministic sort**

In `opencode-zh-build/oh_my_opencode-p1_6/src/features/context-injector/collector.ts`:
- Keep `timestamp` for debugging if you want, but do not use it for ordering.
- Sort rule:
  1. priority (existing)
  2. source (string)
  3. id (string)

Then run the same test, expect PASS.

**Step 3: Commit**

Run:
```bash
git -C opencode-zh-build/oh_my_opencode-p1_6 add -A
git -C opencode-zh-build/oh_my_opencode-p1_6 commit -m "refactor(context-injector): deterministic ordering for cache-friendly prompts [AI:Codex]"
```

---

### Task 5: oh-my-opencode — add budget + spill-to-file pointerization (reduce input tokens)

**Why:** Even with caching, pasting large dynamic context directly into the user prompt is expensive and reduces prefix stability. We want: small stable capsule in the prompt, big content stored locally with a pointer.

**Files:**
- Modify: `opencode-zh-build/oh_my_opencode-p1_6/src/features/context-injector/injector.ts`
- Create: `opencode-zh-build/oh_my_opencode-p1_6/src/features/context-injector/pointerize.ts`
- Modify: `opencode-zh-build/oh_my_opencode-p1_6/src/features/context-injector/injector.test.ts`

**Step 1: Add pointerization helper (unit-test first)**

Create `opencode-zh-build/oh_my_opencode-p1_6/src/features/context-injector/pointerize.ts` (test-driven via injector test below):

Behavior:
- Input: `{ sessionID, text, maxChars, baseDir }`
- If `text.length <= maxChars`: return `{ mode: "inline", text }`
- Else:
  - Compute `sha256(text)`; write to `${baseDir}/.opencode/context-capsules/<sha>.md`
  - Return `{ mode: "pointer", text: "<context_pointer>\\npath: ...\\nsha256: ...\\n</context_pointer>" }`

**Step 2: Update injector test to enforce budget**

In `opencode-zh-build/oh_my_opencode-p1_6/src/features/context-injector/injector.test.ts`:
- Add a new test:

```ts
it("spills large pending context to a file pointer instead of pasting", async () => {
  const hook = createContextInjectorMessagesTransformHook(collector)
  const sessionID = "ses_big"
  collector.register(sessionID, {
    id: "big",
    source: "custom",
    content: "X".repeat(50_000),
  })
  const messages = [createMockMessage("user", "Hello", sessionID)]
  const output: any = { messages }

  await hook["experimental.chat.messages.transform"]!({}, output)

  const injected = output.messages[0].parts[0].text as string
  expect(injected).toContain("<context_pointer>")
  expect(injected).toContain("sha256:")
  expect(injected.length).toBeLessThan(4000)
})
```

Run: `cd opencode-zh-build/oh_my_opencode-p1_6 && bun test src/features/context-injector/injector.test.ts`

Expected: FAIL (it pastes raw content today).

**Step 3: Implement budget + pointerization in injector**

In `injector.ts`:
- When consuming pending context:
  - Pass `pending.merged` through pointerize helper with a default budget (example: 4000 chars).
- Insert either:
  - inline text (small)
  - pointer capsule (large)

Important: do not put timestamps / Date.now in the *text* of the injected capsule.

**Step 4: Run tests**

Run:
- `cd opencode-zh-build/oh_my_opencode-p1_6 && bun test`

Expected: PASS.

**Step 5: Commit**

Run:
```bash
git -C opencode-zh-build/oh_my_opencode-p1_6 add -A
git -C opencode-zh-build/oh_my_opencode-p1_6 commit -m "feat(context-injector): budget + pointerize large injected context [AI:Codex]"
```

---

### Task 6: Sub2API — optional robustness: accept x-opencode-session + diagnostics (tiny patch)

**Why:** Even after OpenCode fixes, adding compatibility/diagnostics in Sub2API reduces future integration friction and makes on-site debugging easier.

**Files:**
- Modify: `sub2api-p1_6/backend/internal/service/openai_gateway_service.go`
- Modify: `sub2api-p1_6/backend/internal/service/openai_gateway_service_test.go`

**Step 1: Add test for x-opencode-session fallback**

In `sub2api-p1_6/backend/internal/service/openai_gateway_service_test.go`, extend `TestOpenAIGatewayService_GenerateSessionHash_Priority`:

- After case (4), add:

```go
// 5) x-opencode-session used when no session_id/conversation_id/prompt_cache_key
c.Request.Header.Set("x-opencode-session", "opencode-sess-999")
h5 := svc.GenerateSessionHash(c, map[string]any{})
if h5 == "" {
  t.Fatalf("expected non-empty hash from x-opencode-session")
}
```

Run: `cd sub2api-p1_6/backend && go test ./...`

Expected: FAIL (no x-opencode-session support).

**Step 2: Implement fallback in GenerateSessionHash**

In `sub2api-p1_6/backend/internal/service/openai_gateway_service.go`:

```go
if sessionID == "" {
  sessionID = strings.TrimSpace(c.GetHeader("x-opencode-session"))
}
```

Run tests again, expect PASS.

**Step 3: (Optional) Add response header for debugging**

If Sub2API already sets response headers, add a non-sensitive header like:
- `x-sub2api-session-hash-source: session_id|conversation_id|prompt_cache_key|x-opencode-session|none`

Keep it disabled by default behind config if needed.

**Step 4: Commit**

Run:
```bash
git -C sub2api-p1_6 add -A
git -C sub2api-p1_6 commit -m "feat(openai): sticky-session fallback for x-opencode-session [AI:Codex]"
```

---

### Task 6.1: Sub2API — Gemini v1beta sticky session (session_id header + contents-based fallback)

**Why:** In OpenCode / oh-my-opencode, a “session” is stable and should keep routing to the same upstream OAuth account when possible (otherwise cache + quota stability collapse). Sub2API’s Gemini handler currently derives sticky-session from a request parser that is optimized for `system/messages/metadata` (Anthropic-ish). For Gemini native requests (`contents/systemInstruction`), this often yields an empty session hash → account selection degenerates into load-aware rotation → any caching/context reuse is reduced.

**Files:**
- Modify: `sub2api-p1_6/backend/internal/handler/gemini_v1beta_handler.go`
- Create: `sub2api-p1_6/backend/internal/service/gemini_sticky_session_test.go`
- Modify: `sub2api-p1_6/backend/internal/service/gemini_sticky_session.go` (new helper)
- (Optional) Modify: `sub2api-p1_6/backend/internal/service/antigravity_gateway_service.go`

**Step 1: Write failing unit test for Gemini sticky-session key**

Create `sub2api-p1_6/backend/internal/service/gemini_sticky_session_test.go`:

```go
//go:build unit

package service

import (
  "net/http/httptest"
  "testing"

  "github.com/gin-gonic/gin"
  "github.com/stretchr/testify/require"
)

func TestGeminiStickySessionHash_PrefersSessionIDHeader(t *testing.T) {
  gin.SetMode(gin.TestMode)
  c, _ := gin.CreateTestContext(httptest.NewRecorder())
  c.Request = httptest.NewRequest("POST", "/v1beta/models/gemini-3-pro-high:generateContent", nil)
  c.Request.Header.Set("session_id", "ses_opencode_123")

  hash := GenerateGeminiStickySessionHash(c, []byte(`{"contents":[{"role":"user","parts":[{"text":"hello"}]}]}`))
  require.NotEmpty(t, hash)

  // Should be stable for the same session_id regardless of message content.
  hash2 := GenerateGeminiStickySessionHash(c, []byte(`{"contents":[{"role":"user","parts":[{"text":"different"}]}]}`))
  require.Equal(t, hash, hash2)
}

func TestGeminiStickySessionHash_FallsBackToFirstUserText(t *testing.T) {
  gin.SetMode(gin.TestMode)
  c, _ := gin.CreateTestContext(httptest.NewRecorder())
  c.Request = httptest.NewRequest("POST", "/v1beta/models/gemini-3-pro-high:generateContent", nil)

  body := []byte(`{"contents":[{"role":"user","parts":[{"text":"hello"}]}]}`)
  hash := GenerateGeminiStickySessionHash(c, body)
  require.NotEmpty(t, hash)

  // Same body -> same hash (deterministic)
  hash2 := GenerateGeminiStickySessionHash(c, body)
  require.Equal(t, hash, hash2)
}
```

Run: `cd sub2api-p1_6/backend && go test ./...`

Expected: FAIL (GenerateGeminiStickySessionHash does not exist).

**Step 2: Implement `GenerateGeminiStickySessionHash`**

Create `sub2api-p1_6/backend/internal/service/gemini_sticky_session.go`:

- Priority:
  1) `session_id` header (also accept `conversation_id` and `x-opencode-session` as fallbacks)
  2) request body: first user text from `contents[0].parts[0].text`
  3) fallback: empty string
- Hashing:
  - Use `sha256` → hex string (same style as OpenAI gateway)

**Step 3: Wire it into `GeminiV1BetaModels`**

In `sub2api-p1_6/backend/internal/handler/gemini_v1beta_handler.go`:

- Replace:
  - `parsedReq, _ := service.ParseGatewayRequest(body)`
  - `sessionHash := h.gatewayService.GenerateSessionHash(parsedReq)`
- With:
  - `sessionHash := service.GenerateGeminiStickySessionHash(c, body)`
- Keep:
  - `sessionKey := "gemini:" + sessionHash` when non-empty

**Step 4: (Optional but recommended) Propagate sessionId into Antigravity Gemini requests**

Why: Antigravity’s upstream v1internal request supports `sessionId` (and Sub2API already reads `session_id` header for logging). If we inject it into the forwarded Gemini request body, we increase the chance of upstream-side continuity/caching.

In `sub2api-p1_6/backend/internal/service/antigravity_gateway_service.go` inside `ForwardGemini`:
- If `session_id` header exists and request JSON does **not** already contain `"sessionId"`:
  - set `request["sessionId"] = headerValue` before wrapping into v1internal.

**Step 5: Run tests**

Run: `cd sub2api-p1_6/backend && go test ./...`

Expected: PASS.

**Step 6: Commit**

```bash
git -C sub2api-p1_6 add -A
git -C sub2api-p1_6 commit -m "feat(gemini): sticky-session from session_id header + contents fallback [AI:Codex]"
```

---

### Task 6.2: Sub2API — Anthropic Messages (/v1/messages) sticky session should accept session_id header (Antigravity Claude + Gemini compat)

**Why:** You’re using Sub2API’s `antigravity-claude` provider with `npm: "@ai-sdk/anthropic"` and `baseURL: /antigravity/v1`.
From OpenCode’s POV this is the **Anthropic Messages wire format**, so multi-turn “same session” stability must work here too.

Today Sub2API’s `/v1/messages` handler computes sticky-session only from request **body** (`metadata.user_id` / `cache_control` / system / first message).
But OpenCode cannot reliably set `metadata.user_id` via AI SDK provider options, and `cache_control` alone is not a stable “session identity” signal.

So for P1.6 option (1) we do the pragmatic thing:
- OpenCode sends `session_id` header (we already plan this via `stickySessionHeaders: true`)
- Sub2API’s `/v1/messages` handler must actually **use** `session_id` header as the highest priority sticky-session source

This improves:
- Antigravity Claude: stable upstream account routing (same OpenCode session stays on one OAuth account)
- Gemini compat via `/v1/messages` (if used): same benefit
- Any future prompt caching mechanics upstream might have: no longer sabotaged by cross-account rotation

**Files:**
- Modify: `sub2api-p1_6/backend/internal/handler/gateway_handler.go`
- Create: `sub2api-p1_6/backend/internal/handler/gateway_handler_sticky_session_test.go`

**Step 1: Write failing unit test**

Create `sub2api-p1_6/backend/internal/handler/gateway_handler_sticky_session_test.go`:

```go
//go:build unit

package handler

import (
  "crypto/sha256"
  "encoding/hex"
  "net/http"
  "net/http/httptest"
  "testing"

  "github.com/gin-gonic/gin"
  "github.com/stretchr/testify/require"
)

func TestMessages_StickySession_UsesSessionIDHeader(t *testing.T) {
  gin.SetMode(gin.TestMode)

  // We only validate the hash computation logic here (not full forwarding).
  // The handler should prefer session_id header over body-derived session hash.
  c, _ := gin.CreateTestContext(httptest.NewRecorder())
  c.Request = httptest.NewRequest(http.MethodPost, "/v1/messages", nil)
  c.Request.Header.Set("session_id", "ses_opencode_123")

  want := sha256.Sum256([]byte("ses_opencode_123"))
  wantHex := hex.EncodeToString(want[:])

  got := computeStickySessionHashFromHeaders(c)
  require.Equal(t, wantHex, got)
}
```

Expected: FAIL (helper does not exist).

**Step 2: Implement `computeStickySessionHashFromHeaders` and wire it**

In `sub2api-p1_6/backend/internal/handler/gateway_handler.go`:

- Add a small helper near the top:
  - `computeStickySessionHashFromHeaders(c *gin.Context) string`
  - Priority:
    - `session_id` → `conversation_id` → `x-opencode-session`
  - When found, hash via sha256 → hex string
- In `Messages(c)`:
  - Before `sessionHash := h.gatewayService.GenerateSessionHash(parsedReq)`:
    - compute `headerHash := computeStickySessionHashFromHeaders(c)`
    - if `headerHash != ""`, use it; else fallback to `GenerateSessionHash(parsedReq)`

**Step 3: Run tests**

Run: `cd sub2api-p1_6/backend && go test ./...`

Expected: PASS.

**Step 4: Commit**

```bash
git -C sub2api-p1_6 add -A
git -C sub2api-p1_6 commit -m "feat(messages): sticky-session prefers session_id header (antigravity claude) [AI:Codex]"
```

---

### Task 7: DeepSeek V3.2 API study + OpenCode integration notes (cache + tools + thinking)

**Why:** P1.6 is about token economy (cache hit + less prompt bloat) and must be a clean foundation for P2/P3 multi-model orchestration. DeepSeek is a top-priority “cheap+fast worker / strong tool calling” candidate, but its caching and thinking/tool semantics differ from OpenAI and Anthropic. We need an explicit, auditable integration mapping.

**Files:**
- Create: `opencode-zh-build/opencode_src-p1_6/docs/plans/2026-01-29-deepseek-v3_2-api-notes.md`

**Step 1: Create the notes doc (cache + thinking + tool calls + anthropic compat)**

Create `opencode-zh-build/opencode_src-p1_6/docs/plans/2026-01-29-deepseek-v3_2-api-notes.md` with:

- **上下文硬盘缓存（KV cache / disk cache）**
  - 默认开启，无需改代码即可享用。
  - 只对“重复前缀”生效（system + 共同前缀内容），动态内容越靠后越好。
  - 返回 `usage.prompt_cache_hit_tokens` / `usage.prompt_cache_miss_tokens`（用于观测命中与费用分层）。
  - 64 tokens 为单位缓存、尽力而为、构建耗时秒级、几小时到几天会过期（不保证 100% 命中）。

- **思考模式（deepseek-reasoner / thinking 参数）**
  - 开启方式：`model=deepseek-reasoner` 或 `thinking: { type: "enabled" }`。
  - `reasoning_content` 与 `content` 同级；多轮对话拼接时，不应把 `reasoning_content` 拼回上下文。
  - 思考模式下不支持（或忽略）部分参数：temperature/top_p/...；logprobs 会报错。
  - DeepSeek-V3.2 起支持“思考模式下的工具调用”。

- **Tool Calls（含 strict Beta）**
  - 非思考模式：OpenAI chat.completions 风格工具调用（tools + tool message 回填）。
  - strict 模式：需要 `base_url=https://api.deepseek.com/beta` + tools 中 function.strict=true；
    服务端校验 schema，`additionalProperties: false` 很关键。

- **Anthropic API 兼容**
  - `ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic`，`x-api-key` 支持。
  - `cache_control` 会被忽略（Anthropic prompt caching 的控制字段对 DeepSeek 这条兼容链路无效）。

- **OpenCode / oh-my-opencode 配置建议（落地到我们体系）**
  - DeepSeek 走 OpenAI-compatible（chat.completions）更自然：
    - baseURL：`https://api.deepseek.com`（注意：DeepSeek 文档的 chat endpoint 是 `/chat/completions`，不是 `/v1/chat/completions`）
    - model：`deepseek-chat` / `deepseek-reasoner`
  - 为最大化缓存命中：系统 prompt/AGENTS.md/README 注入必须稳定且尽量只追加在尾部（和 P3 的“prefix determinism”一致）。

Also include the source links at the bottom (for humans):
- `https://api-docs.deepseek.com/zh-cn/guides/kv_cache`
- `https://api-docs.deepseek.com/zh-cn/guides/thinking_mode`
- `https://api-docs.deepseek.com/zh-cn/guides/tool_calls`
- `https://api-docs.deepseek.com/zh-cn/guides/anthropic_api`
- `https://api-docs.deepseek.com/zh-cn/api/create-chat-completion`

**Step 2: Commit**

Run:
```bash
git -C opencode-zh-build/opencode_src-p1_6 add -A
git -C opencode-zh-build/opencode_src-p1_6 commit -m "docs(deepseek): add V3.2 api notes for cache/thinking/tools alignment [AI:Codex]"
```

---

### Task 8: OpenCode — DeepSeek cache-hit observability (normalize prompt_cache_hit_tokens into tokens.cache.read)

**Why:** DeepSeek 的“上下文硬盘缓存”命中是 token economy 的关键。但它返回的命中字段不是 OpenAI 的 `cached_tokens`。如果 OpenCode 不识别这些字段，我们就无法在 `opencode stats`/TUI 里对账，也无法做后续 P3 的跨模型命中率治理。

This task is intentionally scoped to **observability + normalization** only (no P3 cache store yet).

**Files:**
- Modify: `opencode-zh-build/opencode_src-p1_6/packages/opencode/src/provider/provider.ts`
- Create: `opencode-zh-build/opencode_src-p1_6/packages/opencode/src/provider/metadata/deepseek.ts`
- Modify: `opencode-zh-build/opencode_src-p1_6/packages/opencode/src/session/index.ts`
- Test: `opencode-zh-build/opencode_src-p1_6/packages/opencode/test/session/deepseek-cache-usage.test.ts`

**Step 1: Write failing test for DeepSeek cache usage normalization**

Create `opencode-zh-build/opencode_src-p1_6/packages/opencode/test/session/deepseek-cache-usage.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { Session } from "../../src/session"

describe("Session.getUsage - deepseek prompt_cache_* tokens", () => {
  test("maps prompt_cache_hit_tokens -> tokens.cache.read and prompt_cache_miss_tokens -> tokens.input", () => {
    const usage = Session.getUsage({
      model: {
        cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
      } as any,
      usage: { inputTokens: 1000, outputTokens: 200 } as any,
      metadata: {
        deepseek: {
          usage: {
            prompt_cache_hit_tokens: 300,
            prompt_cache_miss_tokens: 700,
          },
        },
      } as any,
    })

    expect(usage.tokens.cache.read).toBe(300)
    expect(usage.tokens.input).toBe(700)
    expect(usage.tokens.output).toBe(200)
  })
})
```

Run: `cd opencode-zh-build/opencode_src-p1_6/packages/opencode && bun test test/session/deepseek-cache-usage.test.ts`

Expected: FAIL (no deepseek mapping yet).

**Step 2: Add a DeepSeek metadata extractor helper**

Create `opencode-zh-build/opencode_src-p1_6/packages/opencode/src/provider/metadata/deepseek.ts`:

- Export a `deepseekMetadataExtractor` object compatible with `createOpenAICompatible({ metadataExtractor })`.
- Non-streaming: extract `parsedBody.usage.prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` if present.
- Streaming: capture the latest chunk that contains `usage` and emit it in `buildMetadata()`.

Keep typing simple and safe (use `unknown` + type guards); do not assume fields exist.

**Step 3: Wire the extractor for providerID=deepseek**

In `opencode-zh-build/opencode_src-p1_6/packages/opencode/src/provider/provider.ts`:

- Add a `CUSTOM_LOADERS.deepseek` loader:
  - Set `autoload: true`
  - Return `options: { metadataExtractor: deepseekMetadataExtractor }`
  - Do not override `baseURL` from config; just augment with metadata extraction.

This keeps DeepSeek integration “opt-in”: only applies when user configured a `deepseek` provider in `opencode.json`.

**Step 4: Implement the normalization in Session.getUsage**

In `opencode-zh-build/opencode_src-p1_6/packages/opencode/src/session/index.ts`:

- If `metadata?.deepseek?.usage?.prompt_cache_hit_tokens` and `prompt_cache_miss_tokens` are present numbers:
  - Set:
    - `tokens.cache.read = hit`
    - `tokens.input = miss`
  - Do **not** double-subtract using `usage.cachedInputTokens` in this branch.

Rationale: DeepSeek already splits input into hit/miss tokens; we can treat this as our “cache.read vs input” canonical split.

**Step 5: Run test (expect pass)**

Run: `cd opencode-zh-build/opencode_src-p1_6/packages/opencode && bun test test/session/deepseek-cache-usage.test.ts`

Expected: PASS.

**Step 6: Commit**

Run:
```bash
git -C opencode-zh-build/opencode_src-p1_6 add -A
git -C opencode-zh-build/opencode_src-p1_6 commit -m "feat(deepseek): normalize prompt_cache_hit/miss tokens into cache.read [AI:Codex]"
```

---

### Task 9: OpenCode — DeepSeek thinking mode: never replay reasoning_content into the next turn

**Why:** DeepSeek “思考模式”明确说明：每轮输出包含 `reasoning_content` + `content`，但下一轮对话拼接时 **不应把 `reasoning_content` 拼回上下文**。如果 OpenCode 把 reasoning part 作为普通历史消息回放，会：
- 极大增加 input tokens（尤其是 reasoning 很长时）
- 破坏前缀稳定性，降低缓存命中
- 与 DeepSeek 文档建议相冲突（潜在行为差异）

**Files:**
- Modify: `opencode-zh-build/opencode_src-p1_6/packages/opencode/src/provider/transform.ts`
- Test: `opencode-zh-build/opencode_src-p1_6/packages/opencode/test/provider/deepseek-thinking-replay.test.ts`

**Step 1: Write failing test**

Create `opencode-zh-build/opencode_src-p1_6/packages/opencode/test/provider/deepseek-thinking-replay.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { ProviderTransform } from "../../src/provider/transform"

describe("ProviderTransform.message - deepseek", () => {
  test("drops reasoning parts from assistant messages for deepseek-reasoner history replay", () => {
    const model = {
      id: "deepseek/deepseek-reasoner",
      providerID: "deepseek",
      api: { id: "deepseek-reasoner", npm: "@ai-sdk/openai-compatible" },
      capabilities: {
        temperature: true,
        reasoning: true,
        attachment: false,
        toolcall: true,
        input: { text: true, audio: false, image: false, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
    } as any

    const msgs = ProviderTransform.message(
      [
        { role: "user", content: "Q" },
        {
          role: "assistant",
          content: [
            { type: "reasoning", text: "SHOULD_NOT_BE_REPLAYED" },
            { type: "text", text: "A" },
          ],
        },
      ] as any,
      model,
      {},
    )

    const assistant = msgs.find((m) => m.role === "assistant")
    expect(Array.isArray(assistant?.content)).toBe(true)
    expect((assistant!.content as any[]).some((p) => p.type === "reasoning")).toBe(false)
  })
})
```

Run: `cd opencode-zh-build/opencode_src-p1_6/packages/opencode && bun test test/provider/deepseek-thinking-replay.test.ts`

Expected: FAIL (today reasoning parts are replayed unless model interleaved rules kick in).

**Step 2: Implement minimal filter**

In `opencode-zh-build/opencode_src-p1_6/packages/opencode/src/provider/transform.ts` inside `normalizeMessages(...)`:

- Add a DeepSeek-specific rule *before* returning:
  - If model is DeepSeek reasoner (suggested detection):
    - `model.providerID === "deepseek"` AND (`model.api.id.includes("reasoner")` OR `model.id.toLowerCase().includes("deepseek-reasoner")`)
  - Then for assistant messages with array content:
    - Drop `part.type === "reasoning"`

Do not touch non-DeepSeek models.

**Step 3: Run test (expect pass)**

Run: `cd opencode-zh-build/opencode_src-p1_6/packages/opencode && bun test test/provider/deepseek-thinking-replay.test.ts`

Expected: PASS.

**Step 4: Commit**

Run:
```bash
git -C opencode-zh-build/opencode_src-p1_6 add -A
git -C opencode-zh-build/opencode_src-p1_6 commit -m "fix(deepseek): do not replay reasoning_content in history [AI:Codex]"
```

---

### Task 10: GLM-4.7 API study + OpenCode integration notes (cache + thinking + tools)

**Why:** P1.6 is a multi-model foundation: later P2/P3 will allow a main agent + sandbox worker agents using different models. We need to understand GLM-4.7’s **context caching** and **thinking/tool** semantics so we can: (1) keep prompts cache-friendly (stable prefixes), and (2) not accidentally bloat tokens by replaying the wrong content.

**Files:**
- Create: `opencode-zh-build/opencode_src-p1_6/docs/plans/2026-01-29-zai-glm-4_7-api-notes.md`

**Step 1: Create the notes doc (cache + thinking + tools + endpoints)**

Create `opencode-zh-build/opencode_src-p1_6/docs/plans/2026-01-29-zai-glm-4_7-api-notes.md` with:

- **API / Endpoint**
  - OpenAI Chat Completions compatible endpoint:
    - Base URL: `https://api.z.ai/api/paas/v4/`
    - Path: `/chat/completions`
  - (Optional) Z.AI “Coding Plan” endpoint exists as well (separate base URL), but P1.6 only needs chat-completions semantics.

- **Context Caching**
  - GLM caching is automatic; response usage includes:
    - `usage.prompt_tokens_details.cached_tokens`
  - In OpenCode, when using `@ai-sdk/openai-compatible`, this field is already mapped to:
    - `LanguageModelUsage.cachedInputTokens`
    - which then surfaces as `tokens.cache.read` in `Session.getUsage`.
  - Practical implications:
    - Stable, repeated prefix (system + long shared history) will be discounted; dynamic content should be placed as late as possible.

- **Thinking Mode**
  - GLM-4.7 thinking is enabled by default.
  - Disable per turn by adding:
    - `thinking: { type: "disabled" }`
  - Interleaved thinking with tools:
    - preserve and return thinking blocks together with the reasoning message.
    - avoid reordering/editing thinking blocks if you want cache hit-rates to remain strong.
  - OpenCode alignment:
    - GLM models in models.dev typically use `interleaved: { field: "reasoning_content" }`.
    - OpenCode already maps assistant `reasoning` parts into `reasoning_content` fields on replay (via `ProviderTransform.normalizeMessages`).

- **Tool Calls**
  - Uses OpenAI-style `tools` + `tool_choice` and returns `tool_calls`.
  - Response contains `choices.message.tool_calls` and optionally `choices.message.reasoning_content`.

- **Anthropic Compatibility**
  - Z.AI provides Anthropic-compatible examples, but for P1.6 we do **not** need Anthropic wire format to get tool calling.
  - Prefer OpenAI-compatible Chat Completions path for consistency with OpenCode’s current provider stack.

**Step 2: Commit docs**

Run:
```bash
git -C opencode-zh-build/opencode_src-p1_6 add -A
git -C opencode-zh-build/opencode_src-p1_6 commit -m "docs(zai): add GLM-4.7 cache/thinking/tool integration notes [AI:Codex]"
```

---

### Task 11: (Optional) OpenCode docs — multi-model config snippets for DeepSeek + GLM + MiniMax

**Why:** In practice, users will want to swap models per agent/task. If we provide a canonical “known good” config snippet, we reduce time-to-first-cache-hit and avoid accidental token bloat.

**Files:**
- Modify (docs): `opencode-zh-build/opencode_src-p1_6/docs/plans/codex-cli-notes.md`

**Step 1: Add GLM provider snippet (OpenAI-compatible)**

Add a short section showing a minimal provider config for GLM (example only):
- provider npm: `@ai-sdk/openai-compatible`
- baseURL: `https://api.z.ai/api/paas/v4`
- (optional) disable thinking for cheap/fast worker agents:
  - `thinking: { type: "disabled" }`

**Step 2: Add DeepSeek provider snippet**

Add a short section showing:
- baseURL: `https://api.deepseek.com`
- note: deepseek KV cache is prefix-based; keep stable prefixes and avoid replaying reasoning for `deepseek-reasoner`.

**Step 3: Add MiniMax provider snippet(s) (recommended: Anthropic-compatible for caching)**

Add a short section showing **two** ways to use MiniMax:

- **(Recommended for caching)** Anthropic-compatible endpoint + prompt cache:
  - provider npm: `@ai-sdk/anthropic`
  - baseURL: `https://api.minimaxi.com/anthropic`
  - models: `MiniMax-M2.1` (and/or `MiniMax-M2.1-lightning`, `MiniMax-M2`)
  - note: prompt caching is controlled by `cache_control` (AI SDK maps this via providerOptions),
    cache lifetime is short (minutes), but cache read/write tokens show up in usage.

- **(Optional for speed / ecosystem)** OpenAI-compatible endpoint:
  - provider npm: `@ai-sdk/openai-compatible`
  - baseURL: `https://api.minimaxi.com/v1`
  - models: `MiniMax-M2.1`, `MiniMax-M2.1-lightning`, `MiniMax-M2`
  - note: MiniMax docs state OpenAI-compatible cache docs are “coming soon”, so do not expect prompt caching via this wire format yet.

**Step 4: Commit**

Run:
```bash
git -C opencode-zh-build/opencode_src-p1_6 add -A
git -C opencode-zh-build/opencode_src-p1_6 commit -m "docs(models): add DeepSeek/GLM config snippets [AI:Codex]"
```

---

### Task 12: MiniMax-M2.1 API study + OpenCode integration notes (cache + tools + interleaved thinking)

**Why:** MiniMax-M2.1’s token economy story is different from DeepSeek/GLM:
- MiniMax’s **prompt caching** is documented and fully supported via **Anthropic-compatible** API using `cache_control`.
- MiniMax’s **OpenAI-compatible** API supports tools + a “reasoning_split” mode, but the cache doc for OpenAI wire format is marked as “coming soon”.

We need an explicit integration note so future P2/P3 “model layering” can pick MiniMax as a sandbox worker model without accidentally losing tool-chain continuity or missing prompt cache opportunities.

**Files:**
- Create: `opencode-zh-build/opencode_src-p1_6/docs/plans/2026-01-29-minimax-m2_1-api-notes.md`

**Step 1: Create the notes doc**

Create `opencode-zh-build/opencode_src-p1_6/docs/plans/2026-01-29-minimax-m2_1-api-notes.md` with:

- **Model IDs (as documented)**
  - `MiniMax-M2.1`
  - `MiniMax-M2.1-lightning`
  - `MiniMax-M2`

- **API Endpoints**
  - OpenAI-compatible: base URL `https://api.minimaxi.com/v1` (Chat Completions)
  - Anthropic-compatible: base URL `https://api.minimaxi.com/anthropic` (Messages)

- **Prompt Caching (recommended path)**
  - Uses Anthropic-compatible API with `cache_control: { type: "ephemeral" }` blocks.
  - Usage fields include:
    - `cache_creation_input_tokens` (cache write)
    - `cache_read_input_tokens` (cache read)
  - Cache lifetime is short (minutes) and refreshes on hits.
  - Pricing model differentiates cache read/write (read much cheaper than normal input).
  - OpenCode alignment:
    - Using `@ai-sdk/anthropic`, AI SDK maps:
      - `cache_read_input_tokens` → `usage.cachedInputTokens` → OpenCode `tokens.cache.read`
      - `cache_creation_input_tokens` → `providerMetadata.anthropic.cacheCreationInputTokens` → OpenCode `tokens.cache.write`

- **Tool Use + Interleaved Thinking**
  - MiniMax recommends: in multi-turn tool use, always replay the full assistant output (including thinking) to keep interleaved thinking coherent.
  - OpenAI-compatible API:
    - native format may embed `<think>...</think>` in `content` and must be preserved if used.
    - optional `reasoning_split=true` moves thinking into `reasoning_details`; client must preserve it.
  - Anthropic-compatible API:
    - `response.content` is a list of blocks (thinking/text/tool_use/tool_result) and should be fully replayed.

- **Practical recommendation for OpenCode**
  - Prefer Anthropic-compatible provider (`@ai-sdk/anthropic`) for MiniMax when you want caching + tool-chain coherence.
  - Use OpenAI-compatible provider (`@ai-sdk/openai-compatible`) only when you explicitly prioritize compatibility/speed and accept that prompt caching may not be available yet.

**Step 2: Commit docs**

Run:
```bash
git -C opencode-zh-build/opencode_src-p1_6 add -A
git -C opencode-zh-build/opencode_src-p1_6 commit -m "docs(minimax): add M2.1 cache/tools/interleaved thinking notes [AI:Codex]"
```

---

### Task 12.1: Gemini + Antigravity API study + OpenCode integration notes (cache + tools + thinking + session)

**Why:** You explicitly want OpenCode/oh-my-opencode to support multi-model workflows (main agent + sandbox workers + parallel subagents). Google’s Gemini + the “Antigravity” subscription chain have different caching semantics than OpenAI:
- Gemini’s token economy is mainly via **Cached Content** (explicit prefix caching) and/or upstream-side context handling; not OpenAI-style automatic prompt caching.
- Sub2API’s Antigravity platform uses an internal v1internal API and supports a subset of Gemini + Claude models; stable session signaling is important for quota + any upstream continuity.

We need a single “integration notes” document so P2/P3 can safely add model layering without losing caching/tool continuity.

**Files:**
- Create: `opencode-zh-build/opencode_src-p1_6/docs/plans/2026-01-29-gemini-antigravity-api-notes.md`

**Step 1: Create the notes doc**

Create `opencode-zh-build/opencode_src-p1_6/docs/plans/2026-01-29-gemini-antigravity-api-notes.md` with:

- **What is Antigravity (in our stack)**
  - In Sub2API this is a platform that forwards to Google’s `cloudcode-pa` internal API (v1internal).
  - Supports both:
    - Gemini models (examples in Sub2API mapping: `gemini-3-flash`, `gemini-3-pro-high`, `gemini-3-pro-image`)
    - Claude models (examples: `claude-sonnet-4-5`, `claude-opus-4-5-thinking`)

- **Gemini caching model**
  - Expect `usageMetadata.cachedContentTokenCount` (Gemini) / `cache_read_input_tokens` (Anthropic) style metrics, not OpenAI `cached_tokens`.
  - Cached Content is explicit: create a cached content resource and reference it in subsequent calls (P3 can automate; P1.6 only documents it).
  - OpenCode alignment:
    - `@ai-sdk/google` maps cached content tokens into `usage.cachedInputTokens` (so `opencode stats` can show Cache Read).

- **Session stability rules (Sub2API gateway-friendly)**
  - Always send `session_id` header from OpenCode when calling Sub2API for:
    - OpenAI responses (prompt caching + sticky routing)
    - Gemini v1beta (sticky routing)
    - Anthropic messages (logs + future-proof)
  - For Anthropic-compatible requests routed to Antigravity (your `antigravity-claude` provider):
    - **P1.6 best practice:** rely on the `session_id` header for sticky routing (see Task 6.2).
    - If you have a custom client that *can* set Anthropic `metadata.user_id`, you may set:
      - `metadata.user_id = "session_<OpenCodeSessionID>"` (Sub2API/Antigravity will use it as an internal sessionId override),
      - but note: OpenCode + `@ai-sdk/anthropic` does not expose this cleanly today, so do not block P1.6 on it.

- **Tool calling**
  - Gemini uses `tools.functionDeclarations` (OpenAI-like function calling semantics, but different payload shapes).
  - Antigravity’s Gemini path in Sub2API uses `functionCallingConfig.mode="VALIDATED"` by default; schema must be strict/valid.

- **Config examples (OpenCode)**
  - Gemini via Sub2API:
    - npm: `@ai-sdk/google`
    - baseURL: `http://127.0.0.1:18080/v1beta`
    - auth header: use `x-goog-api-key` with Sub2API-issued API key (Sub2API supports it for Gemini CLI compatibility)
    - model IDs: start with `gemini-3-flash` and `gemini-3-pro-high`
  - Claude via Sub2API Antigravity:
    - npm: `@ai-sdk/anthropic`
    - baseURL: `http://127.0.0.1:18080/antigravity/v1`
    - auth header: `x-api-key` (or `Authorization: Bearer`)
    - model IDs: `claude-sonnet-4-5`, `claude-opus-4-5-thinking`
    - provider option: `stickySessionHeaders: true` (so OpenCode sends `session_id`)

- **Antigravity Claude (Anthropic wire) best-practice template**

Add a short, copy-paste friendly OpenCode provider snippet that matches your Sub2API dashboard export style:

```jsonc
{
  "provider": {
    "antigravity-claude": {
      "name": "Antigravity (Claude)",
      "npm": "@ai-sdk/anthropic",
      "options": {
        "baseURL": "http://127.0.0.1:18080/antigravity/v1",
        "apiKey": "sk-***",
        // P1.6: ensure Sub2API sticky-session stays stable across turns:
        "stickySessionHeaders": true
      },
      "models": {
        "claude-sonnet-4-5": { "name": "Claude Sonnet 4.5" },
        "claude-sonnet-4-5-thinking": { "name": "Claude Sonnet 4.5 Thinking" },
        "claude-opus-4-5-thinking": { "name": "Claude Opus 4.5 Thinking" }
      }
    }
  }
}
```

Notes:
- “Anthropic wire format” here only means the client/server protocol. The upstream is still Antigravity; prompt caching mechanics may differ.
- The biggest P1.6 win is: stable sticky session + reduced prompt bloat (oh-my-opencode budget/pointerization).

**Step 2: Commit docs**

Run:
```bash
git -C opencode-zh-build/opencode_src-p1_6 add -A
git -C opencode-zh-build/opencode_src-p1_6 commit -m "docs(gemini): add Gemini/Antigravity cache/tools/session notes [AI:Codex]"
```

---

### Task 13: End-to-end verification (OpenCode + oh-my + Sub2API + DeepSeek + GLM + MiniMax)

**Files:**
- Modify (docs): `opencode-zh-build/opencode_src-p1_6/docs/plans/codex-cli-notes.md` (or add a new doc)

**Step 1: Document config mapping (Codex CLI -> OpenCode)**

Add a snippet for OpenCode users who want parity with:

```toml
wire_api = "responses"
disable_response_storage = true
model_reasoning_effort = "high"
model_verbosity = "high"
```

Explain:
- In OpenCode provider config: set `wireApi` / `wire_api` to `"responses"`
- Ensure `store=false` (already default for openai npm providers)
- If needed: set `reasoningEffort="high"` and `textVerbosity="high"` at model options level

**Step 2: Manual run — verify cached tokens**

1) Start an OpenCode session that uses `sub2api/gpt-5.2-codex`.
2) Run the same prompt twice.
3) Verify:
   - Sub2API dashboard shows cache read tokens on 2nd call.
   - OpenCode `opencode stats` shows Cache Read.
4) Repeat with oh-my-opencode enabled and a large injected context entry:
   - Verify injection uses a pointer capsule and does not bloat the prompt.
5) DeepSeek cache observability sanity check (requires DeepSeek key):
   - Configure a `deepseek` provider in `opencode.json` with:
     - npm: `@ai-sdk/openai-compatible`
     - baseURL: `https://api.deepseek.com`
     - models: `deepseek-chat`
   - Send two requests with a long shared prefix (e.g. same system prompt + same long context blob, only question differs).
   - Wait ~2-5 seconds between the first and second request (DeepSeek KV cache build is seconds-level).
   - Verify:
     - `opencode stats` shows non-zero `Cache Read` (mapped from `prompt_cache_hit_tokens`).
     - DeepSeek response `usage` contains `prompt_cache_hit_tokens`/`prompt_cache_miss_tokens` (optional: inspect via debug logs or provider metadata view).

6) GLM cache observability sanity check (requires Z.AI key):
   - Configure a `zai` provider in `opencode.json` with:
     - npm: `@ai-sdk/openai-compatible`
     - baseURL: `https://api.z.ai/api/paas/v4`
     - models (exact model codes per Z.AI Chat Completion API reference):
       - `glm-4.7` (flagship)
       - `glm-4.7-flash` (Flash; free/lightweight)
       - `glm-4.7-flashx` (FlashX; lightweight + higher capability than Flash)
   - Send two requests with a long shared prefix (same system + same long context blob).
   - Verify:
     - response usage contains `usage.prompt_tokens_details.cached_tokens` (as documented by Z.AI)
     - `opencode stats` shows non-zero `Cache Read` for the second request (mapped via AI SDK → `cachedInputTokens`).

7) MiniMax prompt caching sanity check (requires MiniMax key):
   - Configure a `minimax` provider in `opencode.json` with:
     - npm: `@ai-sdk/anthropic`
     - baseURL: `https://api.minimaxi.com/anthropic`
     - models: `MiniMax-M2.1` (and/or `MiniMax-M2.1-lightning`, `MiniMax-M2`)
   - Send two requests with a long shared prefix (same system + same large static context), within a few minutes.
   - Verify:
     - OpenCode `opencode stats` shows non-zero `Cache Write` on the first request (cache_creation_input_tokens)
     - OpenCode `opencode stats` shows non-zero `Cache Read` on the second request (cache_read_input_tokens)
   - If you get “model not supported” on Anthropic endpoint:
     - fall back to `MiniMax-M2` (docs historically mention only M2 on Anthropic wire format),
       and record which models are actually supported in the notes doc for future reference.

8) Gemini/Antigravity routing stability sanity check (requires Sub2API gemini/antigravity accounts):
   - Configure a `google` provider in `opencode.json` pointing to Sub2API:
     - npm: `@ai-sdk/google`
     - baseURL: `http://127.0.0.1:18080/v1beta`
     - api key: Sub2API-issued key (passed via `x-goog-api-key`)
     - model: `gemini-3-flash` (fast) or `gemini-3-pro-high` (strong)
   - Start an OpenCode session and run the same prompt twice.
   - Verify:
     - Sub2API dashboard shows the same upstream account being used for both calls (sticky session works).
     - If you later add Cached Content (P3 automation), `opencode stats` should show `Cache Read` via `usageMetadata.cachedContentTokenCount`.

9) Antigravity Claude (Anthropic wire) routing stability sanity check:
   - Configure an `antigravity-claude` provider in `opencode.json`:
     - npm: `@ai-sdk/anthropic`
     - baseURL: `http://127.0.0.1:18080/antigravity/v1`
     - model: `claude-sonnet-4-5` (or `claude-opus-4-5-thinking`)
     - provider option: `stickySessionHeaders: true` (so OpenCode sends `session_id`)
   - Run the same prompt twice in the same OpenCode session.
   - Verify in Sub2API dashboard:
     - the same antigravity upstream account is used across turns (sticky session is stable).

**Step 3: Gate**

Run (OpenCode repo):
- `cd opencode-zh-build/opencode_src-p1_6 && npm run guard`
- `cd opencode-zh-build/opencode_src-p1_6 && npm run gate`

Run (oh-my repo):
- `cd opencode-zh-build/oh_my_opencode-p1_6 && bun test`

Run (sub2api repo):
- `cd sub2api-p1_6/backend && go test ./...`

Expected: PASS.

---

## Execution Handoff

Plan complete and saved to `docs/plans/2026-01-29-opencode-sub2api-token-economy-p1_6-implementation-plan.md`.

Two execution options:

1) Subagent-Driven (this session) — use `superpowers:subagent-driven-development`, dispatch one task at a time, review between tasks.
2) Parallel Session (separate) — open a new session and use `superpowers:executing-plans` to execute task-by-task with checkpoints.

Which approach do you want (1 or 2)?
