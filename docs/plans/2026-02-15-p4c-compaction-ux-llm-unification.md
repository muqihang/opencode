# P4C Compaction UX + LLM Unification Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix compaction user-visible summary leakage, unify LLM augment gating, and harden semantic extraction against noisy inputs in one RED→GREEN cycle.

**Architecture:** Keep deterministic capsule artifacts unchanged for audit while introducing a separate human-readable UI summary renderer. Centralize compaction-LLM eligibility in config-driven gating so `compaction.ts` and `capsule-assisted.ts` agree. Add strict normalization for extracted `active_files` and `next_steps` so polluted inputs degrade safely without leaking machine strings.

**Tech Stack:** Bun + TypeScript + zod schemas + existing session/evidence pipeline.

---

### Task 1: Establish RED coverage for user-visible summary and gating

**Files:**
- Modify: `packages/opencode/test/session/compaction-structured.test.ts`

**Step 1: Write failing tests for R1-R4**
- Add assertions that visible summary text excludes machine fields (`specVersion`, `sessionId`, `generatedAtUtc`, `sha256`, `plugin_prompt`, `compaction-input`, `compaction-facts`).
- Add gating test for `experimental.compaction_llm_augment=true` with env flag unset still invoking assisted runner.
- Add explicit disabled-path assertion with reason code and deterministic view source.
- Add assisted success assertion for deterministic-first then LLM override and `compaction.assisted_applied` payload.

**Step 2: Run targeted tests to confirm RED**
- Run: `bun test test/session/compaction-structured.test.ts --bail`
- Expect: failures on current behavior (machine field leakage + gating mismatch + extraction noise behavior not normalized).

### Task 2: Establish RED coverage for semantic extraction robustness

**Files:**
- Modify: `packages/opencode/test/session/compaction-structured-regression.test.ts`

**Step 1: Write failing regression test for noisy `next_steps`/`active_files`**
- Use polluted input containing `known:` prefixes, duplicate separators, and repeated fragments.
- Assert normalized, deduplicated summary output with no raw polluted string inclusion.
- Assert fallback to unknown when signal quality is insufficient.

**Step 2: Run focused regression test to confirm RED**
- Run: `bun test test/session/compaction-structured-regression.test.ts --bail`
- Expect: failure before implementation.

### Task 3: Implement minimal GREEN in compaction pipeline

**Files:**
- Modify: `packages/opencode/src/session/compaction.ts`
- Modify: `packages/opencode/src/session/capsule-assisted.ts`

**Step 1: Add deterministic human-readable summary renderer**
- Keep `Capsule.render()` artifact output for audit.
- Add separate UI summary text builder for Goal/Decisions/Open Questions/Next steps only.
- Ensure blocked machine keys never appear in user-visible summary.

**Step 2: Unify LLM augment gate behavior**
- Add config-driven enable function in runner input or shared gate helper.
- Respect `experimental.compaction_llm_augment` as source of truth.
- Preserve explicit disabled skip reason and audit event completeness.

**Step 3: Harden semantic extraction normalization**
- Normalize list entries (`trim`, prefix stripping, separator cleanup, dedupe, stable order).
- Reject/ignore noisy tokens and fallback to unknown state when confidence low.
- Ensure fail-safe behavior does not contaminate user summary.

**Step 4: Align event/report fields**
- Keep `compaction.assisted_applied/skipped` payloads consistent with `ui_view_source` semantics.
- Update related schema/tests only where needed to prevent parser regressions.

### Task 4: Execute mandated verification commands (GREEN)

**Files:**
- Validate in worktree only.

**Step 1: Install deps**
- Run: `TMPDIR=/tmp BUN_INSTALL=/tmp/bun-install bun install`

**Step 2: Typecheck**
- Run: `cd packages/opencode && TMPDIR=/tmp BUN_INSTALL=/tmp/bun-install bun run typecheck`

**Step 3: Run acceptance tests**
- Run: `cd packages/opencode && TMPDIR=/tmp BUN_INSTALL=/tmp/bun-install bun test test/session/compaction-structured.test.ts test/session/compaction-structured-regression.test.ts test/session/compaction.test.ts test/session/capsule-assisted-verifier.test.ts --bail`

### Task 5: Produce evidence docs and local commit

**Files:**
- Create: `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/f4-hq/p4c-compaction-ux-llm-unification-spec.md`
- Create: `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/f4-hq/p4c-compaction-ux-llm-unification-replay-report.md`

**Step 1: Record root-cause to fix mapping (R1-R5)**
- Capture RED failure evidence and GREEN command outputs with exit codes.

**Step 2: Commit locally**
- Commit message: `fix(v1.6): unify compaction user summary view, llm augment gating, and semantic extraction robustness`
