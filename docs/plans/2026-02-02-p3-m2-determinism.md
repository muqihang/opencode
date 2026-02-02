# P3 M2 Prefix Determinism Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make context-pack prefix blocks deterministic and explainable without schema changes. Same inputs => same block fingerprints, same block order, stable cacheKey. All determinism info is carried via versioned block artifacts and `segments.sources.sha256`.

**Decision (locked):**
- **No ContextPack schema change.**
- **No system block.** System prefix must be reconstructed deterministically from split blocks. A compatibility layer may output old fields if a legacy path still reads them, but do not maintain redundant system text.
- **Keep history_summary as a block** with artifact + sha256 source. It is optional and must not be expanded back into messages.

**Architecture:**
- Introduce a context-block builder that canonicalizes stable prefix blocks (permissions/developer/user/toolset/environment/capsule/decision_boundary/history_summary), computes sha256 fingerprints from stableJson, writes **versioned block artifacts**, and injects those artifacts as ContextPack segments.
- Determinism and cacheKey depend only on **content-affecting inputs** (e.g. workspaceFingerprint, toolset fingerprint, decision boundary text, history_summary artifact sha). **sessionId/messageId must not affect cacheKey or fingerprints**.
- Each model call still writes a **call-scoped** `context-pack.json` artifact and emits `context.pack_built`. Cache hits may reuse block templates internally but must not reuse artifacts or symlinks.

## Definition of Done (DoD)

**Protocol**
- `context-pack.json` includes explicit segments for deterministic blocks with stable order and `sources[].sha256` fingerprints.
- Each block artifact is versioned (e.g. `specVersion: block/<name>/1.0`) and is the input to fingerprinting.
- Toolset fingerprint is derived from canonical tool list + schema stableJson; stored in toolset block artifact and emitted in `context.pack_built`.
- `history_summary` is emitted only when present; missing summary does not affect other block fingerprints.

**Implementation**
- Any stable field that affects prefix content is included in block artifact -> fingerprint (no hidden inputs).
- Toolset list is stable-sorted by tool name; schema is stableJson canonicalized.
- Decision boundary is a deterministic, versioned text block used for fingerprinting.
- System prefix is reconstructed from blocks in a stable order (no duplicate counting).

**Tests**
- Determinism regression tests: same inputs => identical block list + fingerprints + totals.
- Changing tool list or decision boundary text changes fingerprints.
- workspaceFingerprint or history_summary artifact sha changes => cacheKey/fingerprint changes.
- sessionId/messageId changes => cacheKey/fingerprint unchanged.
- Missing history_summary is allowed and does not perturb other blocks.
- No duplicate counts: developer/environment/capsule/decision_boundary/toolset/history_summary each counted once.

**Events**
- `context.pack_built` includes `toolsetFingerprint` and `blockFingerprints` summary (by block id).
- Cache hit must still emit `cache.hit` and `context.pack_built` with new artifact path.

---

## Tasks (TDD)

### Task 1: Add determinism regression tests (RED)

**Files:**
- Create: `packages/opencode/test/session/context-pack-determinism.test.ts`

**Test cases (minimum):**
1. Same inputs => identical segments + totals + block fingerprints.
2. Toolset change => toolset fingerprint changes.
3. Decision boundary change => decision boundary fingerprint changes.
4. workspaceFingerprint change => cacheKey/fingerprint changes.
5. sessionId/messageId change => cacheKey/fingerprint unchanged.
6. Missing history_summary => no history_summary block; other blocks unchanged.
7. No duplicate counting (developer/environment/capsule/decision_boundary/toolset/history_summary once each).

**Run RED:**
```
cd packages/opencode && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test test/session/context-pack-determinism.test.ts
```
Expected: FAIL due to missing blocks builder / fingerprints.

### Task 2: Implement deterministic blocks + fingerprints (GREEN)

**Files:**
- Create: `packages/opencode/src/session/context-blocks.ts`
- Modify: `packages/opencode/src/session/context-pack.ts`

**Implementation Notes:**
- Build blocks from stable inputs (permissions/developer/user/toolset/environment/capsule/decision_boundary/history_summary).
- Sort blocks in a stable order (no system block).
- Compute block fingerprints using `sha256Text(stableJson(blockArtifact))`.
- Use `segments.sources.sha256` to carry block fingerprints.
- `toolsetFingerprint` is derived from the canonical tool list.

**Run GREEN:**
```
cd packages/opencode && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test test/session/context-pack-determinism.test.ts
```
Expected: PASS.

### Task 3: Wire blocks into LLM entry + artifacts + events (GREEN)

**Files:**
- Modify: `packages/opencode/src/session/llm.ts`
- Modify: `packages/opencode/src/session/context-pack.ts`
- Create: `packages/opencode/src/session/decision-boundary.ts` (versioned text)

**Implementation Notes:**
- Build deterministic block inputs from existing prompt sources.
- Write each block artifact to `.opencode/artifacts/<sessionId>/context/<contextPackId>/blocks/<blockId>.json` using EvidenceWriter.
- Add ContextPack segments for each block (id, kind, priority, tokenEstimate, sources with artifact path + sha256).
- Emit `context.pack_built` with `toolsetFingerprint` and `blockFingerprints` summary.
- Ensure cache hit still produces a new call-scoped context-pack artifact and `context.pack_built`.

**Run package tests:**
```
cd packages/opencode && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test
```
Expected: PASS.

### Task 4: Commit

```
git add docs/plans/2026-02-02-p3-m2-determinism.md \
  packages/opencode/src/session/context-blocks.ts \
  packages/opencode/src/session/context-pack.ts \
  packages/opencode/src/session/llm.ts \
  packages/opencode/src/session/decision-boundary.ts \
  packages/opencode/test/session/context-pack-determinism.test.ts

git commit -m "feat: deterministic context blocks and fingerprints"
```
