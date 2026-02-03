# P3 Milestone 4: Multi-Provider Cache + Usage Normalization (Provider Cache SSOT)

> **For Codex/Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Unify DeepSeek / GLM (ZAI) / MiniMax / Gemini / Claude (Anthropic) / OpenAI usage+cache semantics into a versioned, auditable structure and write reconcilable events (`usage.normalized`, `cache.read`, `cache.write`). Local cache remains SSOT; provider cache is an accelerator.

**Architecture (M4 scope):**
- Keep existing `Session.getUsage()` semantics unchanged (do not rename or repurpose `tokens.input/output/reasoning/cache.*`).
- Add a **pure** normalization layer that produces `UsageNormalizedV1` (versioned spec + explicit unknown/derived states).
- Emit evidence events at step boundaries (where `Session.getUsage()` is already computed) with **summary + artifact pointers** only.
- Provider-specific “risky” extraction (e.g. OpenAI-compatible chat cached_tokens nesting) must be behind feature flags.

**Non-goals (M4):**
- Do not make provider cache SSOT.
- Do not store large raw provider responses in events (only small summaries or artifact pointers).
- Do not infer missing fields (“should exist”); missing is **unknown** with explicit `source` and `note`.

---

## 1) Spec: UsageNormalizedV1 (versioned, auditable)

### 1.1 Semantics (hard requirements)

- `tokens.promptTokens` means **billable/effective prompt tokens**:
  - It MUST match existing `Session.getUsage().tokens.input` semantics: "effective billed prompt tokens after excluding cache read tokens" (avoid cross-provider double-subtract / fake reconciliation).
- `tokens.cacheHit`:
  - Only allowed to be `derived=true` when `cacheReadTokens` is `known|derived` AND `> 0`.
  - If `cacheReadTokens` is `unknown`, `cacheHit` MUST be `unknown` (no pretending).
- All missing provider fields MUST be represented as `unknown` with `source` and `note`. No guessing.

### 1.2 Data model (v1)

`UsageNormalizedV1` is intended to be stable and event-friendly. It is NOT a raw provider dump.

```ts
export type UsageSpecVersion = "usage-normalized/1.0"

export type UsageMeasure =
  | { state: "known"; value: number; source: string }
  | { state: "derived"; value: number; source: string; note: string }
  | { state: "unknown"; value: null; source: string; note: string }

export type UsageBool =
  | { state: "known"; value: boolean; source: string }
  | { state: "derived"; value: boolean; source: string; note: string }
  | { state: "unknown"; value: null; source: string; note: string }

export type UsageNormalizedV1 = {
  specVersion: UsageSpecVersion

  provider: {
    providerID: string
    apiNpm: string
    modelID: string
    wire: "openai.responses" | "openai.chat" | "anthropic.messages" | "google.gemini" | "unknown"
    maturity: "experimental" | "beta" | "stable"
  }

  tokens: {
    // billable/effective
    promptTokens: UsageMeasure
    completionTokens: UsageMeasure
    // billable/effective total (NOT provider-reported total)
    totalTokens: UsageMeasure

    cacheReadTokens: UsageMeasure
    cacheWriteTokens: UsageMeasure
    cacheHit: UsageBool
  }

  // Strict rule: pointer + tiny summary only (never big raw JSON)
  providerRaw:
    | null
    | {
        kind: "artifact"
        pointer: string
        summary?: Record<string, string | number | boolean | null>
      }
}
```

Notes:
- `tokens.totalTokens` in normalized v1 is **billable total** = `promptTokens + completionTokens` (derived) to keep it comparable across providers.
- Provider-reported totals (if present) can live inside `providerRaw.summary` (tiny) and/or an artifact, but must not change normalized semantics.

---

## 2) Provider Mapping Table (source-of-truth = repo code + existing docs)

This table defines where we read cache-related usage fields from, and how we map them.

### 2.1 OpenAI (Responses API)

**Wire:** `openai.responses`  
**Maturity:** `stable`

**Fields:**
- `inputTokens`: `response.usage.input_tokens` (already mapped into AI SDK usage)
- `outputTokens`: `response.usage.output_tokens`
- `cachedInputTokens` (cache read): `response.usage.input_tokens_details.cached_tokens`
- cache write: **unknown** (no reliable field in current code path)

**Code fact:** `packages/opencode/src/provider/sdk/openai-compatible/src/responses/openai-responses-language-model.ts`

