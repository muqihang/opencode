# Task 14 Execution Plan — Python dependency offline-first (wheelhouse + lock-hash) + explicit approval for online fallback

Date: **2026-01-31**

Owner: execution agent (in a git worktree)  
Reviewer: primary session (“西西弗斯”) + user

Related master plan: `docs/plans/2026-01-30-opencode-sandbox-context-p2-implementation-plan.md` (Task 14)

---

## Why Task 14 before Task 13

Task 13 (stable PDF pages / OCR / Office parsing) is dependency-heavy. If we implement Task 13 first, we will either:
- silently depend on system packages (non-reproducible), or
- introduce ad-hoc pip installs (supply-chain risk), or
- later refactor everything to the offline-first model.

So we do **Task 14 first** to establish the dependency supply-chain mechanism and evidence trail; then Task 13 can
add/upgrade Python libraries safely and deterministically.

---

## Goal / Non-goals

### Goal

Add a **Python dependency manager v1** to OpenCode that is:
- **Offline-first by default** (wheelhouse + lock file with hashes).
- **Auditable** (writes evidence artifacts for version + lock hash + pip freeze + policy/risk events).
- **Safe** (online fallback only with explicit approval + network policy + risk recorded).
- **Tool-integrated** (PythonTool uses the venv python when deps enabled).

### Non-goals (explicitly out of scope for Task 14)

- Implementing Task 13 features (stable PDF pages/OCR/Office parsing).
- Building a wheelhouse downloader / “pip download” automation (can be a follow-up Task 14.1 if needed).
- Full SBOM/attestation pipeline (P4 scope).
- Making hard sandbox enforcement real (current sandbox is soft).

---

## Requirements (from Task 14 spec)

### Files (required)

- Modify: `packages/opencode/src/config/config.ts`
- Modify: `packages/opencode/src/tool/python.ts`
- Add: `packages/opencode/src/python/env.ts`
- Add: `packages/opencode/test/python/offline-deps.test.ts`

### Config additions (v1)

Under `python`:
- `python.deps.mode`: `"offline" | "online" | "disabled"` (default `"offline"`)
- `python.deps.wheelhousePath`: string (optional)
- `python.deps.lockFile`: string (optional, must include hashes)
- `python.deps.allowOnlineFallback`: boolean (default `false`)

### Behavior (v1)

- Always record:
  - python version artifact
  - script sha256
  - deps lock hash
  - `pip freeze` artifact
- Default: offline install using wheelhouse + lock hashes.
- Online install only when:
  - explicit approval granted, and
  - network policy allows it, and
  - risk is recorded.

### Compatibility constraint (must not regress)

`PythonTool` must remain usable in “no deps configured” projects:
- If the user has not configured `python.deps.*` (no lock file, no wheelhouse, no explicit online mode), the tool
  should behave like today (run `pythonPath` directly) and **must not require `python -m venv` / pip**.
- This avoids breaking environments where `python3` exists but `venv`/`pip` is not installed (common on minimal Linux).

---

## Execution Rules (must follow)

### Strict TDD

For each logical unit:
1) Write the test and observe **RED**
2) Implement minimum to get **GREEN**
3) Refactor only after GREEN, and re-run the focused tests

### “No hallucination” rule (context7 escalation)

If implementation requires a behavior that you are not 100% sure about (pip flags, venv layout, `--require-hashes`),
do not guess:
1) Search existing repo patterns first (`rg`).
2) If still uncertain, use **Context7 MCP** to query official docs for the relevant tool/library.
3) Encode the decision into a test (asserted behavior) or an evidence event.

### Safety policy reminders

Do not delete files/directories, run `git restore/reset/clean/rebase`, or do any irreversible operation without user
confirmation.

---

## Design (v1) — what we will implement

### High-level flow

When `PythonTool.execute()` runs:
1) Resolve `deps` policy from config (mode + lock + wheelhouse + fallback).
2) Resolve a venv directory under `.opencode/` (safe write path).
3) Ensure venv exists (create if missing).
4) If deps are enabled and a lock file is provided:
   - Offline mode: install deps from wheelhouse with hash checking.
   - If offline fails and `allowOnlineFallback=true`: request explicit approval and (only if permitted) do online install.
5) Run script using **venv python**.
6) Record evidence artifacts (version/lock hash/freeze) and policy/risk events.

### “Deps enabled” decision (important)

To satisfy both “offline-first” and backward compatibility, we define **deps enabled** as:

