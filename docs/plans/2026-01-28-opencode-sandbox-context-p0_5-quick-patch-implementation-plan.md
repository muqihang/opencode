# OpenCode Sandbox + Evidence Pack P0.5 Quick Patch Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close the remaining P0 gaps from `2026-01-25-opencode-sandbox-context-design.md` by adding `pack.md` (human view), enforcing Pointers-not-Paste for large tool outputs (return pointers, not full text), and making sandbox backend/enforcement **explicitly auditable** in evidence. After completing P0.5, you can execute the P1 v2 plan **without changes**.

**Architecture:** Extend the existing `EvidenceWriter` so it can (1) write canonical JSON (`pack.json`, `manifest.json`) deterministically, (2) render a short `pack.md` view that references manifest entries (pointers), and (3) include sandbox `backend/enforcement` in both the event log and the pack environment. Update `SandboxRunner` to finalize evidence per run (best-effort) and update `BashTool` to obey Pointers-not-Paste: small outputs inline, large outputs return pointers to stdout/stderr artifacts only.

**Tech Stack:** TypeScript, Bun, Zod 4, existing `EvidenceWriter`, existing `SandboxRunner`, existing `BashTool`, git worktree.

---

## Design Coverage Index (P0.5 items, no omissions)

This plan targets the **explicit P0 requirements** from `opencode-zh-build/opencode_src/docs/plans/2026-01-25-opencode-sandbox-context-design.md`:

- Evidence Pack files: `.opencode/evidence/<sessionId>/{pack.json,pack.md,manifest.json}` (design: “必须/交付”).
- `events.jsonl` is timeline SSOT (must exist and parse as `event/1.0`).
- Pointers-not-Paste: output over threshold must return **pointers** (paths + sha256) not raw text.
- “soft/hard transparency”: evidence must include `sandbox.backend` and `sandbox.enforcement`.
- `isolated` workdir default via git worktree (already in P0; keep as-is).

---

### Task 0: Preflight worktree + baseline (P0.5)

**Files:** none (command-only)

**Step 1: Create a P0.5 worktree**

Run: `git -C opencode-zh-build/opencode_src worktree add ../opencode_src-p0_5 -b feature/opencode-p0_5`

Expected: New worktree directory created.

**Step 2: Verify clean status**

Run: `git -C opencode-zh-build/opencode_src-p0_5 status -sb`  
Expected: Clean working tree.

**Step 3: Install dependencies (only if baseline tests fail due to missing packages)**

If `bun test` fails with errors like `Cannot find package '<name>'` and the repo does not have a usable `node_modules/` in the worktree, install deps at the workspace root.

Important (Codex sandbox note):
- In this environment, Bun may be **blocked from writing to** `~/.bun`, even if `TMPDIR` is writable.
- Use `--cache-dir` pointing inside the worktree to avoid using the home cache.

Run:
- `cd opencode-zh-build/opencode_src-p0_5 && bun install --cache-dir ./.bun-cache`

If you hit install backend filesystem restrictions, retry:
- `cd opencode-zh-build/opencode_src-p0_5 && bun install --cache-dir ./.bun-cache --backend=copyfile`

Expected: Install succeeds and writes caches under `./.bun-cache`.

**Step 4: Run P0 smoke tests (baseline must be green before changes)**

Run:
- `cd opencode-zh-build/opencode_src-p0_5/packages/opencode && bun test test/tool/bash.test.ts`
- `cd opencode-zh-build/opencode_src-p0_5/packages/opencode && bun test test/sandbox/runner.test.ts`
- `cd opencode-zh-build/opencode_src-p0_5/packages/opencode && bun test test/evidence/evidence-writer.test.ts`
- `cd opencode-zh-build/opencode_src-p0_5/packages/opencode && bun test test/protocol/evidence-contract.test.ts`

Expected: PASS

---

### Task 1: Canonical JSON writer (deterministic, minified) for evidence outputs

