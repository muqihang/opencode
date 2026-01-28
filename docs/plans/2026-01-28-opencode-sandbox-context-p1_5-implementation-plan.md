# OpenCode Sandbox + Evidence Pack P1.5 Implementation Plan (Close P0/P1 Gates)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver P1.5 “收口门禁（P2 前强制 Gate）” so P0/P1 are *actually* complete and stable under parallelism: evidence failures are auditable, approvals are single-shot, provenance is complete, isolated worktrees produce patch artifacts, and evidence can be safely exported.

**Architecture:** Extend the existing EvidenceWriter/SandboxRunner pipeline with (1) explicit `evidence.write_failed` events and failure artifacts, (2) enriched `pack.json` provenance (os/runtime/repo/workdir/capability summary), (3) git patch artifacts for isolated workdirs, (4) an exec-policy evaluation artifact for explainability, and (5) a safe `opencode evidence export` CLI command with path/symlink allowlist enforcement.

**Tech Stack:** TypeScript, Bun, Zod 4, git worktree, existing `EvidenceWriter`, `SandboxRunner`, `BashTool`, `PermissionNext`, `Instance`, `Filesystem`.

---

## Status Note (what exists after P0/P0.5/P1)

This plan assumes you already have:
- `event/1.0`, `evidence-pack/1.0`, `evidence-manifest/1.0`, `evidence-micro-pack/1.0` Zod schemas + contract tests
- `EvidenceWriter` writing `.opencode/evidence/<sessionId>/{events.jsonl,manifest.json,pack.json,pack.md}`
- `SandboxRunner` writing stdout/stderr artifacts and finalizing `pack.json`/`pack.md`
- `BashTool` pointerizing large outputs, and `PythonTool` + micro-pack + pointer tag in `TaskTool`

P1.5 focuses on the remaining “hard invariants” called out in the design doc:
- `events: evidence.write_failed` on evidence write/register failures
- “one final approval per tool run” (merge the reasons into one prompt)
- “explainable boundary” via `execpolicy.eval.json` artifact
- “worktree change-set is a first-class artifact” (patch/diff) for isolated workdirs
- minimal `opencode evidence export` with path/symlink allowlist enforcement

---

### Task 0: Preflight worktree + baseline (required)

**Files:** none (command-only)

**Step 1: Create a P1.5 worktree**

Run: `git -C opencode-zh-build/opencode_src worktree add ../opencode_src-p1_5 -b feature/opencode-p1_5`
Expected: New worktree directory `opencode-zh-build/opencode_src-p1_5/` created.

**Step 2: Verify clean status**

Run: `git -C opencode-zh-build/opencode_src-p1_5 status -sb`
Expected: clean.

**Step 3: Baseline tests must be green before changes**

Run:
- `cd opencode-zh-build/opencode_src-p1_5/packages/opencode && bun test test/protocol/event-contract.test.ts`
- `cd opencode-zh-build/opencode_src-p1_5/packages/opencode && bun test test/evidence/evidence-writer.test.ts test/evidence/protocol-violation.test.ts`
- `cd opencode-zh-build/opencode_src-p1_5/packages/opencode && bun test test/sandbox/runner.test.ts test/tool/bash.test.ts`

Expected: PASS (python-related tests may skip if `python3` missing).

---

### Task 1: `evidence.write_failed` event on evidence failures (no silent evidence loss)

**Files:**
- Modify: `packages/opencode/src/evidence/writer.ts`
- Test: `packages/opencode/test/evidence/evidence-write-failed.test.ts`

**Step 1: Write the failing test**

