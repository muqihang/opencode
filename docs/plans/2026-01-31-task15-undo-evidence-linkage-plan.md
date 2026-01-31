# Task 15 Execution Plan — Undo evidence linkage (snapshot.created/restored/reverted → Evidence Pack)

Date: **2026-01-31**  
Scope: `packages/opencode`  
Source spec: `docs/plans/2026-01-30-opencode-sandbox-context-p2-implementation-plan.md` (Task 15)  
Design anchor: `docs/plans/2026-01-25-opencode-sandbox-context-design.md` (Section **5.2** / Section **17.3** mentions undo + evidence)

---

## Goal

Make “undo / snapshot rollback” **auditable** by writing snapshot references into the Evidence system.

Concretely, when undo-related snapshot operations happen, we must:

- Emit events:
  - `snapshot.created`
  - `snapshot.reverted`
  - `snapshot.restored`
- Ensure each event includes:
  - snapshot hash pointer (`snapshot`)
  - an artifact pointer that lists affected files (`files_artifact`)

This is especially important under **shared workdir mode**, where rollbacks must be explicit and reviewable.

---

## Non-goals (v1)

- Changing the snapshot mechanism itself (it already uses a private git dir under `Global.Path.data`).
- Building a UI timeline for undo (events already feed the timeline).
- Implementing enterprise requirements/managed config (P4).
- Reworking `Snapshot.revert()` deletion semantics (it currently removes newly created files; keep as-is).

---

## Current state (what exists today)

- Snapshot engine: `packages/opencode/src/snapshot/index.ts`
  - `Snapshot.track()` → returns git tree hash (string) or `undefined` (if snapshots disabled / not git)
  - `Snapshot.restore(hash)` / `Snapshot.revert(patches)` apply rollback operations
- Undo entrypoint: `packages/opencode/src/session/revert.ts`
  - `SessionRevert.revert(...)` (undo) creates/uses `revert.snapshot` and calls `Snapshot.revert(...)`
  - `SessionRevert.unrevert(...)` restores the snapshot via `Snapshot.restore(...)`
- Evidence system: `packages/opencode/src/evidence/writer.ts`
  - Events → `.opencode/evidence/<sessionId>/events.jsonl`
  - Artifacts → `.opencode/artifacts/<sessionId>/...`

Gap: snapshot operations currently log to console but do **not** emit evidence events/artifacts.

---

## Requirements (Task 15)

**Files (as per master plan)**
- Modify: `packages/opencode/src/snapshot/index.ts`
- Modify: `packages/opencode/src/session/revert.ts` (or the actual undo handler)
- Test: `packages/opencode/test/snapshot/evidence-snapshot.test.ts`

**Event requirement**
- On snapshot created/restored/reverted:
  - emit `snapshot.*` event
  - include snapshot hash pointer + affected file list artifact

---

## Execution rules

### Strict TDD

RED → GREEN per step, with focused tests. No “implement first, then add tests”.

### “No hallucination” rule (Context7)

If unsure about git plumbing commands (`git ls-tree`, tree hash semantics, etc.), do not guess:
1) `rg` repo patterns first (there are many snapshot/git usages already).
2) If still uncertain, use Context7 MCP to check official git documentation references.
3) Encode the final decision as a test assertion or evidence event field.

### Safety policy

No deletes, no `git restore/reset/clean/rebase`, no force push without explicit user confirmation.

---

## Design (v1)

### A) Where to emit evidence

We only need “undo evidence linkage”, so we emit evidence from the undo path:
- `SessionRevert.revert()`:
  - snapshot creation (`Snapshot.track`) → `snapshot.created`
  - rollback apply (`Snapshot.revert`) → `snapshot.reverted`
- `SessionRevert.unrevert()`:
  - restore (`Snapshot.restore`) → `snapshot.restored`

To keep logic centralized and reusable:
- Add **evidence-aware wrappers** in `Snapshot` module (in `snapshot/index.ts`) that accept `sessionId`:
  - `Snapshot.trackWithEvidence({ sessionId, reason? })`
  - `Snapshot.revertWithEvidence({ sessionId, patches, reason? })`
  - `Snapshot.restoreWithEvidence({ sessionId, snapshot, reason? })`

Then update `SessionRevert` to call these wrappers instead of the raw functions.

This satisfies “modify snapshot/index.ts” while ensuring real undo uses the linkage.

### B) Artifact contract

Artifacts live under `.opencode/artifacts/<sessionId>/snapshot/`.

For each snapshot event we write one structured JSON artifact:

- `snapshot/created/<snapshot>.json`
- `snapshot/reverted/<id>.json`
- `snapshot/restored/<id>.json`

Suggested schema (v1):

```json
{
  "specVersion": "snapshot-event/1.0",
  "action": "created|reverted|restored",
  "generatedAtUtc": "<iso8601>",
  "snapshot": "<treeHash>",
  "patches": ["<treeHash>"],
  "files": ["relative/path/a", "relative/path/b"],
  "truncated": false,
  "reason": "undo|unrevert|..."
}
```