### 2.2 Claude / Anthropic (Anthropic Messages)

**Wire:** `anthropic.messages`  
**Maturity:** `beta`

**Fields (as available in current stack):**
- `cache.write`: `providerMetadata.anthropic.cacheCreationInputTokens` (already used by `Session.getUsage`)
- `cache.read`: prefer `usage.cachedInputTokens` if AI SDK provides it; otherwise unknown

**Code fact:** `packages/opencode/src/session/index.ts` (`Session.getUsage`)

### 2.3 MiniMax (Anthropic-compatible)

**Wire:** `anthropic.messages` (Anthropic-compatible)  
**Maturity:** `beta`

**Docs expectation:** MiniMax usage contains `cache_read_input_tokens` / `cache_creation_input_tokens` (or equivalent).  
**Implementation reality:** we only trust what AI SDK provides:
- `cache.write`: via `providerMetadata.anthropic.cacheCreationInputTokens` if provided
- `cache.read`: via `usage.cachedInputTokens` if provided

**Docs:** `docs/plans/2026-01-29-minimax-m2_1-api-notes.md`

### 2.4 DeepSeek (OpenAI-compatible)

**Wire:** `openai.chat` (OpenAI-compatible)  
**Maturity:** `beta`

**Docs expectation:**
- hit/miss tokens in usage: `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`
  - We map **hit** to `cache.read`.
  - miss is informative only (may be stored in providerRaw summary), MUST NOT be used to infer hit.

**Code fact:** `Session.getUsage` already reads hit tokens for providerID `deepseek`:
`usage["prompt_cache_hit_tokens"]`

**Docs:** `docs/plans/2026-01-29-deepseek-v3_2-api-notes.md`

### 2.5 Gemini (Google / Sub2API)

**Wire:** `google.gemini`  
**Maturity:** `experimental`

**Docs expectation:**
- cached content tokens: `usageMetadata.cachedContentTokenCount`
- AI SDK may map it to `usage.cachedInputTokens`

**Implementation rule:**
- Prefer `usage.cachedInputTokens` if present.
- If not present, and provider metadata exposes `usageMetadata.cachedContentTokenCount`, map it to `cache.read`.
- Cache write (cached content creation) is out of scope unless we can reliably observe it; otherwise unknown.

**Docs:**
- `docs/plans/2026-01-29-gemini-antigravity-api-notes.md`
- `docs/plans/2026-01-29-opencode-sub2api-caching-investigation.md`

### 2.6 GLM (ZAI / OpenAI-compatible)

**Wire:** `openai.chat` (OpenAI-compatible)  
**Maturity:** `experimental`

**Docs expectation:**
- `cached_tokens` lives at `prompt_tokens_details.cached_tokens` (not top-level).

**Implementation rule (flagged):**
- Only read `prompt_tokens_details.cached_tokens` behind a feature flag, because the OpenAI-compatible chat adapter may vary across providers.

**Docs:** `docs/plans/2026-01-29-zai-glm-4_7-api-notes.md`

---

## 3) Events + Reconciliation (evidence-first)

### 3.1 Event types (proposed)

- `usage.normalized` (always emitted on step finish)
- `cache.read` (emit only when `cacheReadTokens` known/derived and `> 0`)
- `cache.write` (emit only when `cacheWriteTokens` known/derived and `> 0`)

All events:
- `specVersion`: `event/1.0` (existing)
- `data`: **summary + artifact pointers only** (no large raw JSON)
- `normalized.specVersion`: `usage-normalized/1.0`

### 3.2 providerRaw artifacts (optional but recommended)

When available, write a tiny artifact containing only usage-related raw fields (no logprobs, no full response bodies):
- path pattern: `usage/<messageId>/<stepId>/provider-usage-summary.json`
- include: provider ids, known usage counts, known cache fields, response ids (if present)

Then attach it as:
- `normalized.providerRaw = { kind: "artifact", pointer: <artifact-path>, summary: <tiny-summary> }`

---

## 4) Feature Flags + Maturity (observability only)

Maturity values are for **reporting only** (events + normalized payload). They MUST NOT change business logic decisions.

Recommended maturity defaults:
- `openai.responses` => `stable`
- `anthropic.messages` => `beta`
- `deepseek openai-compatible` => `beta`
- `google.gemini` => `experimental`
- `openai-compatible.chat` (GLM, others) => `experimental`