Create `packages/opencode/test/evidence/evidence-write-failed.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import path from "path"
import { EvidenceWriter } from "../../src/evidence/writer"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { EventV1 } from "../../src/protocol/event"

describe("evidence.write_failed", () => {
  test("emits evidence.write_failed when artifact path is rejected", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const writer = await EvidenceWriter.open({ sessionId: "fail_evt" })
        await expect(
          writer.artifact({
            kind: "test",
            path: "../escape.txt",
            data: "nope",
          }),
        ).rejects.toThrow()

        const eventsPath = path.join(
          Instance.worktree,
          ".opencode",
          "evidence",
          "fail_evt",
          "events.jsonl",
        )
        const text = await Bun.file(eventsPath).text()
        const lines = text
          .split("\\n")
          .map((l) => l.trim())
          .filter(Boolean)
          .map((l) => EventV1.parse(JSON.parse(l)).type)

        expect(lines).toContain("evidence.write_failed")
      },
    })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd opencode-zh-build/opencode_src-p1_5/packages/opencode && bun test test/evidence/evidence-write-failed.test.ts`
Expected: FAIL (no `evidence.write_failed` event yet).

**Step 3: Implement minimal `evidence.write_failed` emission**

In `packages/opencode/src/evidence/writer.ts`:
- When `artifact(...)` fails due to path traversal / symlink / outside-base:
  - Write a *safe* error artifact under `errors/` in the session artifacts directory (this must never use the user-supplied path).
  - Append a valid `event/1.0` line:
    - `type: "evidence.write_failed"`
    - `actor: "evidence:writer"`
    - `summary: "artifact rejected"` (no raw paths outside base)
    - `data` includes: `kind`, `requested_path` (relative string only), and `error_artifact` pointer
  - Re-throw the original error.
- Keep existing behavior that rejected artifacts do **not** appear in `manifest.json`.

**Step 4: Run test to verify it passes**

Run: `cd opencode-zh-build/opencode_src-p1_5/packages/opencode && bun test test/evidence/evidence-write-failed.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/opencode/src/evidence/writer.ts packages/opencode/test/evidence/evidence-write-failed.test.ts
git commit -m "feat(evidence): emit evidence.write_failed on writer failures [AI:GPT-5]"
```

---

### Task 2: Enrich `pack.json` provenance (os/runtime/repo/workdir/capability summary)

**Files:**
- Modify: `packages/opencode/src/protocol/evidence-pack.ts`
- Modify: `packages/opencode/src/evidence/writer.ts`
- Modify: `packages/opencode/src/sandbox/runner.ts`
- Test: `packages/opencode/test/evidence/pack-provenance.test.ts`
- Test: `packages/opencode/test/protocol/evidence-contract.test.ts`

**Step 1: Write the failing test**

Create `packages/opencode/test/evidence/pack-provenance.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { SandboxRunner } from "../../src/sandbox/runner"
import { EvidencePack } from "../../src/protocol/evidence-pack"

describe("evidence.pack provenance", () => {
  test("pack.json records os/runtime/repo metadata", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await SandboxRunner.run({
          sessionId: "prov",
          toolName: "bash",
          command: "echo ok",
          cwd: Instance.worktree,
          capability: {
            readonlyPaths: [Instance.worktree],
            writePaths: [path.join(Instance.worktree, ".opencode")],
            exportPaths: [],
            network: { mode: "deny_all" },
            workdirMode: "isolated",
          },
          limits: { timeoutMs: 5000 },
        })

        const packPath = path.join(
          Instance.worktree,
          ".opencode",
          "evidence",
          "prov",
          "pack.json",
        )
        const data = JSON.parse(await Bun.file(packPath).text()) as unknown
        const pack = EvidencePack.parse(data)

        expect(pack.environment.os).toBeDefined()
        expect(pack.environment.runtime).toBeDefined()
        expect(pack.environment.repo).toBeDefined()
        expect(pack.environment.repo?.commit).toBeDefined()
        expect(pack.environment.repo?.dirty).toBeDefined()
        expect(typeof pack.environment.repo?.dirty).toBe("boolean")
      },
    })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd opencode-zh-build/opencode_src-p1_5/packages/opencode && bun test test/evidence/pack-provenance.test.ts`
Expected: FAIL (environment fields missing).

**Step 3: Implement minimal provenance capture**

