# OpenCode Sandbox + Evidence Pack P0 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver P0 “soft sandbox + evidence chain + git worktree isolation” so BashTool runs through SandboxRunner, outputs are artifactized, and Evidence Pack v1 is generated per session.

**Architecture:** Add Evidence Pack protocols and a writer that produces `pack.json`, `manifest.json`, and `events.jsonl` under `.opencode/evidence/<sessionId>`. Implement a `SandboxRunner` with a `soft` backend that executes commands, writes stdout/stderr as artifacts, and records events; integrate it into BashTool. Use `git worktree` as the default isolated workdir for sessions.

**Tech Stack:** TypeScript, Bun, Zod 4, git worktree, existing `Storage`, `Global.Path`, `Instance`, `Worktree` modules.

---

## Design Coverage Index (P0 items, no omissions)

This plan covers the P0-relevant requirements scattered across:
- `docs/plans/2026-01-25-opencode-sandbox-context-design.md`

Covered design sections (P0 scope):
- Section 13: Execution Sandbox (soft backend `SandboxRunner`)
- Section 15 + Section 8.1: Evidence Pack v1 (`pack.json` + `manifest.json` + `events.jsonl`) as SSOT
- Section 14: BashTool runs through SandboxRunner; stdout/stderr are artifactized and referenced by pointers
- Section 2.2: `isolated` workdir baseline via `git worktree` (`.opencode/worktrees/<sessionId>/`)
- Section 17.1 (optional): minimal `config show --effective` for explainability/debuggability

### Task 1: Evidence Pack protocol schemas + contract tests

**Files:**
- Create: `packages/opencode/src/protocol/evidence-pack.ts`
- Create: `packages/opencode/src/protocol/evidence-manifest.ts`
- Test: `packages/opencode/test/protocol/evidence-contract.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test"
import { EvidencePack } from "../../src/protocol/evidence-pack"
import { EvidenceManifest } from "../../src/protocol/evidence-manifest"

describe("protocol.evidence.contracts", () => {
  test("evidence-pack/1.0 fixture parses and is strict", () => {
    const fixture = {
      specVersion: "evidence-pack/1.0",
      packId: "EP-2026-01-28-session-01ARZ3NDEKTSV4RRFFQ69G5FAV",
      task: { title: "User request", intent: "P0 sandbox", successCriteria: ["evidence written"] },
      environment: { execution: { kind: "sandbox", id: "sandbox:soft" } },
      claims: [],
      artifacts: [],
      checks: [],
      events: [],
      capsule: { handoff: "ok", pointers: [], openQuestions: [] },
      risks: [],
      rollback: { strategy: "none", steps: [] },
    } as const
    expect(EvidencePack.parse(fixture)).toMatchObject(fixture)
    expect(() => EvidencePack.parse({ ...fixture, extra: "nope" })).toThrow()
  })

  test("evidence-manifest/1.0 fixture parses and is strict", () => {
    const fixture = {
      specVersion: "evidence-manifest/1.0",
      packId: "EP-2026-01-28-session-01ARZ3NDEKTSV4RRFFQ69G5FAV",
      generatedAtUtc: "2026-01-28T00:00:00.000Z",
      entries: [{ path: ".opencode/evidence/x/pack.json", sha256: "a".repeat(64), kind: "evidence-pack" }],
    } as const
    expect(EvidenceManifest.parse(fixture)).toMatchObject(fixture)
    expect(() => EvidenceManifest.parse({ ...fixture, extra: "nope" })).toThrow()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd opencode-zh-build/opencode_src/packages/opencode && bun test test/protocol/evidence-contract.test.ts`  
Expected: FAIL (modules not found)

**Step 3: Write minimal schemas**

```ts
export const EvidencePack = z.object({ ... }).strict()
export const EvidenceManifest = z.object({ ... }).strict()
```

**Step 4: Run test to verify it passes**

Run: `cd opencode-zh-build/opencode_src/packages/opencode && bun test test/protocol/evidence-contract.test.ts`  
Expected: PASS

**Step 5: Commit**

```bash
git add packages/opencode/src/protocol/evidence-pack.ts packages/opencode/src/protocol/evidence-manifest.ts packages/opencode/test/protocol/evidence-contract.test.ts
git commit -m "feat(protocol): add evidence pack schemas [AI:GPT-5.2]"
```

---

### Task 2: Evidence writer + events.jsonl (atomic write + manifest SSOT)

