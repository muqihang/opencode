# OpenCode Sandbox + Context Control P2 Implementation Plan (Parallel + Merge + Routing Skeleton)

> **For Codex CLI:** Use `superpowers:executing-plans` to implement this plan task-by-task (no batching).

**Goal:** Make “parallel really usable” by implementing P2 end-to-end: isolated workdirs that automatically merge back (with conflicts artifactized), shared workdir write-coordination (parallel read / serial write with auditable queueing), and the routing A/B/C worker parallel protocol skeleton (artifacts + caching + scheduling + degradations) — all with Evidence Pack checks (format/lint/test at least one) recorded after merges.

**Architecture:** Add a deterministic “change-set → merge → gate → evidence” pipeline:
1) every isolated execution produces a reproducible change-set (`patch + changes.json`),
2) merges are serialized through a coordinator and applied via `git apply --3way` (conflicts become artifacts + explicit decision),
3) gates run post-merge and write `checks[]` into evidence,
4) child sessions emit micro-packs which the parent deterministically merges into a macro pack (dedupe + conflict risks),
5) routing runs generate `request.json + worker-*.result.json + routing.capsule.md` artifacts using strict Zod schemas and stable canonicalization.

**Tech Stack:** TypeScript (Bun runtime), Zod 4 strict schemas, git worktree, `EvidenceWriter`, `SandboxRunner`, `SessionWorktree`, `TaskTool`, `FileTime` locks, OpenCode `Format` and `LSP` subsystems, plus a small routing runner module.

---

## Design Coverage Index (P2 items, no omissions)

This plan covers every P2-relevant requirement scattered across `docs/plans/2026-01-25-opencode-sandbox-context-design.md`:

### P2 Core (Roadmap)
- **P2 definition** (Section 11.2; around lines ~1040–1053):
  - Isolated → merge + conflict artifacts + post-merge gates to `checks[]`
  - Shared workdir write coordination (parallel read / serial write; queue; events)
  - Worker A/B/C parallel protocol skeleton (artifacts + scheduling + security)

### Workdir + Merge Details
- Workdir modes and merge semantics (Section 2.2)
- “session worktree patch is first-class artifact” and “merge/conflict left to P2” (review patches + roadmap notes)
- **P2 gate requirement**: after merge, run at least one of format/lint/test and write to `checks[]` (Section 18)

### Evidence / Merge Algorithms
- **micro-pack → macro-pack merge algorithm** (Section 15.4): artifact dedupe, claim dedupe, conflict → risks, deterministic output.

### Routing Protocol Skeleton
- Worker result fields (Section 2.3.3) and cacheKey rules (2.3.4)
- stableJson / canonicalization rules and required stable sorting (2.3.5)
- Defaults + degradation table (2.3.6)
- Scheduling: max in-flight, cancellation, timeouts, late results (2.3.8)
- Protocol artifacts must be registered in Evidence Pack manifest; contract tests mandatory (2.3.7 + 2.3.7.1)

### File Workbench + Python Supply Chain (P2-scoped)
- “资料工作台” P2 upgrades: stable PDF pages, OCR, Office parsing, KB ingestion integration, enterprise packaging (Section 13.2.1 P2)
- Python supply chain: P2 requires wheelhouse/lock-hash offline-first; online install only with explicit approval (Section 14.2 + roadmap note)

### Cross-cutting constraints
- **P0–P2 must not require Redis** (Section 3.1)
- Graph is an optional accelerator in P1/P2; must degrade gracefully and never block (Section 20.2)
- Undo is flagged “P1/P2” and is especially important for shared workdir; ensure evidence references (Section 5.2)

---

## Decision Checkpoints (answer before coding P2)

P2 has a few “implementation choice” forks that must be decided up-front to avoid rework:

1) **What is the “main workdir” merge target?**
   - **Option A (recommended for coherence):** merge child patches into the *parent session’s effective workdir* (and treat that as the user-visible working copy for the session).
   - **Option B (recommended for compatibility + incremental rollout):** merge into `Instance.worktree` (project worktree on disk). Note: in P2 we will upgrade *all write tools* (`apply_patch/edit/write`) to honor workdir mode, but `Instance.worktree` remains the simplest “source of truth” target for user-visible code unless we introduce a per-session “effective workdir” abstraction end-to-end.
   - If we pick **B**, we must also define how long-lived isolated worktrees are kept in sync to avoid patch drift (or switch primary session to shared mode).

2) **Default `workdirMode` for primary sessions (git projects)?**
   - **Option A:** primary = `shared`, subagents = `isolated` (simpler; no “sync-back” problem for the main session; matches “default all subagents isolated” intent).
   - **Option B:** primary = `isolated` (max safety; requires robust “sync/merge cadence” to prevent divergence across tool runs).

3) **Which “minimum gate” is the default post-merge check?**
   - **Option A (recommended):** `format` (OpenCode formatter pipeline) + `lint` (LSP diagnostics) on touched files.
   - **Option B:** configurable command list (e.g., project `test/lint/format`) with auto-detect fallback; record `skip` when unavailable.

4) **Conflict resolution UX for auto-merge**
   - **Option A:** on conflict, stop + require explicit user approval decision; emit conflict artifacts and a clear prompt.
   - **Option B:** auto-generate a suggested resolution patch artifact (still requires approval).

5) **What is “shared workdir” rooted at (git projects)?**
   - **Option A (recommended):** root shared writes at `Instance.worktree` (repo root). This keeps all “logical paths” stable and avoids surprises when OpenCode is started from a subdirectory.
   - **Option B:** root shared writes at `Instance.directory` (current cwd). This matches “shared workdir = current working directory”, but makes “repo-relative logical paths” harder when cwd is not repo root.
   - This decision affects `resolveWorkdirPath(...)`, `toLogicalPath(...)`, and the UI-facing relative path behavior of `apply_patch/edit/write`.

6) **Do we need per-child workdir overrides in P2?**
   - **Option A (recommended for P2 v1):** only “primary vs child defaults” via config (`workdir.primary`, `workdir.child`). This is enough to satisfy “default child isolated, can switch shared” (via config) with minimal churn.
   - **Option B:** allow TaskTool to spawn a specific child in `shared` mode (or switch it) and require a permission/audit event on the switch. This matches Section 2.2 “switch strategy” more literally but adds API surface.

This plan includes steps for Option A defaults but keeps the implementation flexible so you can flip to Option B later with config.

---

## Recommended Execution Order (dependency-safe)

Even though tasks are numbered, a few of them depend on later “primitives”. Follow this order to avoid refactors:

1) Task 0 (preflight worktree + baseline tests)
2) Task 0.1 (workdir policy + resolver)
3) Task 0.2 (logical path mapping)
4) Task 1 (emit `worktree/changes.json`)
5) Task 3 (shared write queue primitive)
6) Task 0.5 (make bash/python honor workdir policy; required if primary can be shared)
7) Task 0.3 + 0.4 (make all write tools honor workdir policy + queue + changeset capture)
8) Task 2 (apply changeset via `git apply --3way` + conflict artifacts)
9) Task 4 + 4.1 (persist pack state + deterministic `pack.json.artifacts[]`)
10) Task 5–7 (post-merge gates, macro evidence merge, TaskTool auto-merge wiring)
11) Task 8–10 (routing runner + workers; prompt wiring optional)
12) Task 11–15 (P2b file workbench + python supply chain + undo evidence linkage)