Implementation guidance:
- Update the `evidence-pack/1.0` protocol schema in `packages/opencode/src/protocol/evidence-pack.ts` so the new provenance fields are actually representable:
  - `environment.runtime` should be a structured object (recommended: `{ node?: string; bun?: string }`) rather than an untyped record.
  - `environment.repo` must be structured so `dirty` can be a boolean (recommended: `{ root?: string; worktree?: string; commit: string; dirty: boolean }`).
  - Keep it additive and forward-compatible (do not remove existing fields).
- Extend `packages/opencode/test/protocol/evidence-contract.test.ts` with an additional fixture that includes `environment.runtime` + `environment.repo` and asserts it parses and remains `.strict()`.
- Capture provenance at the **runner** level (it knows `cwd`, `capability`, `limits`, `backend/enforcement`):
  - OS: `process.platform`, `process.arch`, and optionally `os.release()`
  - Runtime: `process.version` (node), and Bun version (`Bun.version` if available)
  - Repo (best-effort):
    - `commit`: `git rev-parse HEAD` (in `cwd`)
    - `dirty`: `git status --porcelain` non-empty
    - `root`: `git rev-parse --show-toplevel` (optional)
    - If not a git repo: omit `repo`
- Pass a *minimal* structured object into `EvidenceWriter.pack(...)`, and write it into `pack.environment`.
- Keep `stableJson()` canonical writes for `pack.json`.

**Step 4: Run test to verify it passes**

Run: `cd opencode-zh-build/opencode_src-p1_5/packages/opencode && bun test test/evidence/pack-provenance.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/opencode/src/protocol/evidence-pack.ts packages/opencode/src/evidence/writer.ts packages/opencode/src/sandbox/runner.ts packages/opencode/test/evidence/pack-provenance.test.ts packages/opencode/test/protocol/evidence-contract.test.ts
git commit -m "feat(evidence): enrich pack provenance fields [AI:GPT-5]"
```

---

### Task 3: Isolated workdir change-set as artifact (`git diff` patch) + micro-pack carries pointer

**Files:**
- Create: `packages/opencode/src/worktree/changes.ts`
- Modify: `packages/opencode/src/sandbox/runner.ts`
- Test: `packages/opencode/test/worktree/changes-artifact.test.ts`

**Step 1: Write the failing test**

Create `packages/opencode/test/worktree/changes-artifact.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { SandboxRunner } from "../../src/sandbox/runner"
import { EvidenceManifest } from "../../src/protocol/evidence-manifest"

describe("worktree change-set artifact", () => {
  test("runner registers a patch artifact for isolated git workdir", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Make the repo dirty without relying on any shell-specific commands.
        await Bun.write(path.join(Instance.worktree, "hello.txt"), "hi")

        await SandboxRunner.run({
          sessionId: "patchy",
          toolName: "bash",
          command: "echo ok",
          cwd: Instance.worktree,
          capability: {
            readonlyPaths: [Instance.worktree],
            writePaths: [Instance.worktree, path.join(Instance.worktree, ".opencode")],
            exportPaths: [],
            network: { mode: "deny_all" },
            workdirMode: "isolated",
          },
          limits: { timeoutMs: 10_000 },
        })

        const manifestPath = path.join(
          Instance.worktree,
          ".opencode",
          "evidence",
          "patchy",
          "manifest.json",
        )
        const manifest = EvidenceManifest.parse(JSON.parse(await Bun.file(manifestPath).text()))

        const patchEntry = manifest.entries.find((e) => e.kind === "worktree-patch")
        expect(patchEntry).toBeDefined()
        expect(patchEntry!.path).toContain(".opencode/artifacts/patchy")
      },
    })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd opencode-zh-build/opencode_src-p1_5/packages/opencode && bun test test/worktree/changes-artifact.test.ts`
Expected: FAIL (no patch artifact yet).

**Step 3: Implement minimal patch capture**

Implementation guidance:
- In `packages/opencode/src/worktree/changes.ts`, add a helper:
  - Input: `workdir` (cwd), `sessionId`, `writer`
  - Behavior (git-only, best-effort):
    - Compute `git diff --patch --no-color` (or `git diff`) from `workdir`
    - If diff is empty: skip writing patch artifact
    - If diff non-empty:
      - Write artifact `worktree/changes.patch` under session artifacts (stable path; referenced by tests and export)
      - Register manifest entry with `kind: "worktree-patch"`
      - Emit an event `worktree.patch_captured` referencing the artifact path/sha256