**Files:**
- Create: `packages/opencode/src/util/stable-json.ts`
- Test: `packages/opencode/test/util/stable-json.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test"
import { stableJson } from "../../src/util/stable-json"

describe("util.stable-json", () => {
  test("stableJson sorts keys recursively and is deterministic", () => {
    const a = { b: 1, a: { d: 1, c: 2 } }
    const b = { a: { c: 2, d: 1 }, b: 1 }
    expect(stableJson(a)).toBe(stableJson(b))
    expect(stableJson(a)).toBe('{"a":{"c":2,"d":1},"b":1}')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd opencode-zh-build/opencode_src-p0_5/packages/opencode && bun test test/util/stable-json.test.ts`  
Expected: FAIL (module not found)

**Step 3: Implement minimal `stableJson()`**

Implementation requirements:
- Accept `unknown` and return a JSON string.
- Sort object keys lexicographically at every level.
- Preserve array order as-is.
- Output must be minified (no whitespace/newlines).
- Reject non-JSON values (`NaN`, `Infinity`, `BigInt`, functions, symbols).

**Step 4: Run test to verify it passes**

Run: `cd opencode-zh-build/opencode_src-p0_5/packages/opencode && bun test test/util/stable-json.test.ts`  
Expected: PASS

**Step 5: Commit**

```bash
git add packages/opencode/src/util/stable-json.ts packages/opencode/test/util/stable-json.test.ts
git commit -m "feat(util): add stable json stringify [AI:GPT-5.2]"
```

---

### Task 2: Add `pack.md` view renderer (Pointers-not-Paste compliant)

**Files:**
- Create: `packages/opencode/src/evidence/pack-view.ts`
- Test: `packages/opencode/test/evidence/pack-view.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test"
import { renderEvidencePackViewMarkdown } from "../../src/evidence/pack-view"

describe("evidence.pack-view", () => {
  test("renders a short view with pointers", () => {
    const md = renderEvidencePackViewMarkdown({
      sessionId: "session_test",
      packId: "EP-session_test",
      enforcement: "soft",
      backend: "soft",
      pointers: [
        { kind: "event-log", path: ".opencode/evidence/session_test/events.jsonl", sha256: "a".repeat(64) },
        { kind: "stdout", path: ".opencode/artifacts/session_test/stdout.txt", sha256: "b".repeat(64) },
      ],
    })
    expect(md).toContain("# Evidence Pack")
    expect(md).toContain("session_test")
    expect(md).toContain("backend: soft")
    expect(md).toContain(".opencode/evidence/session_test/events.jsonl")
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd opencode-zh-build/opencode_src-p0_5/packages/opencode && bun test test/evidence/pack-view.test.ts`  
Expected: FAIL (module not found)

**Step 3: Implement minimal renderer**

Requirements:
- Output is small and readable; avoid pasting stdout/stderr bodies.
- Include: sessionId, packId, generatedAtUtc, backend/enforcement, and a bullet list of pointers (path + sha256).
- Keep stable headings so humans can grep (do not over-format).

**Step 4: Run test to verify it passes**

Run: `cd opencode-zh-build/opencode_src-p0_5/packages/opencode && bun test test/evidence/pack-view.test.ts`  
Expected: PASS

**Step 5: Commit**

```bash
git add packages/opencode/src/evidence/pack-view.ts packages/opencode/test/evidence/pack-view.test.ts
git commit -m "feat(evidence): add pack.md view renderer [AI:GPT-5.2]"
```

---

### Task 3: EvidenceWriter writes canonical `pack.json` + `pack.md`, and records backend/enforcement

**Files:**
- Modify: `packages/opencode/src/evidence/writer.ts`
- Modify: `packages/opencode/src/protocol/evidence-pack.ts`
- Test: `packages/opencode/test/evidence/evidence-writer.test.ts`

**Step 1: Extend failing test coverage**