- `python.deps.mode === "disabled"` → deps disabled (no venv, no pip)
- Otherwise deps are enabled only if at least one of these is set:
  - `python.deps.lockFile` (preferred; deterministic)
  - `python.deps.wheelhousePath` (usually paired with lock)
  - `python.deps.mode === "online"` (explicit; always requires approval + allowNetwork)

If deps are not enabled by this rule, `PythonTool` runs as it does today and only records the existing env/script
evidence.

### Venv location + cache key

Store venvs under:
- `.opencode/runtime/python/venv/<venvKey>/`

`venvKey` should be deterministic and collision-safe, recommended inputs:
- python executable identity (path string) OR python version string (best-effort)
- deps lock file sha256 (or `"no-lock"`)
- wheelhouse path string (or `"no-wheelhouse"`)
- deps mode (`offline|online`)

Rationale:
- This makes installs reusable across sessions/worktrees while staying scoped to the repo’s `.opencode/` boundary.
- A lock hash change naturally invalidates and creates a new venv directory.

### Lock file format (v1 expectations)

We do not introduce a new lock format in v1; we expect **pip-compatible requirements with hashes**, e.g.:

```
pkg==1.2.3 \\
  --hash=sha256:... \\
  --hash=sha256:...
```

We validate the lock file by attempting installation with `--require-hashes` and recording failures as evidence.

### Path safety + capability truthfulness (v1)

Wheelhouse and lock paths MUST be treated as sensitive filesystem reads:
- Prefer **repo-relative** paths in config.
- If an absolute path is provided, it must be validated to be within the project boundary (`Instance.worktree` /
  `Instance.directory`) and must not traverse/symlink out.
- If the path is outside the boundary, stop with a clear error + evidence event (do not silently “just read it”).

This keeps `capability.readonlyPaths: [Instance.worktree]` truthful and prevents “hidden” external dependency sources.

### Evidence artifacts / events (minimum set)

Artifacts (under `.opencode/artifacts/<sessionId>/python/`):
- `python-version.txt` (already exists today; keep)
- `deps-lock.sha256.txt` (new)
- `pip-freeze.txt` (new)
- Optional: `deps-policy.json` (new; stableJson)

Events (types are suggestions; keep stable naming once chosen):
- `tool.python.deps.policy` (info; includes mode/paths)
- `tool.python.deps.offline_install_started` / `...completed` (info/warn)
- `tool.python.deps.offline_install_failed` (warn/error; include stderr artifact pointer)
- `tool.python.deps.online_fallback_requested` (warn; include reason + approval gate)
- `tool.python.deps.online_fallback_used` (warn; include network policy)

### Approval model (v1)

Keep the existing single `ctx.ask(permission="python")` for script execution.

For online fallback, do **one extra approval** only when needed:
- `ctx.ask(permission="python.deps_online")` (recommended), or reuse `"python"` but with a distinct `patterns` namespace.

This preserves the “max 1 approval per tool run” ideal in the common case (offline success), while still enabling
explicit opt-in for the risky path.

### Evidence-on-failure rule for deps artifacts

To satisfy “always record” without making installs flaky:
- If a lock file is configured but cannot be read/hashed, still write `deps-lock.sha256.txt` containing a stable JSON
  error payload and emit a warn event.
- If `pip freeze` fails (missing pip), still write `pip-freeze.txt` containing a stable JSON error payload and emit a
  warn event.

---

## TDD Task Breakdown (implementation steps)

### Task 14.0 — Baseline / scaffolding

1) Create a new worktree from `feature/opencode-custom` (example branch: `p2b-task14`).
2) Install deps with bun (npm is known to fail due to `catalog:` deps):
   - `BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun install`
3) Run a quick baseline to ensure environment is sane:
   - `cd packages/opencode && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test test/tool/python-env-evidence.test.ts`

Exit gate: baseline passes.

### Task 14.1 — Config schema additions (RED → GREEN)

Test first (if tests exist for config): add/extend a config parse test; otherwise add a minimal unit test:
- New: `packages/opencode/test/config/python-deps-config.test.ts` (optional; only if repo has config tests)

Implement:
- Extend `python` schema in `packages/opencode/src/config/config.ts` with `deps` object.
- Ensure defaults:
  - `mode` defaults to `"offline"`
  - `allowOnlineFallback` defaults to `false`

Exit gate: config parsing works; existing config tests (if any) still pass.