**Files:**
- Create: `packages/opencode/src/evidence/index.ts`
- Create: `packages/opencode/src/evidence/writer.ts`
- Create: `packages/opencode/src/evidence/events.ts`
- Test: `packages/opencode/test/evidence/evidence-writer.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test"
import { EvidenceWriter } from "../../src/evidence/writer"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("evidence.writer", () => {
  test("writes pack + manifest + events", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const writer = await EvidenceWriter.open({ sessionId: "session_test" })
        await writer.event({
          specVersion: "event/1.0",
          ts: "2026-01-28T00:00:00.000Z",
          sessionId: "session_test",
          severity: "info",
          actor: "tool:bash",
          type: "tool.started",
          summary: "started",
          redaction: { applied: true, policyVersion: "v1" },
        })
        const pack = await writer.pack({ handoff: "ok" })
        const manifest = await writer.manifest()
        expect(pack.specVersion).toBe("evidence-pack/1.0")
        expect(manifest.entries.length).toBeGreaterThan(0)
      },
    })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd opencode-zh-build/opencode_src/packages/opencode && bun test test/evidence/evidence-writer.test.ts`  
Expected: FAIL (writer not implemented)

**Step 3: Write minimal EvidenceWriter**

```ts
export const EvidenceWriter = {
  open: async (input) => ({ event, pack, manifest, artifact }),
}
```

Implementation requirements:
- Base dir: `.opencode/evidence/<sessionId>/` under `Instance.worktree`
- Artifacts dir: `.opencode/artifacts/<sessionId>/`
- Atomic write: `tmp → sha256 → rename → update manifest`
- `events.jsonl` append must validate `EventV1`
- `manifest.json` is SSOT (every artifact registered)
- Reject symlinks in writer/export (use `lstat`)

**Add these assertions to the test:**
- `events.jsonl` contains multiple lines and each line parses as `EventV1`
- Atomic behavior: failed write does **not** add a manifest entry
- Symlink path is rejected (use a symlink artifact to assert failure)

**Step 4: Run test to verify it passes**

Run: `cd opencode-zh-build/opencode_src/packages/opencode && bun test test/evidence/evidence-writer.test.ts`  
Expected: PASS

**Step 5: Commit**

```bash
git add packages/opencode/src/evidence packages/opencode/test/evidence/evidence-writer.test.ts
git commit -m "feat(evidence): add writer and events jsonl [AI:GPT-5.2]"
```

---

### Task 3: SandboxRunner (soft backend) + runner contract tests

**Files:**
- Create: `packages/opencode/src/sandbox/index.ts`
- Create: `packages/opencode/src/sandbox/runner.ts`
- Create: `packages/opencode/src/sandbox/soft.ts`
- Test: `packages/opencode/test/sandbox/runner.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test"
import { SandboxRunner } from "../../src/sandbox/runner"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("sandbox.runner", () => {
  test("soft backend executes and writes artifacts", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await SandboxRunner.run({
          sessionId: "session_test",
          toolName: "bash",
          command: "echo ok",
          capability: { readonlyPaths: [], writePaths: [tmp.path], exportPaths: [], network: { mode: "deny_all" }, workdirMode: "isolated" },
          limits: { timeoutMs: 5000 },
        })
        expect(result.backend).toBe("soft")
        expect(result.enforcement).toBe("soft")
        expect(result.stdoutArtifactPath.length).toBeGreaterThan(0)
      },
    })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd opencode-zh-build/opencode_src/packages/opencode && bun test test/sandbox/runner.test.ts`  
Expected: FAIL (runner not implemented)

**Step 3: Implement soft backend**

```ts
export const SandboxRunner = { run: async (req) => ... }
```

Implementation requirements:
- Validate inputs with Zod
- Execute command with `Shell.acceptable()` and `Shell.killTree`
- Write stdout/stderr as artifacts via EvidenceWriter
- Record `tool.started` and `tool.completed` events
- Return `backend="soft"`, `enforcement="soft"` for transparency

**Add these assertions to the test:**
- `backend === "soft"` and `enforcement === "soft"`
- stdout/stderr artifacts exist on disk and are listed in manifest

**Step 4: Run test to verify it passes**

Run: `cd opencode-zh-build/opencode_src/packages/opencode && bun test test/sandbox/runner.test.ts`  
Expected: PASS

**Step 5: Commit**

```bash
git add packages/opencode/src/sandbox packages/opencode/test/sandbox/runner.test.ts
git commit -m "feat(sandbox): add soft runner [AI:GPT-5.2]"
```

---

### Task 4: Session workdir isolation via git worktree

**Files:**
- Modify: `packages/opencode/src/worktree/index.ts`
- Create: `packages/opencode/src/worktree/session.ts`
- Test: `packages/opencode/test/worktree/session-worktree.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test"
import { SessionWorktree } from "../../src/worktree/session"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("worktree.session", () => {
  test("creates isolated worktree under .opencode/worktrees/<sessionId>", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const workdir = await SessionWorktree.ensure({ sessionId: "session_test" })
        expect(workdir).toContain(".opencode/worktrees/session_test")
      },
    })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd opencode-zh-build/opencode_src/packages/opencode && bun test test/worktree/session-worktree.test.ts`  