Add assertions to `packages/opencode/test/evidence/evidence-writer.test.ts`:
- `pack.json` exists and is minified (no trailing newline; no indentation).
- `pack.md` exists.
- `pack.environment.execution.backend` and `.enforcement` are present after pack write.

Suggested additional assertions snippet:

```ts
const evidenceDir = path.join(Instance.worktree, ".opencode", "evidence", "session_test")
const packJsonPath = path.join(evidenceDir, "pack.json")
const packMdPath = path.join(evidenceDir, "pack.md")

expect(await Bun.file(packJsonPath).exists()).toBe(true)
expect(await Bun.file(packMdPath).exists()).toBe(true)

const packText = await Bun.file(packJsonPath).text()
expect(packText.includes("\n")).toBe(false)
const pack = JSON.parse(packText) as unknown
expect((pack as any).environment.execution.enforcement).toBe("soft")
```

**Step 2: Run test to verify it fails**

Run: `cd opencode-zh-build/opencode_src-p0_5/packages/opencode && bun test test/evidence/evidence-writer.test.ts`  
Expected: FAIL

**Step 3: Implement EvidenceWriter upgrades**

Implementation requirements:
- Add `backend/enforcement` support:
  - Update `EvidencePack` schema already has optional `backend/enforcement` under `environment.execution` (verify and keep).
  - Update `EvidenceWriter.pack(...)` signature to accept:
    - `handoff: string`
    - `execution?: { id: string; kind: string; backend: "soft" | "hard"; enforcement: "soft" | "hard" }`
- Make `events.jsonl` the SSOT input for pack generation:
  - `EvidenceWriter.pack()` must read and parse `events.jsonl` from disk (each line via `EventV1.parse`) rather than relying only on in-memory `events`.
- Write outputs using `stableJson()`:
  - `pack.json` and `manifest.json` must be written in canonical minified form for hashing.
- Write `pack.md`:
  - Use `renderEvidencePackViewMarkdown(...)` with pointers derived from manifest entries (at least: events.jsonl, stdout, stderr when present).
- Ensure manifest registers:
  - `pack.json` (`kind: evidence-pack`)
  - `pack.md` (`kind: evidence-view`)
  - and keeps existing entries (event-log, stdout, stderr, etc.)

**Step 4: Run test to verify it passes**

Run: `cd opencode-zh-build/opencode_src-p0_5/packages/opencode && bun test test/evidence/evidence-writer.test.ts`  
Expected: PASS

**Step 5: Commit**

```bash
git add packages/opencode/src/evidence/writer.ts packages/opencode/src/protocol/evidence-pack.ts packages/opencode/test/evidence/evidence-writer.test.ts
git commit -m "feat(evidence): write pack.md + canonical pack.json [AI:GPT-5.2]"
```

---

### Task 4: SandboxRunner finalizes evidence per run + records backend/enforcement explicitly

**Files:**
- Modify: `packages/opencode/src/sandbox/runner.ts`
- Test: `packages/opencode/test/sandbox/runner.test.ts`

**Step 1: Update tests (failing first)**

In `packages/opencode/test/sandbox/runner.test.ts`, add assertions:
- After `SandboxRunner.run(...)`, `pack.json` and `pack.md` exist under `.opencode/evidence/<sessionId>/`.
- `events.jsonl` contains a backend-selection event.

Example assertion snippet:

```ts
const evidenceDir = path.join(Instance.worktree, ".opencode", "evidence", "session_test")
expect(await Bun.file(path.join(evidenceDir, "pack.json")).exists()).toBe(true)
expect(await Bun.file(path.join(evidenceDir, "pack.md")).exists()).toBe(true)

const eventsText = await Bun.file(path.join(evidenceDir, "events.jsonl")).text()
expect(eventsText).toContain("sandbox.backend_selected")
```

**Step 2: Run test to verify it fails**

Run: `cd opencode-zh-build/opencode_src-p0_5/packages/opencode && bun test test/sandbox/runner.test.ts`  
Expected: FAIL

**Step 3: Implement runner finalize + explicit transparency**