If you want the smallest “P2 core” slice, stop after Task 7 and run the P2 Exit Gate checklist before starting routing or doc workbench work.

## Status Note (assumed already true after P0/P0.5/P1/P1.5/P1.6)

This plan assumes the following already exist (verify before starting P2):
- `SessionWorktree.ensure()` creates `.opencode/worktrees/<sessionId>` worktrees.
- `SandboxRunner` writes evidence events + stdout/stderr artifacts; `captureWorktreePatch()` produces a patch artifact for isolated runs.
- `TaskTool` emits `micro-pack.json` for child sessions and writes an `evidence.micro_pack_emitted` event in the parent.
- Protocol schemas + contract tests exist for:
  - `routing-run-request/1.0`, `routing-worker-result/1.0`, `context-pack/1.0`
  - `evidence-pack/1.0`, `evidence-micro-pack/1.0`, `event/1.0`

If any of the above is missing in the current branch, treat it as a P2 “pre-task” and restore parity before continuing.

---

## Execution Discipline (anti-hallucination + docs lookup)

**Rule:** During P2 execution, if any step touches an unfamiliar/uncertain tech detail (runtime flags, Zod behavior, Bun APIs, git semantics, OpenCode internal subsystems like Format/LSP, or plugin APIs), do **not** guess.

Do this instead:
1) Prefer reading the **local source** first (OpenCode codebase is the SSOT for internal behavior).
2) If it is still unclear, use **Context7 MCP** to retrieve **official documentation** for the relevant library/tool/framework:
   - `mcp__context7__resolve-library-id` → pick the correct library
   - `mcp__context7__query-docs` → retrieve the specific API/behavior
3) Convert the doc findings into:
   - a concrete test case (RED first), and
   - a short note in the task log (what doc said + what we implemented).

This rule is mandatory whenever “I’m not sure” appears for anything correctness-critical (merge semantics, hashing rules, schema constraints, locking/queue guarantees, or protocol fields).

---

## Compatibility Note (oh-my-opencode orchestration)

If you plan to run OpenCode together with the `oh-my-opencode` plugin (e.g. `delegate_task` / background tasks), note:
- The plugin may spawn **child sessions via the Session API** (not necessarily via OpenCode’s built-in `task` tool).
- Therefore, any “child session completion → merge changeset → run gates → merge evidence” logic should be implemented as a **reusable module/tool** that can be triggered for *any* `{ parentID, childSessionId }` pair — not only inside `TaskTool`.

In this plan, Task 7 is written using `TaskTool` as the integration point for v1, but treat the merge/gate/evidence-merge pipeline as a reusable primitive so plugins can call it too (or so we can move it to a generic session-finalizer later without rewriting core logic).

**Best-practice decision (recommended): make it universal in core.**
- Implement a core-level `ChildSessionFinalizer` (or similar) that runs when **any child session** finishes (i.e. `Session.parentID` exists), not just when a `task` tool returns.
- This makes the behavior consistent:
  - With `oh-my-opencode`: plugin-created child sessions still auto-merge/gate/evidence-merge without requiring plugin changes.
  - Without plugins: OpenCode built-in `task` still works and can optionally await the finalizer for synchronous UX.
- Integration points:
  - `SessionPrompt.loop()` (or `SessionProcessor`) calls `finalizeChildSession(...)` on child completion.
  - `TaskTool` can call the same function to present results immediately (must be idempotent).

### Task 0: Preflight P2 worktree + baseline (required)

**Files:** none (command-only)

**Step 1: Create a P2 worktree**

Pick a worktree directory (recommended: one per terminal/group to reduce merge conflicts), then set:

- Example for Group 1: `export P2_WORKTREE_DIR="opencode-zh-build/opencode_src/.worktrees/p2-group1"`

If the worktree does not exist yet, run:

- `git -C opencode-zh-build/opencode_src worktree add "$P2_WORKTREE_DIR" -b feature/opencode-p2`

Expected: Worktree directory exists at `$P2_WORKTREE_DIR`.

**Step 2: Verify clean status**

Run: `git -C "$P2_WORKTREE_DIR" status -sb`
Expected: clean.

**Step 3: Baseline tests (must be green before changes)**

If your environment requires custom Bun dirs (example used in some sandboxes):
- `export BUN_INSTALL=/tmp/bun-install`
- `export TMPDIR=/tmp`

Run:
- `cd "$P2_WORKTREE_DIR/packages/opencode" && bun test test/protocol/protocol-contract.test.ts`
- `cd "$P2_WORKTREE_DIR/packages/opencode" && bun test test/worktree/session-worktree.test.ts test/worktree/changes-artifact.test.ts`
- `cd "$P2_WORKTREE_DIR/packages/opencode" && bun test test/tool/task.test.ts 2>/dev/null || true`

Expected: contract + worktree tests PASS (task tests may not exist yet).

---

## Part 0 — Make workdir isolation real for **all write tools** (P2 hard prerequisite)

**Why this part exists (do not skip):**
- Today, `BashTool` / `PythonTool` run inside the session worktree (`SessionWorktree.ensure`), but core write tools (`apply_patch`, `edit`, `write`) operate directly on `Instance.directory` / `Instance.worktree`.
- If we enter P2 without fixing that, “isolated → merge” only applies to bash/python side effects, while code changes still happen in shared workdir — making P2’s merge/conflict/gates story incomplete and unsafe under parallelism.

**Non-goals for this part:** do not redesign the entire tool API; keep user-facing tool schemas stable; implement minimal internal routing based on config/session metadata.

---

### Task 0.1: Add `workdir` policy to config + a resolver (`shared|isolated`)

**Files:**
- Add: `packages/opencode/src/workdir/resolve.ts`
- Modify: `packages/opencode/src/config/config.ts`
- Test: `packages/opencode/test/workdir/resolve.test.ts`

**Step 1: Write failing test**

Create `packages/opencode/test/workdir/resolve.test.ts`:
- Create tmp git repo with `tmpdir({ git: true, config: { workdir: { primary: "shared", child: "isolated" } } })`
- Use `Instance.provide({ directory: tmp.path, fn: ... })`
- Assert:
  - `resolveWorkdirMode({ kind: "primary" })` returns `"shared"`
  - `resolveWorkdirMode({ kind: "child" })` returns `"isolated"`
  - `resolveWorkdirPath({ sessionId, mode: "isolated" })` returns path under `.opencode/worktrees/<sessionId>`
  - `resolveWorkdirPath({ sessionId, mode: "shared" })` returns the shared base workdir (Decision 5: recommended `Instance.worktree` for git; `Instance.directory` for non-git)

**Step 2: Run test to verify it fails**

Run: `cd "$P2_WORKTREE_DIR/packages/opencode" && bun test test/workdir/resolve.test.ts`
Expected: FAIL (no config/workdir resolver exists).

**Step 3: Implement config + resolver**

In `packages/opencode/src/config/config.ts`, add (optional) section:

```ts
workdir: z
  .object({
    primary: z.enum(["shared", "isolated"]).default("shared"),
    child: z.enum(["shared", "isolated"]).default("isolated"),
  })
  .optional()
```

Create `packages/opencode/src/workdir/resolve.ts` exporting:
- `resolveWorkdirMode(input: { kind: "primary" | "child" }): "shared" | "isolated"`
  - uses `Config.get()` and defaults above