Notes:
- `files` MUST be **project-relative paths** (not absolute), to avoid leaking machine paths.
- If the file list is large, truncate deterministically:
  - Sort paths ascending.
  - Keep first N (e.g. 5000) and set `truncated: true`.
- `patches` is optional in v1:
  - For `snapshot.reverted`, it SHOULD list unique patch hashes that were applied by `Snapshot.revert(patches)`.
  - For `snapshot.created/restored`, it MAY be omitted or empty.

### C) How to compute “affected files”

- For `snapshot.created`:
  - List tracked file paths in the snapshot tree using:
    - `git ls-tree -r --name-only <treeHash>`
  - This is the “baseline file list” for auditability.
- For `snapshot.reverted`:
  - Use `patches[].files` as the affected list (dedupe + sort).
  - Convert to relative paths against `Instance.worktree`.
  - The event’s `snapshot` field should point to the **pre-undo snapshot** (the one captured by `trackWithEvidence`)
    so audit trails can always find the “restore target” for `unrevert`.
  - Additionally, store `patches: unique(patches[].hash)` in the artifact for explainability.
- For `snapshot.restored`:
  - Before restoring, compute the change-set relative to the snapshot:
    - `Snapshot.patch(snapshot)` returns a `{ hash, files }` list we can reuse.
  - Convert that list to relative paths (dedupe + sort).

### D) Event contract

Event types:
- `snapshot.created`
- `snapshot.reverted`
- `snapshot.restored`

Event data fields (minimum):
- `snapshot` (tree hash string)
- `files_artifact` (artifact path)
- optional: `file_count`, `truncated`, `reason`

Actor:
- `actor: "session:undo"` is recommended (clear intent).

---

## TDD breakdown

### Task 15.0 — Baseline

1) Create a worktree branch from `feature/opencode-custom` (example: `.worktrees/p2b-task15` / `p2b-task15`).
2) `BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun install`
3) Baseline tests:
   - `cd packages/opencode && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test test/snapshot/snapshot.test.ts`

Exit gate: baseline green.

### Task 15.1 — Add evidence snapshot test (RED)

Add new test:
- `packages/opencode/test/snapshot/evidence-snapshot.test.ts`

Test scenario (minimal, deterministic):
1) Create tmp git repo via `tmpdir({ git: true })`
2) `Instance.provide({ directory: tmp.path })`
3) Create a real session: `const session = await Session.create({})`
4) Create a user+assistant message pair similar to existing revert tests, then call:
   - `await SessionRevert.revert({ sessionID: session.id, messageID: <some user message id> })`
5) Assert evidence exists:
   - `.opencode/evidence/<sessionId>/events.jsonl` contains `snapshot.created` and `snapshot.reverted`
   - `.opencode/artifacts/<sessionId>/snapshot/...json` exists and contains `snapshot` + `files` array

RED expectation: this fails today (no snapshot.* events/artifacts).

### Task 15.2 — Implement Snapshot wrappers + wire SessionRevert (GREEN)

1) In `packages/opencode/src/snapshot/index.ts`:
   - Add helper to normalize file paths to project-relative.
   - Add helper to list snapshot tree files (`git ls-tree -r --name-only`).
   - Add EvidenceWriter emission helpers.
   - Add wrapper functions:
     - `trackWithEvidence`
     - `revertWithEvidence`
     - `restoreWithEvidence`

2) In `packages/opencode/src/session/revert.ts`:
   - Replace:
     - `Snapshot.track()` → `Snapshot.trackWithEvidence({ sessionId, reason: "undo" })`
     - `Snapshot.revert(patches)` → `Snapshot.revertWithEvidence({ sessionId, patches, reason: "undo" })`
     - `Snapshot.restore(snapshot)` → `Snapshot.restoreWithEvidence({ sessionId, snapshot, reason: "unrevert" })`

Exit gate: the new evidence test turns GREEN.

### Task 15.3 — Regression

Run:
- `cd packages/opencode && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test test/snapshot`
- `cd packages/opencode && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test`

Exit gate: full suite green.

---

## Definition of Done

Task 15 is done when:
- Undo/revert emits `snapshot.created` + `snapshot.reverted` evidence events.
- Unrevert emits `snapshot.restored` evidence event.
- Each event includes:
  - snapshot hash pointer
  - affected file list artifact pointer
- New tests pass and full `bun test` is green.

---

## Executor prompt (single agent)

> Execute Task 15 strictly following `docs/plans/2026-01-31-task15-undo-evidence-linkage-plan.md`.  
> Constraints: strict TDD (RED→GREEN), no deletes/git-restore/reset/clean/rebase, no force push.  
> If unsure about git plumbing behavior, use Context7 MCP before implementing.  
> Use bun with `BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp`. Finish with `cd packages/opencode && ... bun test` all green.