- Call this helper from `SandboxRunner.run(...)` after command completion, before final pack write.

**Step 4: Run test to verify it passes**

Run: `cd opencode-zh-build/opencode_src-p1_5/packages/opencode && bun test test/worktree/changes-artifact.test.ts`
Expected: PASS (or skip patch entry if diff is empty).

**Step 5: Commit**

```bash
git add packages/opencode/src/worktree/changes.ts packages/opencode/src/sandbox/runner.ts packages/opencode/test/worktree/changes-artifact.test.ts
git commit -m "feat(worktree): capture git patch artifact for isolated sessions [AI:GPT-5]"
```

---

### Task 4: Exec-policy evaluation artifact (`execpolicy.eval.json`) for explainable boundaries

**Files:**
- Create: `packages/opencode/src/sandbox/execpolicy.ts`
- Modify: `packages/opencode/src/sandbox/runner.ts`
- Test: `packages/opencode/test/sandbox/execpolicy-artifact.test.ts`

**Step 1: Write the failing test**

Create `packages/opencode/test/sandbox/execpolicy-artifact.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { SandboxRunner } from "../../src/sandbox/runner"
import { EvidenceManifest } from "../../src/protocol/evidence-manifest"

describe("sandbox execpolicy eval artifact", () => {
  test("runner writes execpolicy.eval.json and registers it in manifest", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await SandboxRunner.run({
          sessionId: "policy",
          toolName: "bash",
          command: "echo ok",
          cwd: Instance.worktree,
          capability: {
            readonlyPaths: [Instance.worktree],
            writePaths: [path.join(Instance.worktree, ".opencode")],
            exportPaths: [],
            network: { mode: "deny_all" },
            workdirMode: "isolated",
          },
          limits: { timeoutMs: 5000 },
        })

        const manifestPath = path.join(
          Instance.worktree,
          ".opencode",
          "evidence",
          "policy",
          "manifest.json",
        )
        const manifest = EvidenceManifest.parse(JSON.parse(await Bun.file(manifestPath).text()))
        const entry = manifest.entries.find((e) => e.kind === "execpolicy-eval")
        expect(entry).toBeDefined()
      },
    })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd opencode-zh-build/opencode_src-p1_5/packages/opencode && bun test test/sandbox/execpolicy-artifact.test.ts`
Expected: FAIL (no execpolicy artifact yet).

**Step 3: Implement minimal exec-policy evaluation**

In `packages/opencode/src/sandbox/execpolicy.ts`:
- Define a Zod schema for the *artifact payload* (not UI):
  - toolName, command/args, cwd, backend/enforcement, limits, capability (paths/network/workdirMode)
  - include a `notes` field that explicitly states: `enforcement=soft` means no OS-level file/network enforcement
- Provide `buildExecPolicyEval(req) -> object` that returns a JSON-serializable structure.

In `packages/opencode/src/sandbox/runner.ts`:
- Before spawning the process:
  - Write `execpolicy.eval.json` via `writer.artifact({ kind: "execpolicy-eval", path: "policy/execpolicy.eval.json", data: stableJson(...) })`
  - Emit `event/1.0` with `type: "policy.exec_evaluated"` referencing the artifact

**Step 4: Run test to verify it passes**

Run: `cd opencode-zh-build/opencode_src-p1_5/packages/opencode && bun test test/sandbox/execpolicy-artifact.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/opencode/src/sandbox/execpolicy.ts packages/opencode/src/sandbox/runner.ts packages/opencode/test/sandbox/execpolicy-artifact.test.ts
git commit -m "feat(sandbox): add execpolicy eval artifact for explainability [AI:GPT-5]"
```

---

### Task 4.1: Pack view (`pack.md`) must point to execpolicy + patch artifacts (human-greppable)

**Files:**
- Modify: `packages/opencode/src/evidence/writer.ts`
- Test: `packages/opencode/test/evidence/pack-view-pointers.test.ts`