- `resolveWorkdirPath(input: { sessionId: string; mode: "shared" | "isolated" }): Promise<string>`
  - if `mode === "isolated"` and `Instance.project.vcs === "git"`: `SessionWorktree.ensure({ sessionId })`
  - else: shared base workdir (Decision 5; recommended `Instance.worktree === "/" ? Instance.directory : Instance.worktree`)
- `mapLogicalToWorkdirPath(input: { logicalPath: string; workdir: string }): string`
  - join `workdir` + `logicalPath` (normalized)

**Step 4: Run test to verify it passes**

Run: `cd "$P2_WORKTREE_DIR/packages/opencode" && bun test test/workdir/resolve.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/opencode/src/config/config.ts packages/opencode/src/workdir/resolve.ts packages/opencode/test/workdir/resolve.test.ts
git commit -m "feat(workdir): add shared/isolated policy + resolver [AI:GPT-5]"
```

---

### Task 0.2: Introduce a “logical path” convention for write tools (so outputs don’t leak `.opencode/worktrees/...`)

**Why:** In isolated mode, the physical path is inside `.opencode/worktrees/<sessionId>`, but the user-facing file path must remain repo-relative (e.g. `packages/opencode/src/...`), otherwise diffs and permissions become confusing.

**Files:**
- Add: `packages/opencode/src/workdir/paths.ts`
- Test: `packages/opencode/test/workdir/paths.test.ts`

**Step 1: Write failing test**

Create `packages/opencode/test/workdir/paths.test.ts`:
- Create tmp git repo with `tmpdir({ git: true })`
- In `Instance.provide(...)`, set:
  - `repoPath = path.join(Instance.worktree, "src", "a.txt")`
  - `workdir = path.join(Instance.worktree, ".opencode", "worktrees", "S")`
- Assert:
  - `toLogicalPath(repoPath)` -> `"src/a.txt"`
  - `toWorkdirPath({ repoPath, workdir })` -> `${workdir}/src/a.txt`

**Step 2: Implement mapping helpers**

Create `packages/opencode/src/workdir/paths.ts` exporting:
- `toLogicalPath(input: { repoPath: string }): string` (relative to `Instance.worktree`, forward-slash normalized)
- `toWorkdirPath(input: { repoPath: string; workdir: string }): string`

**Step 3: Commit**

```bash
git add packages/opencode/src/workdir/paths.ts packages/opencode/test/workdir/paths.test.ts
git commit -m "feat(workdir): map repo paths to isolated workdir paths [AI:GPT-5]"
```

---

### Task 0.5: Make `bash` + `python` tools honor workdir policy (primary vs child)

**Why:** P2 introduces a configurable `workdirMode` policy (primary can be `shared` or `isolated`). Today `bash` and `python` force `isolated` for all git projects, which makes “primary shared” impossible and also makes workdir semantics inconsistent across tools.
If you decide primary sessions stay `isolated` for P2 v1 (Decision 2 Option B), you *can* defer this task, but it is still recommended to remove hardcoded workdir behavior and converge on the resolver for long-term consistency.

**Files:**
- Modify: `packages/opencode/src/tool/bash.ts`
- Modify: `packages/opencode/src/tool/python.ts`
- Test: `packages/opencode/test/tool/bash-workdir-policy.test.ts` (minimal)
- Test: `packages/opencode/test/tool/python-workdir-policy.test.ts` (minimal)

**Step 1: Add failing tests**

Create `packages/opencode/test/tool/bash-workdir-policy.test.ts`:
- tmp git repo with config `workdir.primary = "shared"`, `workdir.child = "isolated"`
- run `BashTool` once as primary session with a command that writes a file in cwd (e.g. `echo ok > workdir-policy.txt`)
- assert the file lands in the **shared** base (Decision 5) and does not land in `.opencode/worktrees/<sessionId>/...`
- run `BashTool` once as a child session with the same command
- assert the file lands in `.opencode/worktrees/<childSessionId>/...`

Create `packages/opencode/test/tool/python-workdir-policy.test.ts` similarly, but assert via observable evidence:
- in primary `shared` mode, `SandboxRunner` must not capture `worktree/changes.patch` (because it only does that for `workdirMode === "isolated"`)
- in child `isolated` mode, `worktree/changes.patch` should exist after the run

**Step 2: Implement**

In both tools:
- determine session kind (primary vs child) from `Session.get(ctx.sessionID)` and `parentID`
- use `resolveWorkdirMode({ kind })` and `resolveWorkdirPath({ sessionId: ctx.sessionID, mode })`
- pass `capability.workdirMode = mode` and `cwd = resolved workdir` into `SandboxRunner.run`

**Step 3: Commit**

```bash
git add packages/opencode/src/tool/bash.ts packages/opencode/src/tool/python.ts packages/opencode/test/tool/bash-workdir-policy.test.ts packages/opencode/test/tool/python-workdir-policy.test.ts
git commit -m "feat(tool): bash/python honor workdir policy for primary and child sessions [AI:GPT-5]"
```

### Task 0.3: Upgrade `apply_patch` to honor workdir mode + serialize writes + emit queue events

**Prerequisites:** Task 0.1, Task 0.2, Task 1, Task 3.

**Files:**
- Modify: `packages/opencode/src/tool/apply_patch.ts`
- Modify: `packages/opencode/src/file/time.ts` (only if needed for multi-file lock helper)
- Use: `packages/opencode/src/workdir/write-queue.ts` (added in Task 3)
- Test: `packages/opencode/test/tool/apply_patch.test.ts`
- Add: `packages/opencode/test/tool/apply_patch-workdir.test.ts`

**Step 1: Write failing test (isolated mode writes to worktree, not main workdir)**

Create `packages/opencode/test/tool/apply_patch-workdir.test.ts`:
- Create tmp git repo: `tmpdir({ git: true, config: { workdir: { primary: "isolated", child: "isolated" } } })`
- `Instance.provide({ directory: tmp.path, fn: async () => { ... } })`
- Execute `ApplyPatchTool` with `ctx.sessionID = "s1"` and patch adding `hello.txt`.
- Assert:
  - file exists at `.opencode/worktrees/s1/hello.txt`
  - file does **not** exist at `${tmp.path}/hello.txt` (unless primary also uses shared)
  - a `worktree/changes.patch` artifact is present under `.opencode/evidence/s1/manifest.json`

**Step 2: Run test and confirm FAIL**

Run: `cd "$P2_WORKTREE_DIR/packages/opencode" && bun test test/tool/apply_patch-workdir.test.ts`
Expected: FAIL (apply_patch writes to `Instance.directory` today; no changeset capture).

**Step 3: Implement workdir routing**

In `packages/opencode/src/tool/apply_patch.ts`:
- Determine mode:
  - if session is a child session: use `resolveWorkdirMode({ kind: "child" })`
  - else: `resolveWorkdirMode({ kind: "primary" })`
  - (child detection: `Session.get(ctx.sessionID)` and check `parentID` exists; if not found, treat as primary)
- Determine `workdir = await resolveWorkdirPath({ sessionId: ctx.sessionID, mode })`
- Open `EvidenceWriter` for `ctx.sessionID` and emit an event `workdir.mode_resolved`:
  - `data: { mode, workdir, logicalRoot: Instance.worktree }`
- For each hunk path:
  - resolve **repo path**: `path.resolve(Instance.worktree, hunk.path)` (logical)
  - compute actual target: `toWorkdirPath({ repoPath, workdir })`
