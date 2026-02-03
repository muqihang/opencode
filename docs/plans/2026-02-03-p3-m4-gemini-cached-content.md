# P3 Milestone 4: Gemini Cached Content Lifecycle Automation — Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** For Gemini requests via `@ai-sdk/google` (`providerID=google`, sdkKey `google`), automate **Cached Content** lifecycle (create/reuse/expire/invalidate/degrade) so Gemini can report `usageMetadata.cachedContentTokenCount` → `tokens.cache.read` and we can observe/cache-audit it.

**Architecture:** Build a small `GeminiCachedContent` helper that:
1) selects a deterministic, explainable “cacheable system instruction prefix” derived from the **actual system messages** sent to Gemini (excluding the routing capsule),
2) computes `cachedContentKey = sha256(stableJson(spec + versions + model + ttl + fingerprint))`,
3) stores `{ cachedContentId, expiresAtUtc }` in local `CacheStore` namespace `provider.gemini.cached-content`,
4) emits evidence events for lifecycle edges, referencing a small summary artifact (no raw prompt text in events),
5) respects `AbortSignal` + per-request timeout; on failures, degrades to normal Gemini request (no cached content).

**Tech Stack:** Bun, TypeScript, existing `CacheStore`, existing `EvidenceWriter`, existing `stableJson` + `sha256Text`.

---

### Task 1: Add lifecycle state machine tests (RED)

**Files:**
- Create: `packages/opencode/test/provider/gemini-cached-content.test.ts`

**Step 1: Write failing tests (no mocks)**

Use `Bun.serve()` as a local HTTP stub (real I/O), implementing:
- `POST /v1beta/cachedContents` → returns `{ name: "cachedContents/<id>" }`
- `GET /v1beta/<cachedContentId>` → 200 for valid ids, 404 for invalid ids

Test cases (minimum DoD):
1) `create → reuse → expire → recreate`
2) `invalid id → invalidate → recreate (max once)`
3) `disabled via env/config → no create/no reuse`

Run: `cd packages/opencode && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test`
Expected: FAIL (module not found / behavior missing)

---

### Task 2: Implement `GeminiCachedContent` module (GREEN)

**Files:**
- Create: `packages/opencode/src/provider/gemini-cached-content.ts`
- Modify (if needed): `packages/opencode/src/flag/flag.ts`

**Step 1: Define deterministic key + prefix selection**

- Select cacheable prefix from **system instructions actually sent to Gemini**:
  - Include: stable system message segments (permissions / decision boundary / environment / user instructions, etc.)
  - Exclude: the routing capsule (`<routing>...</routing>`) to avoid per-call churn
  - Exclude: tool definitions (tools are still passed in the request)
- Build an **explainable** spec object:
  - `specVersion`, `selectorVersion`, `stableJsonVersion`, `model`, `ttlMs`, `blockFingerprints`, `toolsetFingerprint`
- Compute `cachedContentKey = sha256Text(stableJson(spec))`

**Step 2: CacheStore persistence**

- `namespace = "provider.gemini.cached-content"`
- Store value:
  - `{ specVersion: "gemini-cached-content/1.0", cachedContentKey, cachedContentId, expiresAtUtc, ttlMs }`
- TTL in CacheStore = `ttlMs` (same as provider cached content TTL, to keep local+remote aligned)

**Step 3: HTTP API calls (respect abort + timeout)**

- Create cached content:
  - `POST {baseURL}/cachedContents` with JSON:
    - `ttl` (seconds) or provider-supported ttl field
    - `systemInstruction` (preferred) so semantics match Gemini system instructions
  - Parse `name` as `cachedContentId` and compute `expiresAtUtc`
- Validate cached content id on reuse:
  - `GET {baseURL}/{cachedContentId}`
  - On 404/invalid: emit `invalidated`, then force rebuild once
- On any create failure:
  - emit `degraded` with a Chinese reason
  - return “no cached content” and allow normal request

**Step 4: Event emission (summary + pointers only)**

Emit these events (names can be adjusted but must be closed-loop):
- `gemini.cached_content.created`
- `gemini.cached_content.reused`
- `gemini.cached_content.expired`
- `gemini.cached_content.invalidated`
- `gemini.cached_content.degraded`

Each event `data` should only contain:
- small summary: `key`, `ttlMs`, `cachedContentId` (audit), `reason` (Chinese)
- pointers: artifact path + sha256 (summary JSON only)

Run: `cd packages/opencode && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test`
Expected: PASS

---

### Task 3: Integrate into `LLM.stream` (GREEN)

**Files:**
- Modify: `packages/opencode/src/session/llm.ts`

**Step 1: Gate to Gemini only**

Apply cached content automation only when:
- `input.model.api.npm === "@ai-sdk/google"` AND provider sdkKey resolves to `google`
- AND feature is not disabled by env/config

**Step 2: Apply cached content to request**

- After `ContextBlocksCache.build()` (so we have block fingerprints) and before `streamText()`:
  - resolve cached content id via `GeminiCachedContent.resolve(...)`
  - inject into provider options (google provider options) with the correct field name supported by `@ai-sdk/google`
  - omit the cached prefix system segments from request system messages to maximize hit rate and avoid duplication

**Step 3: Evidence events**

Use existing `EvidenceWriter` (already opened in `LLM.stream`) to write lifecycle events + small summary artifact.

Run: `cd packages/opencode && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test`
Expected: PASS

---

### Task 4: Verification (before completion)

Run (required): `cd packages/opencode && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test`
Expected: `0 fail`

---

### Completion (Option 3)

Keep the branch + worktree as-is and report:
- branch name + worktree path
- `git log -1 --oneline`
- key files touched (with `:1`)
- test command + pass summary
- at most 1 open question