### Task 14.2 — `python/env.ts` (core logic) (RED → GREEN)

Add tests for pure helpers first (no real pip install):
- Venv path resolution is deterministic and under `.opencode/`.
- Cross-platform python path inside venv resolves correctly (`bin/python` vs `Scripts/python.exe`).
- Lock hash computation is stable (sha256 of bytes).

Implement `packages/opencode/src/python/env.ts` with:
- `computeFileSha256(path): Promise<string>`
- `resolveVenvDir({ baseDir, venvKey }): string`
- `resolveVenvPythonPath(venvDir): string` (platform-aware)
- `ensureVenv({ pythonPath, venvDir }): Promise<void>` (uses `python -m venv`)
- `pipInstallOffline({ venvPython, wheelhousePath, lockFile, timeoutMs }): Promise<{ ok: boolean; stdout: string; stderr: string }>`
- `pipFreeze({ venvPython }): Promise<string>`

Implementation notes:
- Use spawn (same style as existing `pythonVersion()` helper) for predictability.
- Pipe stdout/stderr; enforce timeouts; return structured error strings.

Exit gate: new unit tests pass.

### Task 14.3 — Wire into `PythonTool` (RED → GREEN)

Add `packages/opencode/test/python/offline-deps.test.ts` first (RED), covering at least:

Case 0 (regression guard): no deps configured
- With config absent or with `python.deps` missing, `PythonTool` must still execute the allowlisted script (same as
  today) and must not error due to missing venv/pip.

Case A: deps offline + lock file set but missing wheelhouse
- Configure `Config.get()` via temp config file (or mock pattern used elsewhere).
- Expect: tool errors (or returns non-zero) and writes:
  - `deps-lock.sha256.txt` (still should be recorded if lock file present)
  - a deps policy event describing why it failed

Case B: deps disabled
- Expect: tool still runs with base python and does not attempt venv install (assert via event/evidence markers).

Case C: deps offline + empty lock file + wheelhouse exists
- Create an empty requirements file in tmpdir and an empty wheelhouse dir.
- Expect: tool succeeds; writes `pip-freeze.txt` (even if empty/minimal).

Implement wiring in `packages/opencode/src/tool/python.ts`:
- Resolve deps config (with safe defaults when absent).
- Compute lock hash when lock file is provided.
- Ensure venv and (if needed) perform pip install before script execution.
- Run script with `venvPython` when deps mode != disabled.
- Always write the required artifacts:
  - `deps-lock.sha256.txt` (if lockFile present)
  - `pip-freeze.txt` (if deps enabled; otherwise optional but recommended)
- Emit the minimum evidence events described above.

Exit gate: `bun test test/python/offline-deps.test.ts` passes.

### Task 14.4 — Online fallback (policy + evidence) (RED → GREEN)

Add a test that simulates offline failure and asserts:
- online fallback is **not** attempted unless:
  - `allowOnlineFallback` is true
  - network policy is not deny_all
  - explicit approval is requested (`ctx.ask` called with `python.deps_online`)

Implementation:
- In offline failure path, if fallback allowed:
  - request explicit approval
  - if approved, run pip install online
  - record a risk event with network policy and reason

Exit gate: tests pass and “online fallback” is never silent.

### Task 14.5 — Regression pass

Run:
- `cd packages/opencode && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test test/python`
- Then full:
  - `cd packages/opencode && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test`

Exit gate: full suite passes.

---

## Definition of Done (Task 14)

Task 14 is complete when:
- Config supports `python.deps.*` and defaults are correct.
- PythonTool uses venv python when deps enabled.
- Offline-first installation is attempted when lock+wheelhouse exist.
- Online fallback is impossible unless explicitly approved + network allowed + risk recorded.
- Evidence artifacts are written:
  - python version
  - script sha256 (already)
  - deps lock hash
  - pip freeze
- New tests pass and full test suite is green.

---

## Suggested executor prompt (for a new terminal agent)

Use this prompt to dispatch an execution agent:

> You are executing **Task 14** from `docs/plans/2026-01-31-task14-python-offline-deps-plan.md` in a git worktree.  
> Constraints: strict TDD (RED→GREEN), no deletes/git-restore/reset/clean without confirmation, and if unsure use Context7 MCP for official docs before implementing.  
> Use bun (npm install fails due to `catalog:`). Run the plan’s tests and finish with full `bun test` passing under `packages/opencode`.