- Wrap writes with locks:
  - gather affected repo logical paths
  - acquire a workdir-level write queue (shared mode only; `WorkdirWriteQueue` from Task 3)
  - acquire `FileTime.withLock` per target file in stable sorted order to avoid deadlocks
- After applying:
  - if mode is `isolated`: call `captureWorktreePatch({ workdir, sessionId: ctx.sessionID, writer })` to emit patch + changeset artifacts (after Task 1 upgrades it).
  - always: emit events for queueing decisions in shared mode:
    - `workdir.write_queued`, `workdir.write_started`, `workdir.write_completed`

**Step 4: Update existing tests**

Update `packages/opencode/test/tool/apply_patch.test.ts`:
- Ensure it passes under default config (`primary: shared`) and continues to verify add/update/delete/move behavior.
- Add one assertion that metadata uses logical paths (no `.opencode/worktrees/...` in UI metadata).

**Step 5: Commit**

```bash
git add packages/opencode/src/tool/apply_patch.ts packages/opencode/test/tool/apply_patch.test.ts packages/opencode/test/tool/apply_patch-workdir.test.ts
git commit -m "feat(tool): apply_patch honors isolated/shared workdir + emits changeset evidence [AI:GPT-5]"
```

---

### Task 0.4: Upgrade `edit` + `write` (and `multiedit`) to honor workdir mode + emit write coordination events

**Prerequisites:** Task 0.1, Task 0.2, Task 1, Task 3.

**Files:**
- Modify: `packages/opencode/src/tool/edit.ts`
- Modify: `packages/opencode/src/tool/write.ts`
- Modify: `packages/opencode/src/tool/multiedit.ts`
- Add: `packages/opencode/test/tool/write-workdir.test.ts`
- Add: `packages/opencode/test/tool/edit-workdir.test.ts`

**Step 1: Add failing tests**

Create `packages/opencode/test/tool/write-workdir.test.ts`:
- tmp git repo with config `workdir.primary = "isolated"`
- run `WriteTool` to create `src/a.txt`
- assert file lands in `.opencode/worktrees/<sessionId>/src/a.txt`
- assert evidence manifest contains `worktree/changes.patch` and `worktree/changes.json` after tool run

Create `packages/opencode/test/tool/edit-workdir.test.ts`:
- same, but:
  - pre-create `src/a.txt` in worktree
  - call `ReadTool` (or simulate FileTime.read) then `EditTool` to update
  - assert update happens in session workdir and locks serialize concurrent edits

**Step 2: Implement changes**

In `packages/opencode/src/tool/edit.ts` and `packages/opencode/src/tool/write.ts`:
- resolve workdir mode + workdir path using `packages/opencode/src/workdir/resolve.ts`
- map logical repo file path → actual workdir file path using `packages/opencode/src/workdir/paths.ts`
- open `EvidenceWriter` and emit `workdir.mode_resolved` once per tool run (mode + resolved workdir + logicalRoot)
- when `mode === "shared"`:
  - enforce “parallel read, serial write” by acquiring the shared write queue around the write operation
  - emit events that explain queueing
- when `mode === "isolated"`:
  - skip shared queue
  - after write completes, capture `worktree/changes.patch` + `worktree/changes.json` evidence (same as apply_patch)
- keep UI metadata paths logical (repo-relative), not workdir physical.

**Step 3: Commit**

```bash
git add packages/opencode/src/tool/edit.ts packages/opencode/src/tool/write.ts packages/opencode/src/tool/multiedit.ts packages/opencode/test/tool/write-workdir.test.ts packages/opencode/test/tool/edit-workdir.test.ts
git commit -m "feat(tool): edit/write honor workdir mode + auditable write coordination [AI:GPT-5]"
```

---

## Part A — Change-set artifacts + deterministic merge pipeline

### Task 1: Add a reproducible change-set manifest (`worktree/changes.json`)

**Why:** P2 requires “patch + manifest (file list + hashes)” for replayable merges and conflict detection.

**Files:**
- Modify: `packages/opencode/src/worktree/changes.ts`
- Add: `packages/opencode/src/worktree/changeset.ts` (new: change-set schema + helpers)
- Test: `packages/opencode/test/worktree/changeset-artifact.test.ts`

**Step 1: Write failing test**

Create `packages/opencode/test/worktree/changeset-artifact.test.ts`:
- Create tmp git repo with `tmpdir({ git: true })`
- In a session worktree, modify/add/delete files
- Call `captureWorktreePatch({ ... })`
- Assert manifest contains:
  - `worktree/changes.patch` (kind `worktree-patch`)
  - `worktree/changes.json` (kind `worktree-changeset`)
- Parse `changes.json` with a Zod schema and assert it includes:
  - `baseCommit`, `dirtyFingerprint`, and arrays `added|modified|deleted` with per-file sha256

**Step 2: Run test, confirm FAIL**

Run: `cd "$P2_WORKTREE_DIR/packages/opencode" && bun test test/worktree/changeset-artifact.test.ts`
Expected: FAIL (changeset artifact missing).

**Step 3: Implement `ChangeSet` schema + writer**

Implementation guidance:
- Create `packages/opencode/src/worktree/changeset.ts` exporting:
  - Zod schema `WorktreeChangeSet` (strict):
    - `specVersion: "worktree-changeset/1.0"`
    - `sessionId`, `workdir`, `baseCommit`
    - `files: { added: [...], modified: [...], deleted: [...] }`
    - each file entry: `{ path: string, sha256: string, size?: number }`
  - helper to compute:
    - `baseCommit` via `git rev-parse HEAD` in the workdir
    - file list via `git diff --name-only`, `git diff --name-only --cached`, `git ls-files --others --exclude-standard`
    - sha256 for current file bytes (use `Bun.file().arrayBuffer()` + `Bun.CryptoHasher`)
- Update `captureWorktreePatch()`:
  - still produce `worktree/changes.patch`
  - also produce `worktree/changes.json` with `WorktreeChangeSet.parse(...)` before write
  - emit a new event `worktree.changeset_captured` (or reuse existing event with both artifact pointers)

**Step 4: Run test, confirm PASS**

Run: `cd "$P2_WORKTREE_DIR/packages/opencode" && bun test test/worktree/changeset-artifact.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/opencode/src/worktree/changes.ts packages/opencode/src/worktree/changeset.ts packages/opencode/test/worktree/changeset-artifact.test.ts
git commit -m "feat(worktree): emit reproducible changeset manifest artifact [AI:GPT-5]"
```

---

### Task 2: Implement deterministic merge application (`git apply --3way`) + conflict artifacts

**Files:**
- Add: `packages/opencode/src/worktree/merge.ts`
- Test: `packages/opencode/test/worktree/merge-apply.test.ts`

**Step 1: Write failing test**

Create `packages/opencode/test/worktree/merge-apply.test.ts` with two scenarios:
1) **Clean apply**:
   - create tmp repo
   - create isolated workdir, produce a change-set artifact (patch + changes.json)
   - apply into target worktree, assert target file contents match expected sha256 from changes.json
2) **Conflict**:
   - modify same target file differently in target
   - apply patch with `--3way` and confirm merge reports conflict
   - assert conflict artifact exists under `.opencode/artifacts/<sessionId>/worktree/conflicts/...`

**Step 2: Run test, confirm FAIL**

Run: `cd "$P2_WORKTREE_DIR/packages/opencode" && bun test test/worktree/merge-apply.test.ts`
Expected: FAIL (no merge module).