**Step 1: Write the failing test**

Create `packages/opencode/test/evidence/pack-view-pointers.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { SandboxRunner } from "../../src/sandbox/runner"

describe("evidence.pack view pointers", () => {
  test("pack.md includes pointers for execpolicy-eval and worktree-patch", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Make the repo dirty so patch capture triggers.
        await Bun.write(path.join(Instance.worktree, "hello.txt"), "hi")

        await SandboxRunner.run({
          sessionId: "view_ptr",
          toolName: "bash",
          command: "echo ok",
          cwd: Instance.worktree,
          capability: {
            readonlyPaths: [Instance.worktree],
            writePaths: [Instance.worktree, path.join(Instance.worktree, ".opencode")],
            exportPaths: [],
            network: { mode: "deny_all" },
            workdirMode: "isolated",
          },
          limits: { timeoutMs: 5000 },
        })

        const mdPath = path.join(
          Instance.worktree,
          ".opencode",
          "evidence",
          "view_ptr",
          "pack.md",
        )
        const md = await Bun.file(mdPath).text()
        expect(md).toContain(".opencode/artifacts/view_ptr/policy/execpolicy.eval.json")
        expect(md).toContain(".opencode/artifacts/view_ptr/worktree/changes.patch")
      },
    })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd opencode-zh-build/opencode_src-p1_5/packages/opencode && bun test test/evidence/pack-view-pointers.test.ts`
Expected: FAIL (pack view currently only points to stdout/stderr/events).

**Step 3: Implement pointer selection in `EvidenceWriter.pack()`**

In `packages/opencode/src/evidence/writer.ts`:
- When building pointer list for `pack.md`, include the new “explainability” artifacts:
  - `execpolicy-eval`
  - `worktree-patch`
  - Keep existing: `event-log`, `stdout`, `stderr`
- Keep `pack.md` small: pointers only, never embed raw stdout/stderr bodies.

**Step 4: Run test to verify it passes**

Run: `cd opencode-zh-build/opencode_src-p1_5/packages/opencode && bun test test/evidence/pack-view-pointers.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/opencode/src/evidence/writer.ts packages/opencode/test/evidence/pack-view-pointers.test.ts
git commit -m "feat(evidence): include policy+patch pointers in pack.md view [AI:GPT-5]"
```

---

### Task 5: BashTool approval consolidation (max 1 approval prompt per run)

**Files:**
- Modify: `packages/opencode/src/tool/bash.ts`
- Test: `packages/opencode/test/tool/bash-approval-merge.test.ts`

**Step 1: Write the failing test**

Create `packages/opencode/test/tool/bash-approval-merge.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { BashTool } from "../../src/tool/bash"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("tool.bash approval consolidation", () => {
  test("asks at most once per execution", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await BashTool.init()
        const calls: any[] = []
        const ctx = {
          sessionID: "perm_once",
          messageID: "",
          callID: "",
          agent: "build",
          abort: AbortSignal.any([]),
          metadata: () => {},
          ask: async (req: any) => calls.push(req),
        }
        await tool.execute(
          // This should trigger BOTH:
          // - external directory detection (realpath /tmp)
          // - bash command pattern detection
          { command: "cat /tmp", description: "Read temp dir (permission merge)" },
          ctx,
        )
        expect(calls.length).toBe(1)
        expect(calls[0].permission).toBe("bash")
        expect(calls[0].metadata).toHaveProperty("external_directories")
        expect(calls[0].metadata).toHaveProperty("bash_patterns")
      },
    })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd opencode-zh-build/opencode_src-p1_5/packages/opencode && bun test test/tool/bash-approval-merge.test.ts`
Expected: FAIL (current BashTool may call `ctx.ask` multiple times).

**Step 3: Implement minimal consolidation**

Implementation guidance (pragmatic P1.5):
- Keep enforcing **deny** decisions for external directories and bash patterns.
- Merge “ask” reasons into a single `ctx.ask` call:
  - Use `permission: "bash"` (keep existing config compatibility)
  - Put all reasons into `metadata`:
    - `external_directories`: external directories detected (safe + normalized)
    - `bash_patterns`: command patterns detected
    - network policy + workdirMode + timeout
