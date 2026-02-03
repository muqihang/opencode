# P3 Milestone 5 (Backend) — Structured + Pointerized Compaction

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade session compaction from freeform summary into structured + pointerized artifacts, with a closed-loop event lifecycle for GUI explainability.

**Architecture:** Reuse the existing `EvidenceWriter` artifact + manifest + JSONL event pipeline. Compaction produces a “capsule” markdown plus machine-readable facts/delta artifacts, and emits `compaction.*` events that only contain summaries + pointers to artifacts. Context-pack metadata records `previousContextPackId` and writes a minimal delta artifact for audit.

**Tech Stack:** Bun, Zod protocol parsing, `.opencode/artifacts/*` + `.opencode/evidence/*`, Bun test.

---

## Requirements Checklist (DoD)

### 1) Structured + pointerized artifacts

- [ ] Write artifacts under `.opencode/artifacts/<sessionId>/compaction/<compactionId>/`:
  - [ ] `capsule.md` (rg-friendly)
  - [ ] `facts.json` (key-value SSOT + explicit unknowns)
  - [ ] `compaction.input.json` (replay/audit)
  - [ ] `compaction.report.json` (delta + pointers)
- [ ] Every artifact is registered in a manifest entry with `{ path, sha256, kind }`

### 2) Ledger/delta linkage (minimal closed loop)

- [ ] Context-pack records `ledger.previousContextPackId` when available
- [ ] Emit/store a minimal delta artifact for each context-pack build (summary + pointers)
- [ ] Events never embed large raw text; only summaries + pointers

### 3) Event lifecycle (GUI explainability)

- [ ] Emit: `compaction.started` → (`compaction.completed` | `compaction.degraded` | `compaction.timeout` | `compaction.cancelled`)
- [ ] `degraded/timeout/cancelled` include `reason_zh` + `next_steps_zh` (human/actionable)

### 4) Auto-trigger thresholds (soft/hard/emergency)

- [ ] Thresholds are versioned constants or configurable
- [ ] Trigger decision is evented with `tokenEstimate`/`limit` values
- [ ] No silent failures: emit events + write error artifact

### 5) Tests (no mocks)

- [ ] Regression: multi-round session approaches overflow → triggers compaction → next round context-pack tokenEstimate drops
- [ ] Assert sources pointers intact + manifest traceable (`path` + `sha256` + `kind`)

---

## Implementation Tasks

### Task 1: Worktree + baseline verification

**Files:** (none)

**Steps:**
1. Confirm main worktree clean: `git -C "$MAIN" status -sb`
2. Create worktree + branch: `.worktrees/p3-m5-compaction-backend`
3. Baseline tests: `cd packages/opencode && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test`

### Task 2: Add compaction artifacts + event lifecycle

**Files:**
- Modify: `packages/opencode/src/session/compaction.ts`
- Modify: `packages/opencode/src/session/prompt.ts` (ensure compaction start/stop emits events)
- Add: `packages/opencode/src/session/compaction-protocol.ts` (zod schemas + helpers)

**Steps (TDD):**
1. Write failing tests for artifact outputs + manifest entries + event lifecycle.
2. Implement minimal production code to satisfy tests.
3. Refactor for clarity while staying green.

### Task 3: Add token pressure thresholds + eventing

**Files:**
- Modify: `packages/opencode/src/session/compaction.ts`
- Modify: `packages/opencode/src/session/processor.ts`
- Modify: `packages/opencode/src/session/prompt.ts`

**Steps (TDD):**
1. Add tests covering soft/hard/emergency classification + no-auto path.
2. Emit trigger metadata via `compaction.started` event and/or stored trigger struct.
3. Ensure failures emit `compaction.degraded` + error artifact.

### Task 4: Make context-pack ledger delta traceable

**Files:**
- Modify: `packages/opencode/src/session/context-pack.ts`
- Modify: `packages/opencode/src/session/context-pack-cache.ts`
- Modify: `packages/opencode/src/session/llm.ts`
- Add: `packages/opencode/src/session/context-ledger.ts` (persist previous contextPackId)

**Steps (TDD):**
1. Add tests for `ledger.previousContextPackId` propagation.
2. Write a small delta artifact pointer per context-pack build.

### Task 5: Regression test for multi-round compaction reducing context-pack estimate

**Files:**
- Add: `packages/opencode/test/session/compaction-structured-regression.test.ts`

**Steps:**
1. Build a multi-round session in `tmpdir()` with large text parts.
2. Assert pre-compaction computed history window is large.
3. Run compaction (or simulate summary boundary) and assert tokenEstimate drops.
4. Assert manifest entries exist + pointers complete.

### Task 6: Verify + commit (Option 3 keep branch/worktree)

**Steps:**
1. Run `cd packages/opencode && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test`
2. Commit changes on `p3-m5-compaction-backend`
3. Report: branch/path, last commit, key files, test summary, 1 remaining issue (if any)