**Step 3: Implement `WorktreeMerge.applyChangeSet(...)`**

Create `packages/opencode/src/worktree/merge.ts`:
- Input: `{ parentSessionId, childSessionId, targetDir, changeSetPath, patchPath }`
- Behavior (deterministic):
  - read + parse `WorktreeChangeSet` from artifact JSON
  - attempt apply:
    - `git apply --3way --whitespace=nowarn <patch>`
    - capture stdout/stderr to artifact (even on success)
  - validate post-apply:
    - recompute sha256 for each changed file; compare with change-set manifest
    - mismatch => treat as conflict (artifactize details + emit risk/event)
  - on failure/conflict:
    - write conflict artifacts:
      - `worktree/conflicts/<timestamp>-git-apply.stderr.txt`
      - `worktree/conflicts/<timestamp>-patch.patch` (copy)
      - `worktree/conflicts/<timestamp>-expected.changes.json` (copy)
    - return `{ status: "conflict" | "error", conflictArtifacts: [...] }`
  - on success:
    - return `{ status: "ok", appliedFiles: [...] }`

**Step 4: Run test, confirm PASS**

Run: `cd "$P2_WORKTREE_DIR/packages/opencode" && bun test test/worktree/merge-apply.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/opencode/src/worktree/merge.ts packages/opencode/test/worktree/merge-apply.test.ts
git commit -m "feat(worktree): apply changesets with git apply --3way + conflict artifacts [AI:GPT-5]"
```

---

### Task 3: Shared workdir write coordination (queue/locks + auditable events, reused by tools + merges)

**Why:** even isolated execution merges are shared writes; P2 requires “parallel read, serial write” with evented queueing.

**Files:**
- Add: `packages/opencode/src/workdir/write-queue.ts`
- Modify: `packages/opencode/src/worktree/merge.ts`
- Modify: `packages/opencode/src/file/time.ts` (optional: reuse locks)
- Test: `packages/opencode/test/worktree/write-queue.test.ts`

**Step 1: Write failing test**

Create `packages/opencode/test/worktree/write-queue.test.ts`:
- Start two merge requests concurrently targeting the same repo
- Assert:
  - second request waits until first completes
  - evidence events include queueing:
    - `workdir.write_queued`
    - `workdir.write_started`
    - `workdir.write_completed`

**Step 2: Implement `WorkdirWriteQueue`**

Implementation guidance:
- Use an in-memory queue keyed by `targetDir` (or projectId/worktree root).
- Each item includes:
  - `sessionId` (actor), `reason` ("merge", "tool", etc), and `intentFiles[]` (for “same-file overlap” explanation).
- Emit events when:
  - queued (with current queue length)
  - started
  - completed (status ok/error)
- Reuse `FileTime.withLock` as a *per-file* lock if you want to interop with `EditTool` writes:
  - lock filepaths in stable sorted order to avoid deadlocks.

**Step 3: Run test, confirm PASS**

Run: `cd "$P2_WORKTREE_DIR/packages/opencode" && bun test test/worktree/write-queue.test.ts`
Expected: PASS.

**Step 4: Commit**

```bash
git add packages/opencode/src/workdir/write-queue.ts packages/opencode/src/worktree/merge.ts packages/opencode/test/worktree/write-queue.test.ts
git commit -m "feat(workdir): serialize shared writes with auditable queue events [AI:GPT-5]"
```

---

## Part B — Post-merge gates + Evidence checks

### Task 4: Persist `checks[]/claims[]/risks[]/rollback` in `pack.json` (required for P2 gates + macro merge)

**Files:**
- Modify: `packages/opencode/src/evidence/writer.ts`
- Test: `packages/opencode/test/evidence/pack-state.test.ts`

**Step 1: Write failing test**

Create `packages/opencode/test/evidence/pack-state.test.ts`:
- open writer (`EvidenceWriter.open({ sessionId: "state" })`)
- add:
  - a check entry via `writer.check({ id, command, status, artifact })`
  - a risk entry via `writer.risk({ summary, evidence })`
  - a claim entry via `writer.claim({ id, type, statement, evidence })`
  - a rollback strategy via `writer.rollback({ strategy, steps })`
- call `writer.pack({ handoff: "..." })`
- read `.opencode/evidence/state/pack.json` and assert all the above are present
- call `writer.microPack({ parentSessionId: "parent" })` and assert:
  - `.opencode/evidence/state/micro-pack.json` includes the same `claims[]` and `checks[]` (micro-pack must not reset these to empty)
- call `writer.pack({ handoff: "second" })` again and assert:
  - previous checks/claims/risks/rollback are still present (pack is cumulative, not reset-to-empty)

**Step 2: Implement pack state storage**

Implementation guidance:
- In `EvidenceWriter.open`, if `pack.json` exists:
  - read it, parse with `EvidencePack`, and seed in-memory `claims/checks/risks/rollback/capsule.handoff + pointers + openQuestions`
  - if it does not exist, seed empty arrays + rollback default
- Add writer methods (treat them as required, not optional for P2):
  - `check(...)`, `claim(...)`, `risk(...)`, `rollback(...)`
- Ensure `pack()` writes **eventsFromDisk + in-memory state** (never hardcode empty arrays).
- Ensure `microPack()` also writes **eventsFromDisk + in-memory state** for `claims[]` + `checks[]` (micro-pack is used as a child-summary, so it must reflect what the child actually recorded).
- Ordering: before writing, sort arrays deterministically:
  - `checks` by `id asc`
  - `claims` by `id asc`
  - `risks` by `summary asc`
  - `rollback.steps` keep stable order as given (it is an ordered procedure)

**Step 3: Run test, confirm PASS**

Run: `cd "$P2_WORKTREE_DIR/packages/opencode" && bun test test/evidence/pack-state.test.ts`
Expected: PASS.

**Step 4: Commit**

```bash
git add packages/opencode/src/evidence/writer.ts packages/opencode/test/evidence/pack-state.test.ts
git commit -m "feat(evidence): persist pack state (checks/claims/risks/rollback) [AI:GPT-5]"
```

---

### Task 4.1: Populate `pack.json.artifacts[]` from `manifest.json` (and make evidence ordering deterministic)

**Why:** Section 15.4 merges child evidence packs using `artifacts[]` (and requires alias mapping). Today pack.json writes `artifacts: []` while manifest is the real SSOT. P2 parallelism will otherwise make macro merge incomplete and non-auditable.

**Files:**
- Modify: `packages/opencode/src/evidence/writer.ts`
- Test: `packages/opencode/test/evidence/pack-artifacts.test.ts`
- Test: `packages/opencode/test/evidence/micro-pack-ordering.test.ts`

**Step 1: Write failing tests**

Create `packages/opencode/test/evidence/pack-artifacts.test.ts`:
- open writer
- write two artifacts via `writer.artifact({ kind: "...", ... })`
- call `writer.pack({ handoff: "..." })`
- parse pack.json and assert:
  - `pack.artifacts.length > 0`
  - each artifact has deterministic id and includes `path + kind + sha256`
  - no artifact path points to `.opencode/evidence/...` (artifact list should represent produced artifacts, not evidence files)
  - ordering is deterministic (e.g., sorted by `sha256 asc`, then `path asc`)

Create `packages/opencode/test/evidence/micro-pack-ordering.test.ts`:
- open writer, write artifacts in different orders across two runs
- call `writer.microPack(...)`
- assert `micro-pack.json.artifacts` is sorted deterministically by `(sha256 asc, path asc)`