Feature flags (minimal set):
- `OPENCODE_EXPERIMENTAL_OPENAI_CHAT_CACHED_TOKENS`
  - When enabled: allow reading `prompt_tokens_details.cached_tokens` into `cachedInputTokens`.
- `OPENCODE_EXPERIMENTAL_USAGE_PROVIDER_RAW_ARTIFACT`
  - When enabled: write provider usage summary artifacts and include pointers in events.

---

## 5) Implementation Plan (TDD, no mocks)

### Task 1: Add normalized usage types + pure normalizer

**Files:**
- Create: `packages/opencode/src/usage/normalized.ts`
- Test: `packages/opencode/test/usage/normalized.test.ts`

**Step 1: Write failing tests for `normalizeUsage()`**

- Case: OpenAI Responses cached tokens => `cacheReadTokens known`, `cacheHit derived=true`, `promptTokens aligned with getUsage.tokens.input`.
- Case: DeepSeek hit tokens in `prompt_cache_hit_tokens` => read into `cacheReadTokens` and derive hit.
- Case: Anthropic cache write in `metadata.anthropic.cacheCreationInputTokens` => `cacheWriteTokens known`.
- Case: Unknown cached tokens => `cacheReadTokens unknown`, `cacheHit unknown`.
- Case: GLM `prompt_tokens_details.cached_tokens` behind flag => when flag disabled, unknown; when enabled, known.

Run: `cd packages/opencode && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test`
Expected: FAIL (module not found / incorrect mapping)

**Step 2: Implement minimal `normalizeUsage()`**

- Input includes:
  - `model` (providerID, api.npm, api.id)
  - `usage` (LanguageModelUsage-like)
  - `metadata` (ProviderMetadata optional)
  - `tokens` (existing `Session.getUsage().tokens`, so promptTokens aligns by construction)
- Output is `UsageNormalizedV1` with explicit `known|derived|unknown`.
- `cacheHit` logic exactly matches requirements (derived only when read known/derived and >0).

**Step 3: Run tests**
Expected: PASS

### Task 2: Extend `Session.getUsage()` cached token extraction (safe, flagged)

**Files:**
- Modify: `packages/opencode/src/session/index.ts`
- Test: `packages/opencode/test/session/get-usage.test.ts` (new)

**Step 1: Add failing test for GLM nested cached tokens**
- Given `usage.prompt_tokens_details.cached_tokens = 123` and flag enabled:
  - `tokens.cache.read === 123`
  - `tokens.input === inputTokens - 123` (unless excludesCachedTokens)

**Step 2: Implement minimal extraction**
- Keep existing semantics:
  - cachedInputTokens prefer `usage.cachedInputTokens`
  - deepseek fallback to `usage.prompt_cache_hit_tokens`
  - flagged fallback to `usage.prompt_tokens_details.cached_tokens`

**Step 3: Run tests**
Expected: PASS

### Task 3: Emit usage/cache reconciliation events on step finish

**Files:**
- Modify: `packages/opencode/src/session/processor.ts`
- Create: `packages/opencode/src/usage/events.ts` (small helper to build event payloads)
- Test: `packages/opencode/test/usage/events.test.ts`

**Step 1: Write failing integration-ish test (no mocks)**
- Use `Instance.provide()` with a temp directory (non-git project ok).
- Open `EvidenceWriter` and call the new event writer helper with a sample normalized usage.
- Assert `events.jsonl` exists and contains:
  - `usage.normalized` event
  - optional `cache.read` / `cache.write` events (only when tokens > 0)
- Assert payload contains only summary + pointers (no raw response body).

**Step 2: Implement event emission**
- In `finish-step` handling:
  - compute existing `Session.getUsage()` (unchanged behavior)
  - compute `UsageNormalizedV1` via pure function
  - (flagged) write providerRaw usage summary artifact and attach pointer
  - write evidence events

**Step 3: Run tests**
Expected: PASS

### Task 4: Docs update and verification gate

**Files:**
- Update: `docs/plans/2026-02-02-p3-m4-provider-cache.md` (this file) if mapping changed during implementation

**Step 1: Run only required tests**
Run: `cd packages/opencode && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test`
Expected: PASS

**Step 2: Verify clean worktree**
Run: `git status -sb`
Expected: clean