- Do *not* introduce new permission types in P1.5 unless necessary; keep it minimal and compatible.

**Step 4: Run test to verify it passes**

Run: `cd opencode-zh-build/opencode_src-p1_5/packages/opencode && bun test test/tool/bash-approval-merge.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/opencode/src/tool/bash.ts packages/opencode/test/tool/bash-approval-merge.test.ts
git commit -m "feat(tool): consolidate bash approvals to single prompt [AI:GPT-5]"
```

---

### Task 6: `opencode evidence export` (safe allowlist + no symlinks) + export events

**Files:**
- Create: `packages/opencode/src/evidence/export.ts`
- Create: `packages/opencode/src/cli/cmd/evidence.ts`
- Modify: `packages/opencode/src/index.ts`
- Test: `packages/opencode/test/evidence/evidence-export.test.ts`

**Step 1: Write the failing test**

Create `packages/opencode/test/evidence/evidence-export.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { SandboxRunner } from "../../src/sandbox/runner"
import { exportEvidence } from "../../src/evidence/export"

describe("evidence export", () => {
  test("exports allowlisted evidence + safe artifacts and verifies sha256", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Make the repo dirty so the exported bundle has a patch artifact too.
        await Bun.write(path.join(Instance.worktree, "hello.txt"), "hi")

        await SandboxRunner.run({
          sessionId: "exp",
          toolName: "bash",
          command: "echo ok",
          cwd: Instance.worktree,
          capability: {
            readonlyPaths: [Instance.worktree],
            writePaths: [path.join(Instance.worktree, ".opencode")],
            exportPaths: [],
            network: { mode: "deny_all" },
            workdirMode: "isolated",
          },
          limits: { timeoutMs: 5000 },
        })

        const outDir = path.join(tmp.path, "exported", "exp")
        await exportEvidence({
          sessionId: "exp",
          outDir,
        })

        expect(await Bun.file(path.join(outDir, "pack.json")).exists()).toBe(true)
        expect(await Bun.file(path.join(outDir, "pack.md")).exists()).toBe(true)
        expect(await Bun.file(path.join(outDir, "manifest.json")).exists()).toBe(true)
        expect(await Bun.file(path.join(outDir, "events.jsonl")).exists()).toBe(true)
        // "Safe-by-default" export includes explainability artifacts but should not require raw stdout/stderr.
        expect(
          await Bun.file(path.join(outDir, "artifacts", "policy", "execpolicy.eval.json")).exists(),
        ).toBe(true)
        expect(
          await Bun.file(path.join(outDir, "artifacts", "worktree", "changes.patch")).exists(),
        ).toBe(true)

        // Safety: ensure no symlinks were created in output.
        const stat = await fs.lstat(outDir)
        expect(stat.isSymbolicLink()).toBe(false)
      },
    })
  })

  test("rejects export when a manifest entry sha256 does not match", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await SandboxRunner.run({
          sessionId: "tamper",
          toolName: "bash",
          command: "echo ok",
          cwd: Instance.worktree,
          capability: {
            readonlyPaths: [Instance.worktree],
            writePaths: [path.join(Instance.worktree, ".opencode")],
            exportPaths: [],
            network: { mode: "deny_all" },
            workdirMode: "isolated",
          },
          limits: { timeoutMs: 5000 },
        })

        // Tamper with pack.json AFTER manifest was written by the runner.
        const packPath = path.join(
          Instance.worktree,
          ".opencode",
          "evidence",
          "tamper",
          "pack.json",
        )
        await Bun.write(packPath, "tampered")

        const outDir = path.join(tmp.path, "exported", "tamper")
        await expect(exportEvidence({ sessionId: "tamper", outDir })).rejects.toThrow()
      },
    })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd opencode-zh-build/opencode_src-p1_5/packages/opencode && bun test test/evidence/evidence-export.test.ts`
Expected: FAIL (export module missing).

**Step 3: Implement `exportEvidence(...)`**