**Step 2: Implement**

In `packages/opencode/src/evidence/writer.ts`:
- When writing pack.json:
  - derive `artifacts[]` from current manifest entries (`entries`), but only include “real artifacts” under `.opencode/artifacts/<sessionId>/...` (exclude `.opencode/evidence/...` files like pack.json/manifest/events)
  - set `artifact.id = "artifact:" + entry.sha256` (or `"artifact:" + sha256 + ":" + path` if you want uniqueness-per-path)
  - set `artifact.kind = entry.kind`, `artifact.path = entry.path`, `artifact.sha256 = entry.sha256`
  - sort deterministically (see above)
- When writing micro-pack.json:
  - sort `artifacts` deterministically before serializing
- Optional but recommended for P2 determinism:
  - sort `manifest.entries` by `path asc` before writing `manifest.json`

**Step 3: Commit**

```bash
git add packages/opencode/src/evidence/writer.ts packages/opencode/test/evidence/pack-artifacts.test.ts packages/opencode/test/evidence/micro-pack-ordering.test.ts
git commit -m "feat(evidence): pack artifacts derived from manifest with deterministic ordering [AI:GPT-5]"
```

---

### Task 5: Implement a minimal post-merge gate runner (format/lint/test at least one)

**Files:**
- Add: `packages/opencode/src/gate/gate.ts`
- Modify: `packages/opencode/src/worktree/merge.ts` (call gate after merge success)
- Test: `packages/opencode/test/gate/gate.test.ts`

**Step 1: Write failing test**

Create `packages/opencode/test/gate/gate.test.ts`:
- construct a fake “changed files” list
- run GateRunner with:
  - format enabled, lint enabled
- assert it returns at least one check, and writes artifacts/logs + `checks[]` entries via EvidenceWriter.

**Step 2: Implement GateRunner v1**

Recommended v1 (fits the design requirement without needing project-specific CI):
- **Format gate**:
  - run configured OpenCode formatters for touched files (reuse `Format` module commands)
  - capture a log artifact (`gate/format.log.txt`)
- **Lint gate**:
  - call `LSP.diagnostics()` and compute “errors present in touched files”
  - capture a log artifact (`gate/lsp-diagnostics.json`)
- **Hard requirement:** at least one gate must run in P2.
  - If neither formatter nor LSP is available, run a fallback “git diff --check” gate:
    - command: `git diff --check` (run via `SandboxRunner.run` so policies + stdout/stderr artifacts are consistent with other tools)
    - treat empty output as PASS, non-empty output as FAIL
    - write stdout artifact (`gate/git-diff-check.txt`) and record a `checks[]` entry (`check:git-diff-check`)
  - If even git is unavailable (non-git project), record a FAILing check plus a risk (P2 isolated merge is git-based anyway).

**Step 3: Commit**

```bash
git add packages/opencode/src/gate/gate.ts packages/opencode/src/worktree/merge.ts packages/opencode/test/gate/gate.test.ts
git commit -m "feat(gate): run minimal post-merge gates and record checks [AI:GPT-5]"
```

---

## Part C — micro-pack → macro-pack merge (Evidence merge algorithm)

### Task 6: Implement deterministic macro-pack merge of child evidence packs (Section 15.4)

**Files:**
- Add: `packages/opencode/src/evidence/macro-merge.ts`
- Test: `packages/opencode/test/evidence/macro-merge.test.ts`

**Step 1: Write failing test**

Create `packages/opencode/test/evidence/macro-merge.test.ts`:
- generate two **child evidence packs** with overlapping artifacts (same sha256, different paths)
  - write child `pack.json` + `manifest.json` under `.opencode/evidence/<childSessionId>/`
- run merge into parent session using child session IDs (or evidence dirs)
- assert:
  - artifact dedupe by sha256
  - alias mapping is preserved as an artifact (sha256 -> paths[])
  - conflicts produce `risks[]` (e.g., contradictory check statuses on same check id)
  - merged output is deterministic (repeat merge yields stable JSON string via `stableJson`)

**Step 2: Implement `mergeChildEvidencePacks({ parentSessionId, childSessionIds[] })`**

Follow Section 15.4:
- artifacts:
  - dedupe by sha256
  - if a child `pack.json.artifacts[]` is empty (older packs), fall back to reading child `manifest.json.entries` (filter to `.opencode/artifacts/<childSessionId>/...`)
  - preserve alias mapping (same sha256, multiple paths) by writing an artifact like:
    - `.opencode/artifacts/<parentSessionId>/evidence/artifact-aliases.json`
    - content: `{ specVersion: "artifact-aliases/1.0", bySha256: { "<sha>": ["path1", "path2"] } }`
- claims:
  - merge from child `pack.json.claims`
  - dedupe by claim id else content hash
- checks:
  - merge from child `pack.json.checks`
  - if same check id has pass+fail from different children, emit a `risk` and require re-check (record in events)
- risks:
  - include child `pack.json.risks` (dedupe by `summary + evidence(sorted)` hash) and add merge-conflict risks
- rollback:
  - v1: keep parent rollback as SSOT; optionally append merge-specific steps (pointers to changesets / conflict artifacts)
- write macro-pack to `.opencode/evidence/<parentSessionId>/pack.json` (via EvidenceWriter APIs; Task 4/4.1 must be done so pack has state + artifacts)
- determinism rules:
  - sort merged `checks/claims/risks` before writing (match Task 4 ordering rules)
  - keep `events` chronological; when adding merge events, append with stable `merge_policy` string (e.g. `"macro-merge/1.0"`)

**Step 3: Integration note**

To reduce churn, keep Task 6 focused on the merge algorithm + tests. Wire it into `TaskTool` once, together with code auto-merge + gates, in **Task 7**.

**Step 4: Commit**

```bash
git add packages/opencode/src/evidence/macro-merge.ts packages/opencode/test/evidence/macro-merge.test.ts
git commit -m "feat(evidence): deterministic child evidence to macro-pack merge [AI:GPT-5]"
```

---

## Part D — Auto-merge child workdirs back to main + conflict artifacts + gates

### Task 7: Auto-merge child session change-sets into the chosen main workdir (universal finalizer)

**Files:**
- Add: `packages/opencode/src/session/finalizer.ts` (universal finalize primitive)
- Modify: `packages/opencode/src/session/prompt.ts` (invoke finalizer when a child session finishes)
- Modify: `packages/opencode/src/tool/task.ts` (optional: await finalizer for synchronous UX)
- Test: `packages/opencode/test/tool/task-merge.test.ts`
- Test: `packages/opencode/test/session/child-finalizer.test.ts` (optional but recommended)

**Step 1: Write failing test**

Create `packages/opencode/test/tool/task-merge.test.ts`:
- create tmp repo
- start parent session
- run TaskTool to create child session
- in child session worktree, write a file
- complete subagent flow (simulate by directly writing to child worktree + calling micro-pack emission if needed)
- assert:
  - the parent/main workdir contains the child’s changes after TaskTool completes
  - a gate ran and wrote a `check` to parent `pack.json`
  - on conflict, conflict artifacts exist and merge is blocked until approval decision

**Step 2: Implement merge on TaskTool completion**

Implementation guidance:
- (Optional; Decision 6 Option B) If a specific child is spawned in `shared` mode:
  - require an explicit permission prompt / audit event (`workdir.mode_switched`) because this expands the writable boundary