Implementation requirements:
- Before spawn, emit an explicit event:
  - `type: "sandbox.backend_selected"` (dotted; valid by `EventV1`)
  - `actor: "sandbox:runner"`
  - `data` includes `backend`, `enforcement`, `network.mode`, `workdirMode`, and key capability paths (redacted if needed).
- After completion:
  - Call `writer.pack({ handoff: <short>, execution: { kind, id, backend, enforcement } })` so `pack.json` + `pack.md` exist per run.
- Best-effort reliability:
  - Evidence writing errors should not erase the command result: if `writer.pack()` fails, runner should still return the execution result and include a `metadata` field (or `result.evidence` field) indicating evidence finalization failed.
  - Keep existing behavior for “spawn error still emits completion event” (do not regress).

**Step 4: Run test to verify it passes**

Run: `cd opencode-zh-build/opencode_src-p0_5/packages/opencode && bun test test/sandbox/runner.test.ts`  
Expected: PASS

**Step 5: Commit**

```bash
git add packages/opencode/src/sandbox/runner.ts packages/opencode/test/sandbox/runner.test.ts
git commit -m "feat(sandbox): finalize evidence pack per run [AI:GPT-5.2]"
```

---

### Task 5: BashTool enforces Pointers-not-Paste for large outputs (keep small outputs inline)

**Files:**
- Modify: `packages/opencode/src/tool/bash.ts`
- Test: `packages/opencode/test/tool/bash.test.ts`

**Step 1: Add failing test for large output**

Add a new test case in `packages/opencode/test/tool/bash.test.ts`:
- Run a command that prints > ~100KB (portable approach: `python3 -c ...` if available, else `bun -e ...`).
- Assert:
  - `result.output` does **not** contain the full repeated payload.
  - `result.output` includes a pointer block (paths to stdout/stderr artifacts).
  - stdout artifact path exists on disk.

**Step 2: Run test to verify it fails**

Run: `cd opencode-zh-build/opencode_src-p0_5/packages/opencode && bun test test/tool/bash.test.ts`  
Expected: FAIL

**Step 3: Implement pointerized output behavior**

Implementation requirements:
- Define a clear threshold constant in BashTool (P0.5): e.g. `MAX_INLINE_OUTPUT_BYTES`.
- Behavior:
  - If combined stdout+stderr <= threshold: keep current behavior (inline output).
  - If > threshold:
    - `result.output` must be a short message + pointers only (paths + sha256).
    - `metadata.output` must be short as well (preview, not full).
- Pointers should reference the artifacts produced by `SandboxRunner`:
  - stdout: `run.stdoutArtifactPath` + sha256 from `run.producedArtifacts`.
  - stderr: `run.stderrArtifactPath` + sha256 from `run.producedArtifacts`.

**Step 4: Run test to verify it passes**

Run: `cd opencode-zh-build/opencode_src-p0_5/packages/opencode && bun test test/tool/bash.test.ts`  
Expected: PASS

**Step 5: Commit**

```bash
git add packages/opencode/src/tool/bash.ts packages/opencode/test/tool/bash.test.ts
git commit -m "feat(tool): pointerize large bash outputs [AI:GPT-5.2]"
```

---

### Task 6: P0.5 verification pass (must be green before P1 v2)

**Files:** none (command-only)

**Step 1: Run focused suite**

Run:
`cd opencode-zh-build/opencode_src-p0_5/packages/opencode && bun test test/protocol/evidence-contract.test.ts test/evidence/evidence-writer.test.ts test/sandbox/runner.test.ts test/tool/bash.test.ts`

Expected: PASS

**Step 2: Run typecheck**

Run: `cd opencode-zh-build/opencode_src-p0_5/packages/opencode && bun run typecheck`  
Expected: PASS

**Step 3: Ready for P1**

After this plan completes, proceed with:
- `opencode-zh-build/opencode_src/docs/plans/2026-01-28-opencode-sandbox-context-p1-implementation-plan.v2.md`
