# F4 HQ P2 Compaction Quality Soak Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade compaction quality from coverage-only to coverage+consistency+contradiction and produce restart-soak evidence for long sessions.

**Architecture:** Extend deterministic compaction quality scoring in `packages/opencode/src/session/compaction.ts` and keep backward compatibility for existing fields. Add/adjust focused session tests to assert new quality fields, event consistency, and restart monotonic soak continuity.

**Tech Stack:** Bun, TypeScript, Bun test, existing session compaction artifacts/events.

---

### Task 1: Confirm audit scope and target tests

**Files:**
- Read: `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/f4-hq/f4-hq-architecture-audit-2026-02-14.md`
- Read: `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/f4-hq/f4-hq-architecture-improvement-backlog-2026-02-14.csv`

**Step 1:** Extract P2 rows and map to F4-AUD-008/F4-AUD-009 implementation scope.

### Task 2: RED tests for quality/event/soak assertions

**Files:**
- Modify: `packages/opencode/test/session/compaction-structured.test.ts`
- Modify: `packages/opencode/test/session/compaction-structured-regression.test.ts`
- Modify: `packages/opencode/test/session/compaction.test.ts`
- Modify: `packages/opencode/test/session/orchestrator-writer-progress-persistence.test.ts`
- Modify: `packages/opencode/test/session/compaction-restart-soak.test.ts`

**Step 1:** Add failing assertions for `consistency_score`, `contradiction_count`, and `reason_codes`.
**Step 2:** Add failing assertions for `compaction.report` and `compaction.quality` consistency.
**Step 3:** Add failing restart-soak assertions: `>=3` compactions, post-restart continuation, and monotonic checkpoint/progress.
**Step 4:** Run RED command:
`TMPDIR=/tmp BUN_INSTALL=/tmp/bun-install bun test test/session/compaction-structured.test.ts test/session/compaction-structured-regression.test.ts test/session/compaction.test.ts test/session/orchestrator-writer-progress-persistence.test.ts test/session/compaction-restart-soak.test.ts --bail`

### Task 3: GREEN minimal deterministic implementation

**Files:**
- Modify: `packages/opencode/src/session/compaction.ts`
- Modify: related compaction event/schema files only if required by type contracts

**Step 1:** Add deterministic consistency+contradiction computation without LLM.
**Step 2:** Cover contradiction detection for `goal`, `decisions`, `openQuestions`, `working_set`.
**Step 3:** Emit and persist new fields in protocol/artifact/event while preserving existing fields.
**Step 4:** Keep naming `reason_codes` in snake_case and maintain backward compatibility.

### Task 4: Verification and evidence docs

**Files:**
- Create: `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/f4-hq/p2-compaction-quality-soak-spec.md`
- Create: `docs/plans/evidence/2026-02-10-v1_6-blocking/card-blk-06/f4-hq/p2-compaction-quality-soak-replay-report.md`

**Step 1:** Run typecheck:
`TMPDIR=/tmp BUN_INSTALL=/tmp/bun-install bun run typecheck`
**Step 2:** Run GREEN test suite (same as RED command).
**Step 3:** Record RED/GREEN evidence and soak replay outcomes in docs.
**Step 4:** Verify both docs with `test -s`.
**Step 5:** Commit with message `feat(v1.6): add compaction consistency metrics and restart soak evidence`.