- locate child change-set artifacts:
  - `.opencode/artifacts/<childSessionId>/worktree/changes.patch`
  - `.opencode/artifacts/<childSessionId>/worktree/changes.json`
- merge child evidence into parent macro-pack (Task 6):
  - ensure child `pack.json` is finalized (call `writer.pack({ handoff: "task completed" })` if needed)
  - call `mergeChildEvidencePacks({ parentSessionId: ctx.sessionID, childSessionIds: [childSessionId] })`
  - emit `evidence.macro_pack_merged` with `merge_policy: "macro-merge/1.0"` and the merged child ids
- call `WorktreeMerge.applyChangeSet` under `WorkdirWriteQueue` coordination
- on success:
  - run GateRunner, write checks to parent evidence
- on conflict/error:
  - write a `risk` entry to parent evidence (merge blocked) and emit an event `worktree.merge_conflict`
  - return output that includes pointers to conflict artifacts + explicit “needs decision” metadata

**Universal finalizer requirement (do not skip if you want plugin compatibility):**
- Create `finalizeChildSession({ parentSessionId, childSessionId })` in `packages/opencode/src/session/finalizer.ts` that performs the exact same pipeline as above.
- Call it from `SessionPrompt.loop()` when the loop is about to finish and `Session.parentID` exists.
- Make finalization idempotent (best-effort v1):
  - Before merging, check for a marker artifact/file under `.opencode/artifacts/<parentSessionId>/worktree/merged/<childSessionId>.json` (or an equivalent state record).
  - If marker exists, skip and emit an event `worktree.merge_skipped` with reason `already_finalized`.
  - After success/conflict, write/update the marker so both `TaskTool` and session-finalizer can safely call it.

**Step 3: Commit**

```bash
git add packages/opencode/src/session/finalizer.ts packages/opencode/src/session/prompt.ts packages/opencode/src/tool/task.ts packages/opencode/test/tool/task-merge.test.ts packages/opencode/test/session/child-finalizer.test.ts
git commit -m "feat(task): auto-merge child changesets with gates + conflict artifacts [AI:GPT-5]"
```

---

## Part E — Routing A/B/C worker protocol skeleton (artifacts + caching + scheduling)

### Task 8: Create a `RoutingRunner` that writes protocol artifacts and events

**Files:**
- Add: `packages/opencode/src/routing/runner.ts`
- Add: `packages/opencode/src/routing/worker-a.ts`
- Add: `packages/opencode/src/routing/worker-b.ts`
- Add: `packages/opencode/src/routing/worker-c.ts`
- Add: `packages/opencode/src/routing/cache.ts` (disk + memory; no Redis dependency)
- Modify: `packages/opencode/src/config/config.ts` (add `routing` section + defaults)
- Test: `packages/opencode/test/routing/runner.test.ts`

**Step 1: Write failing test**

Create `packages/opencode/test/routing/runner.test.ts`:
- create tmp repo with some files
- call `RoutingRunner.run({ sessionId, messageId, intentText, tier })`
- assert artifacts exist:
  - `.opencode/artifacts/<sessionId>/routing/<routingRunId>/request.json`
  - `.opencode/artifacts/<sessionId>/routing/<routingRunId>/worker-a.result.json`
  - `.opencode/artifacts/<sessionId>/routing/<routingRunId>/worker-b.result.json`
  - `.opencode/artifacts/<sessionId>/routing/<routingRunId>/worker-c.result.json`
  - `.opencode/artifacts/<sessionId>/routing/<routingRunId>/routing.capsule.md`
- optional artifacts may exist when needed (do not require in v1 test):
  - `worker-a.snippets.json`, `worker-b.citations.json`, `worker-c.paths.json`
- parse request/result JSON with Zod schemas (strict).

**Step 2: Implement config defaults (Section 2.3.8 + 2.3.6)**

In `packages/opencode/src/config/config.ts`, add:
- `routing.enabled` (default true)
- `routing.maxRoutingRunsInFlight` (default 1)
- `routing.maxWorkersInFlight` (default 3)
- `routing.maxWallClockMs` (default 15000)
- `routing.workerTimeoutMs` (default 8000)
- `routing.topK` (default 20)

**Step 3: Implement `RoutingRunner.run(...)`**

Behavior:
- Build a `RoutingRunRequest` using the protocol schema (`routing-run-request/1.0`):
  - deterministic normalization of intent
  - `intent.fingerprint = sha256(intent.normalized + "\\n" + versions.routingTemplate)`
  - `project.projectId = Instance.project.id`, `project.worktreeRoot = Instance.worktree`
  - `repo` (must satisfy schema):
    - git: `head = git rev-parse HEAD`, `dirty = git status --porcelain != ""`
    - when dirty, compute `diffFingerprint` as **sha256 of a stable diff representation** (recommended: reuse the same patch text construction as `captureWorktreePatch()` and hash it)
    - when clean, set `diffFingerprint = ""` (schema requires empty when `dirty=false`)
    - non-git: `vcs="none"`, `head=""`, `dirty=false`, `diffFingerprint=""`
  - `budgets` from config defaults (max wall clock, worker timeout, topK)
  - `workers` enabled/topK from config defaults
  - `versions` must be explicit strings (bump on schema/sorting changes):
    - `routingTemplate` (e.g. `"routing-template/1.0"`)
    - `capsuleSchema` (e.g. `"routing-capsule/1.0"`)
    - `workerSchemas` (e.g. `"routing-worker-result/1.0"`)
- Write `request.json` via EvidenceWriter.artifact after `RoutingRunRequest.parse(...)` and `stableJson` canonicalization.
- Start A/B/C workers concurrently:
  - enforce `maxWallClockMs` and per-worker timeout
  - cancellation: a newer run cancels older run and writes `routing_cancelled` event
- Each worker must always produce a result.json:
  - must satisfy `RoutingWorkerResult` schema (strict Zod parse)
  - status: ok/degraded/unavailable/error
  - fill required fields even when unavailable/degraded:
    - `cache.{hit,key,scope,reason}`, `timing.{startedAtUtc,endedAtUtc,durationMs}`, `inputs.{intentFingerprint,repoFingerprint,configFingerprint}`
  - errors[] filled on failures (and still write the result artifact)
- Aggregate a short `routing.capsule.md`:
  - <= ~400 tokens, facts + pointers only (no long reasoning)
- Register all artifacts in evidence manifest automatically via EvidenceWriter.

**Step 4: Implement cache (P0–P2 no Redis)**

Implement a local cache:
- Compute fingerprints per Section 2.3.4:
  - `repoFingerprint = dirty ? sha256("git:" + head + "+dirty:" + diffFingerprint) : sha256("git:" + head)`
  - `configFingerprint = sha256(stableJson({ specVersion: "routing-config-fingerprint/1.0", budgets, workers, versions, indexVersions }))`
- key = `sha256(stableJson({ specVersion: "routing-cache-key/1.0", workerId, scope: { projectId, worktreeRoot }, repoFingerprint, intentFingerprint, configFingerprint }))`
- store on disk under `.opencode/cache/routing/<key>.json` (or Storage backend) + in-memory LRU (no Redis)
- on hit:
  - write event `cache_hit` with reason `exact_match`
  - still write the worker result artifact for this run (copy from cached payload), so evidence is complete per-run.

**Step 5: Commit**