In `packages/opencode/src/evidence/export.ts`:
- Input:
  - `sessionId`
  - `outDir` (absolute or relative; resolve it)
- Behavior:
  - Read `.opencode/evidence/<sessionId>/manifest.json` and parse via `EvidenceManifest`
  - Allowlist exported entries to:
    - Evidence directory: `.opencode/evidence/<sessionId>/...`
    - "Safe artifacts" directory (default allowlist):
      - `worktree-patch` (e.g. `.opencode/artifacts/<sessionId>/worktree/changes.patch`)
      - `execpolicy-eval` (e.g. `.opencode/artifacts/<sessionId>/policy/execpolicy.eval.json`)
    - (Optional future flag) raw artifacts like stdout/stderr can be added later, but P1.5 defaults to safe export to avoid secret leakage.
  - For each allowlisted entry:
    - resolve source path under `Instance.worktree` (or `Instance.directory` when worktree is `/`)
    - reject symlinks anywhere in the path chain (`lstat`)
    - recompute sha256 and verify it matches `manifest.entries[].sha256` (tamper detection)
    - copy into `outDir/` preserving relative layout **within the allowlisted prefixes**
      - evidence files land at `outDir/{pack.json,pack.md,manifest.json,events.jsonl,...}`
      - safe artifacts land at `outDir/artifacts/<kind-specific-subdir>/...`
  - Best-effort write export events to the session evidence:
    - `evidence.export_started`
    - `evidence.export_completed` (include counts)
    - On failure: `evidence.export_failed` + failure artifact

**Step 4: Wire CLI command**

Create `packages/opencode/src/cli/cmd/evidence.ts` implementing:
- `opencode evidence export <sessionId> --out <dir>`
- Use `bootstrap(process.cwd(), ...)`
- Call `exportEvidence(...)`

Register in `packages/opencode/src/index.ts`:
- `import { EvidenceCommand } from "./cli/cmd/evidence"`
- `.command(EvidenceCommand)`

**Step 5: Run test to verify it passes**

Run: `cd opencode-zh-build/opencode_src-p1_5/packages/opencode && bun test test/evidence/evidence-export.test.ts`
Expected: PASS.

**Step 6: Commit**

```bash
git add packages/opencode/src/evidence/export.ts packages/opencode/src/cli/cmd/evidence.ts packages/opencode/src/index.ts packages/opencode/test/evidence/evidence-export.test.ts
git commit -m "feat(cli): add evidence export command (safe allowlist) [AI:GPT-5]"
```

---

### Task 7: P1.5 verification pass (must be green before starting P2)

**Files:** none (command-only)

**Step 1: Run focused suite**

Run:
`cd opencode-zh-build/opencode_src-p1_5/packages/opencode && bun test test/evidence/evidence-write-failed.test.ts test/evidence/pack-provenance.test.ts test/worktree/changes-artifact.test.ts test/sandbox/execpolicy-artifact.test.ts test/evidence/pack-view-pointers.test.ts test/tool/bash-approval-merge.test.ts test/evidence/evidence-export.test.ts`

Expected: PASS.

**Step 2: Run typecheck**

Run: `cd opencode-zh-build/opencode_src-p1_5/packages/opencode && bun run typecheck`
Expected: PASS.

**Step 3: Spot-check artifact layout**

Run (manual QA):
- run a bash tool call that changes a file
- confirm:
  - `.opencode/artifacts/<sessionId>/worktree/changes.patch` exists when dirty
  - `.opencode/evidence/<sessionId>/pack.json` contains `environment.repo.commit` and `environment.repo.dirty`
  - `opencode evidence export <sessionId> --out ./evidence/<sessionId>/` exports without symlinks

---

## Execution Handoff

Plan complete and saved to `docs/plans/2026-01-28-opencode-sandbox-context-p1_5-implementation-plan.md`.

Two execution options:

1. **Subagent-Driven (this session)** - dispatch a fresh subagent per task, review between tasks, fast iteration  
2. **Parallel Session (separate)** - open a new session with executing-plans, batch execution with checkpoints

Which approach?
