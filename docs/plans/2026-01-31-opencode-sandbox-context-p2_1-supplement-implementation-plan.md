# OpenCode Sandbox + Context Control P2.1 Supplement Implementation Plan (UPSTREAM.lock.json)

> **For Codex CLI:** Use `superpowers:executing-plans` to implement this plan task-by-task (no batching).

**Goal:** Close the remaining “integration provenance” gap from the master design doc Section 10 by ensuring
`opencode-zh-build/UPSTREAM.lock.json` is always easy to generate safely (without risky git history rewrites),
and (optionally) attach it into session Evidence Packs as a first-class artifact pointer.

**Architecture:**
1) Add a **lockfile-only mode** (or a dedicated script) that writes `UPSTREAM.lock.json` without touching repo state.
2) Add a **fast local check** so missing lockfile fails early.
3) (Optional but recommended) Teach `EvidenceWriter` to **capture a copy** of `UPSTREAM.lock.json` into
   `.opencode/artifacts/<sessionId>/environment/upstream.lock.json`, so each Evidence Pack can be audited
   without relying on the external workspace state.

**Tech Stack:** Bash (opencode-zh-build tooling), TypeScript + Bun + Zod (OpenCode evidence), existing `EvidenceWriter`.

---

## Background (why this supplement exists)

Design requirement (master doc):
- `docs/plans/2026-01-25-opencode-sandbox-context-design.md` → **Section 10** (`UPSTREAM.lock.json`)

Current verified status (as of 2026-01-31):
- `opencode-zh-build/UPSTREAM.lock.json` is **missing** (must be fixed before starting P3).

---

### Task 0: Baseline checks (prove the gap exists)

**Files:** none (command-only)

**Step 1: Confirm lockfile is missing**

Run:
- `test -f opencode-zh-build/UPSTREAM.lock.json && echo OK || echo MISSING`

Expected:
- `MISSING`

**Step 2: Confirm the update script already contains lockfile writer logic**

Run:
- `rg -n "write_upstream_lock\\b|LOCK_FILE\\b" opencode-zh-build/update_opencode_zh.sh`

Expected:
- matches for `LOCK_FILE=.../UPSTREAM.lock.json` and `write_upstream_lock()`.

---

### Task 1: Add a safe “lockfile-only” generation path (no repo modifications)

**Files:**
- Modify: `opencode-zh-build/update_opencode_zh.sh`

**Step 1: Decide the interface**

Choose one:
- Option A (recommended): `LOCKFILE_ONLY=1 ./update_opencode_zh.sh`
- Option B: add a dedicated script `opencode-zh-build/write_upstream_lock.sh` that only writes the lockfile.

This plan implements **Option A** because it reuses the existing implementation and avoids code duplication.

**Step 2: Implement `LOCKFILE_ONLY` mode**

Add a new env flag near the top:
- `LOCKFILE_ONLY="${LOCKFILE_ONLY:-0}"`

Then, after validating required paths exist (`opencode_src/` and patch files), short-circuit:
- if `LOCKFILE_ONLY=1`: call `write_upstream_lock` and `exit 0`

**Important safety requirement:**
- In `LOCKFILE_ONLY=1` mode, the script MUST NOT run any `git fetch/pull/reset/apply` or `bun install/build`.

**Step 3: Manual verification**

Run:
- `LOCKFILE_ONLY=1 SKIP_BUILD=1 SKIP_OH_MY=1 ./opencode-zh-build/update_opencode_zh.sh`

Expected:
- Exit 0
- Prints that it wrote the lockfile
- File exists at `opencode-zh-build/UPSTREAM.lock.json`

---

### Task 2: Add a fast local check command (fail fast if lockfile missing/invalid)

**Files:**
- Create: `opencode-zh-build/check_upstream_lock.sh`
- (Optional) Modify: `opencode-zh-build/README.md` (document the check)

**Step 1: Implement `check_upstream_lock.sh`**

Requirements:
- Exit non-zero if `UPSTREAM.lock.json` is missing.
- Exit non-zero if JSON is invalid.
- Exit non-zero if required top-level keys are missing:
  - `schemaVersion`, `generatedAtUtc`, `toolchain`, `repos`, `patches`

Implementation approach (simple + portable):
- Use `node -e 'JSON.parse(fs.readFileSync(...))'` for JSON parsing.
- Validate keys in JS and `process.exit(1)` on missing ones.

**Step 2: Verify check behavior**

Run:
- `./opencode-zh-build/check_upstream_lock.sh`

Expected:
- PASS after Task 1, FAIL before Task 1.

---

### Task 3 (Optional, but recommended): Attach upstream lockfile into Evidence Pack as an artifact

**Files:**
- Modify: `opencode-zh-build/opencode_src/packages/opencode/src/evidence/writer.ts`
- Test: `opencode-zh-build/opencode_src/packages/opencode/test/evidence/upstream-lock-artifact.test.ts`

**Why:** Section 10 explicitly maps the lockfile into provenance. Attaching it as an artifact makes each evidence pack
self-contained for offline auditing, and it also makes `opencode evidence export` include it automatically.

**Step 1: Write a failing test**

Create `packages/opencode/test/evidence/upstream-lock-artifact.test.ts`:
- Create a temp workspace root with a `repo/` directory that is the `Instance.directory`
- Write `UPSTREAM.lock.json` at the parent dir of `repo/`
- Call `EvidenceWriter.open({ sessionId })` and trigger a `pack({ handoff })`
- Assert `manifest.json` contains an entry with kind `upstream-lock` (or a stable kind you choose)
- Assert the artifact file exists under `.opencode/artifacts/<sessionId>/environment/upstream.lock.json`

**Step 2: Run test to verify it fails**

Run:
- `cd opencode-zh-build/opencode_src/packages/opencode && bun test test/evidence/upstream-lock-artifact.test.ts`

Expected:
- FAIL (no lockfile attachment exists yet)

**Step 3: Implement minimal attachment logic**

In `EvidenceWriter.open()` (or during `pack()`), implement:
- Search upward from the evidence base directory for `UPSTREAM.lock.json` (limit depth, e.g. 6)
- If found and not already present in manifest:
  - Read file bytes
  - Write it as an artifact at `environment/upstream.lock.json`
  - Register manifest entry kind `upstream-lock`
  - Emit an event like `evidence.upstream_lock_attached` (optional)

**Step 4: Run test to verify it passes**

Run:
- `cd opencode-zh-build/opencode_src/packages/opencode && bun test test/evidence/upstream-lock-artifact.test.ts`

Expected:
- PASS

**Step 5: Full verification**

Run:
- `cd opencode-zh-build/opencode_src/packages/opencode && bun test`

Expected:
- PASS (0 failures)