Expected: FAIL (SessionWorktree not implemented)

**Step 3: Implement SessionWorktree**

```ts
export const SessionWorktree = {
  ensure: async ({ sessionId }) => { ... }
}
```

Implementation requirements:
- Use `git worktree add` via existing `Worktree` utilities
- Root path: `.opencode/worktrees/<sessionId>`
- If already exists, reuse and return
- Record creation event (optional in P0)

**Note:** reuse existing `Worktree` module helpers where possible to avoid duplicate logic.

**Step 4: Run test to verify it passes**

Run: `cd opencode-zh-build/opencode_src/packages/opencode && bun test test/worktree/session-worktree.test.ts`  
Expected: PASS

**Step 5: Commit**

```bash
git add packages/opencode/src/worktree packages/opencode/test/worktree/session-worktree.test.ts
git commit -m "feat(worktree): add session worktree helper [AI:GPT-5.2]"
```

---

### Task 5: BashTool -> SandboxRunner integration

**Files:**
- Modify: `packages/opencode/src/tool/bash.ts`
- Test: `packages/opencode/test/tool/bash.test.ts`

**Step 1: Write the failing test**

Add assertions to confirm SandboxRunner execution:

```ts
expect(result.metadata.exit).toBe(0)
expect(result.metadata.output).toContain("test")
expect(result.metadata).toHaveProperty("artifact")
```

**Step 2: Run test to verify it fails**

Run: `cd opencode-zh-build/opencode_src/packages/opencode && bun test test/tool/bash.test.ts`  
Expected: FAIL (metadata artifact not present)

**Step 3: Update BashTool**

```ts
const run = await SandboxRunner.run({ ... })
return { title, metadata: { output, exit, artifact: run.stdoutArtifactPath }, output }
```

Requirements:
- Keep PermissionNext checks intact
- Use SessionWorktree for `isolated` workdir (P0 default)
- Pass stdout/stderr artifacts as metadata and/or attachments
- Respect existing truncation rules (Truncate handles final output)

**Add a smoke-level assertion** that `events.jsonl` contains `tool.started` and `tool.completed` for the bash run.

**Step 4: Run test to verify it passes**

Run: `cd opencode-zh-build/opencode_src/packages/opencode && bun test test/tool/bash.test.ts`  
Expected: PASS

**Step 5: Commit**

```bash
git add packages/opencode/src/tool/bash.ts packages/opencode/test/tool/bash.test.ts
git commit -m "feat(tool): route bash through sandbox runner [AI:GPT-5.2]"
```

---

### Task 6: Minimal `config show --effective` (optional P0 stretch)

**Files:**
- Create: `packages/opencode/src/cli/cmd/config.ts`
- Modify: `packages/opencode/src/cli/index.ts` (or command registry)
- Test: `packages/opencode/test/cli/config-show.test.ts` (optional)

**Step 1: Add command**

```ts
command: "config",
describe: "show resolved configuration",
```

**Step 2: Wire command**

Use `Config.get()` and print JSON to stdout. (Source attribution can be added in P1.)

**Step 3: Smoke test**

Run: `cd opencode-zh-build/opencode_src/packages/opencode && bun run src/index.ts config`  
Expected: JSON printed

**Step 4: Commit (if implemented)**

```bash
git add packages/opencode/src/cli/cmd/config.ts packages/opencode/src/cli/index.ts
git commit -m "feat(cli): add config show command [AI:GPT-5.2]"
```

---

## P0 Exit Criteria (must pass)

- BashTool executes via SandboxRunner `soft` backend
- `events.jsonl`, `pack.json`, `manifest.json` generated under `.opencode/evidence/<sessionId>/`
- stdout/stderr saved as artifacts under `.opencode/artifacts/<sessionId>/`
- Protocol contract tests for evidence schemas passing
- Session isolated workdir uses git worktree

**Decision note (consistency):**
- If `config show --effective` is treated as P0 “must-have” in design, move Task 6 to required; otherwise mark it explicitly as “stretch” in both plan and design.

---

## Suggested P1–P4 Sequencing (high-level)

- **P1:** PythonTool in sandbox, micro-pack for subagents, worktree cleanup + undo
- **P2:** Shared workdir locking, auto-merge into main workdir, conflict artifacts
- **P3:** Context pack builder + cache keys + compaction integration
- **P4:** Hard sandbox backends + OTel + policy governance

---

## Execution Handoff

Plan complete and saved to `docs/plans/2026-01-28-opencode-sandbox-context-p0-implementation-plan.md`.

Two execution options:

1. **Subagent-Driven (this session)** - I dispatch a fresh subagent per task, review between tasks, fast iteration  
2. **Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