```bash
git add packages/opencode/src/config/config.ts packages/opencode/src/routing packages/opencode/test/routing/runner.test.ts
git commit -m "feat(routing): routing runner skeleton with artifacts, cache, and scheduling [AI:GPT-5]"
```

---

### Task 9: Minimal worker implementations (degrade-first, never block)

**Files:**
- Modify: `packages/opencode/src/routing/worker-a.ts`
- Modify: `packages/opencode/src/routing/worker-b.ts`
- Modify: `packages/opencode/src/routing/worker-c.ts`
- Test: `packages/opencode/test/routing/workers.test.ts`

**Worker A (Repo/LSP) v1**
- Capability rules: read-only repo (no file writes), no network; only write artifacts under `.opencode/artifacts/...`.
- Approach: use `Filesystem` scanning + (optional) `rg` search to find candidate files; optionally enrich with `LSP` if available.
  - If you invoke external binaries like `rg`, run them via `SandboxRunner.run` in a read-only capability (so evidence/policy is uniform).
- Must sort `files[]` by `score desc` then `path asc` (Section 2.3.5).
- Must output snippets pointers as artifacts if used.

**Worker B (KB/RAG) v1**
- Capability rules: no network by default; if a KB backend requires local HTTP, it must be allowlisted (host+port) and recorded in events.
- Default behavior: if no KB configured, return `status: "unavailable"` with `events: worker.unavailable` + risk.
- Optional local fallback: treat `docs/` as “KB” and produce citations from `rg -n` matches:
  - `citation.relativePath`, `startLine`, `endLine`, `contentHash` (sha256 of snippet)

**Worker C (Graph/Impact) v1**
- Capability rules: no network by default; graph access is “optional accelerator” and must never block routing.
- Default behavior: `unavailable` (no Neo4j by default in P2).
- If graph backend configured later, enforce allowlist for loopback and write explicit risk boundaries (soft/hard).

**Commit**

```bash
git add packages/opencode/src/routing/worker-*.ts packages/opencode/test/routing/workers.test.ts
git commit -m "feat(routing): worker A/B/C minimal implementations with graceful degradation [AI:GPT-5]"
```

---

### Task 10 (optional, if you want router-first in P2): Wire routing into prompt building

**Files:**
- Modify: `packages/opencode/src/session/prompt.ts` (or a narrow entrypoint)
- Test: `packages/opencode/test/session/routing-injection.test.ts`

**Goal:** Before primary agent generation, run `RoutingRunner.run(...)` and inject only:
- a short routing capsule (or a pointer to it)
- pointers to `request.json` + `worker-*.result.json` artifacts

This is intentionally pointer-first (avoid token explosion).

---

## Part F — “资料工作台” P2 upgrades + Python offline-first supply chain

This part is P2-scoped per the design doc, but can be executed as **P2b** after the merge/routing backbone is stable.

### Task 11: Verify the P1 baseline exists for the file workbench; implement missing P1 pieces if needed

**P1 baseline checks (must exist before P2 upgrades):**
- `.opencode/artifacts/<sessionId>/inputs/` + `inputs.json`
- `inputId = sha256(file_bytes)` dedupe + `events: cache_hit`
- derived `text.txt` + `chunks.json` for text-like files
- `doc.unpack_archive` for zip/tar
- best-effort `doc.extract_pdf_text` (with explicit failure evidence, not silent)

If missing, implement them first (even if they were originally “P1”): P2 upgrades depend on these artifacts.

---

### Task 12: Add built-in Python scripts for doc processing and update script manifest

**Files:**
- Add: `packages/opencode/src/python/scripts/doc-extract-pdf-text.py`
- Add: `packages/opencode/src/python/scripts/doc-unpack-archive.py`
- Add: `packages/opencode/src/python/scripts/doc-ocr-image.py` (P2; may be stubbed if OCR not available)
- Update: `packages/opencode/src/python/scripts.manifest.json`
- Test: `packages/opencode/test/python/doc-scripts.test.ts`

**Key rules:**
- scripts must be allowlisted by `script_id` (ScriptRegistry)
- input/output are artifacts (`--input ... --output ...`)
- all outputs are written under `.opencode/artifacts/<sessionId>/derived/<inputId>/...` and registered in evidence manifest

---

### Task 13: Implement P2 “stable PDF pages” + OCR + Office parsing (quality/coverage upgrade)

**Deliverables:**
- `derived/<inputId>/pdf.pages.json` with page-level provenance (page number, per-page content hash)
- OCR pipeline:
  - explicit policy approval + redaction hooks
  - local tesseract OR enterprise cloud OCR (config-gated), but always evidence-backed
- Office parsing:
  - start with docx → text + structure

If dependencies are required, they must use the P2 offline-first mechanism (Task 14).

---

### Task 14: Python dependency offline-first (wheelhouse + lock-hash) with explicit approval for online fallback

**Files:**
- Modify: `packages/opencode/src/config/config.ts` (extend `python` section)
- Modify: `packages/opencode/src/tool/python.ts`
- Add: `packages/opencode/src/python/env.ts` (venv + install logic)
- Add: `packages/opencode/test/python/offline-deps.test.ts`

**Config additions (v1):**
- `python.deps.mode`: `"offline" | "online" | "disabled"` (default `"offline"`)
- `python.deps.wheelhousePath`: string (optional)
- `python.deps.lockFile`: string (optional, must include hashes)
- `python.deps.allowOnlineFallback`: boolean (default false)

**Behavior:**
- Always record:
  - python version artifact
  - script sha256
  - deps lock hash
  - `pip freeze` artifact
- Default: offline install using wheelhouse + lock hashes.
- Online install only when:
  - explicit approval granted, and network policy allows it, and risk is recorded.

---

## Part G — Undo evidence linkage (P1/P2)

### Task 15: Ensure `undo` snapshot references are written into Evidence Pack

**Files:**
- Modify: `packages/opencode/src/snapshot/index.ts` (emit events via EvidenceWriter)
- Modify: `packages/opencode/src/session/...` or CLI undo handler (wherever undo is invoked)
- Test: `packages/opencode/test/snapshot/evidence-snapshot.test.ts`

**Requirement:**
- When a snapshot is created/restored/reverted:
  - emit an event (`snapshot.created` / `snapshot.restored` / `snapshot.reverted`)
  - include snapshot hash pointer and affected file list artifact
- Especially important for shared workdir mode: rollback steps must be explicit and auditable.

---

## Regression / Acceptance Criteria (P2 Exit Gate)

P2 is “done” when these are objectively true:
- A child session can run tools in isolated workdir and produce `worktree/changes.patch + worktree/changes.json`.
- The parent can auto-merge those changes into the chosen main workdir:
  - conflicts are artifactized (no silent failure)
  - queue/locking events explain any serialization
- Post-merge, at least one gate runs and writes an entry into `pack.json: checks[]`.
- Routing runner writes `request.json`, `worker-*.result.json`, and `routing.capsule.md` artifacts and honors timeouts/cancellation.
- No new Redis dependency is introduced (cache is memory+disk).
- Worker B/C can be unavailable without blocking; evidence records the degradation.

---

## Execution Handoff

Plan complete and saved to `docs/plans/2026-01-30-opencode-sandbox-context-p2-implementation-plan.md`.

Two execution options:
1) **Same session, task-by-task**: use `superpowers:executing-plans`.
2) **Parallel session**: open a new session in your chosen P2 worktree (`$P2_WORKTREE_DIR`) and execute with checkpoints.
