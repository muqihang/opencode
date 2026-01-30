# OpenCode Sandbox + Evidence Pack P1 Implementation Plan (v2)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver P1 “PythonTool + 子会话沙盒一致性 + micro-pack” so Python scripts run via `SandboxRunner`, child sessions emit micro evidence packs, and the parent session gets pointers (not pasted content).

**Key Fixes vs v1 plan:** This v2 reorders tasks to match P0 reality and strict-config constraints, adds a missing `SandboxRunner args` prerequisite, removes Create/Modify contradictions, and tightens SSOT + `protocol.violation` event testing so execution won’t block on day 1.

**Architecture (P1):**
- `PythonTool` executes **only allowlisted scripts** (built-in + optional project scripts) via `ScriptRegistry`.
- All Python execution goes through `SandboxRunner` using **`command + args`** (no fragile string concatenation).
- Outputs are written as artifacts; evidence is recorded as `events.jsonl` + `manifest.json`, and **micro-pack** (`micro-pack.json`) is emitted for child sessions.
- Parent session output includes a `<micro_pack>` pointer block with an explicit merge policy.

**Tech Stack:** TypeScript, Bun, Zod 4, existing `SandboxRunner`, existing `EvidenceWriter`, existing Tool/Session/Permission modules.

---

## Design Coverage Index (P1 items, no omissions)

This plan covers the P1-relevant requirements scattered across:
- `docs/plans/2026-01-25-opencode-sandbox-context-design.md`

Covered design sections (P1 scope):
- Section 14 + Section 14.1: PythonTool runs in the sandbox via an allowlisted ScriptRegistry (no arbitrary Python)
- Section 2.1: child sessions also run tools in their own sandbox and produce their own evidence
- Section 15: micro-pack schema + emission + parent pointer blocks (pointers-not-paste)
- Section 8.1: `protocol.violation` event ensures evidence never silently breaks even on invalid inputs
- Section 17: strict config schema to prevent “unknown config fields” drift

Explicitly not covered (tracked for later phases):
- Section 13.2.1 (P1 baseline): “资料工作台” baseline is not implemented by this plan; P2 Task 11 must verify/implement missing baseline before P3.

## Status Note（P0 已完成后的关键前置假设）

本计划假设 P0 已落地并且存在以下能力（如同步上游后变化，请先校对再执行）：

- `packages/opencode/src/sandbox/runner.ts` 存在，且会写 `tool.started/tool.completed` events 与 stdout/stderr artifacts。
- `packages/opencode/src/evidence/writer.ts` 存在，且会写 `events.jsonl`、`manifest.json`、`pack.json`。
- `Config.Info` 是 `.strict()`：任何测试使用 `tmpdir({ config: ... })` 写入的 `opencode.json` 若包含未知字段会 parse 失败，因此 **必须先加 `config.python` schema** 才能安全在测试里引用 `python` 配置。
- 当前 repo 可能还没有 `packages/opencode/src/tool/python.ts` 与 `packages/opencode/src/python/*`（P1 将创建）。

---

### Task 0: Preflight worktree + baseline

**Files:** none (command-only)

**Step 1: Create a P1 worktree**

Run: `git -C opencode-zh-build/opencode_src worktree add ../opencode_src-p1 -b feature/opencode-p1`

Expected: New worktree directory created.

**Step 2: Verify clean status**

Run: `git -C opencode-zh-build/opencode_src-p1 status -sb`  
Expected: Clean working tree.

**Step 3: Enter worktree**

Run: `cd opencode-zh-build/opencode_src-p1`

---

### Task 0.1: Sanity check P0 baseline（防止“计划与现状”脱节）

**Files:** none (command-only)

**Step 1: Run existing P0 smoke tests**

Run:
- `cd opencode-zh-build/opencode_src-p1/packages/opencode && bun test test/tool/bash.test.ts`
- `cd opencode-zh-build/opencode_src-p1/packages/opencode && bun test test/protocol/event-contract.test.ts`

Expected: PASS

**Step 2: Pre-check before starting Task 4 (PythonTool)**

目的：在进入 PythonTool 开发前，尽早发现 runner 行为变化是否破坏了 P0（尤其是 bash/runner 既有测试），避免后面才回滚/返工。

Run:
- `cd opencode-zh-build/opencode_src-p1/packages/opencode && bun test test/sandbox/runner.test.ts`
- `cd opencode-zh-build/opencode_src-p1/packages/opencode && bun test test/tool/bash.test.ts`

Expected:
- `runner.test.ts` 全绿（包含 abort/spawn error 等用例）
- `bash.test.ts` 全绿（包含 evidence events.jsonl 写入断言）

---

### Task 1: Add `config.python` (strict schema 前置)

**Files:**
- Modify: `packages/opencode/src/config/config.ts`
- Test: `packages/opencode/test/config/python-config.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test"
import { Config } from "../../src/config/config"

describe("config.python", () => {
  test("loads python config defaults", async () => {
    const cfg = await Config.get()
    expect(cfg.python?.allowProjectScripts ?? false).toBe(false)
    expect(cfg.python?.allowNetwork ?? false).toBe(false)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd opencode-zh-build/opencode_src-p1/packages/opencode && bun test test/config/python-config.test.ts`  
Expected: FAIL (schema missing)

**Step 3: Implement schema**

Add a `python` block in `Config.Info` with:
- `allowProjectScripts: boolean` (default `false`)
- `allowNetwork: boolean` (default `false`)
- `allowedDomains: string[]` (optional; used when `allowNetwork: true` and allowlist mode desired)
- `pythonPath: string` (optional; default `"python3"`)

**Step 4: Run test to verify it passes**

Run: `cd opencode-zh-build/opencode_src-p1/packages/opencode && bun test test/config/python-config.test.ts`  
Expected: PASS

**Step 5: Commit**

```bash
git add packages/opencode/src/config/config.ts packages/opencode/test/config/python-config.test.ts
git commit -m "feat(config): add python tool config [AI:GPT-5.2]"
```

---

### Task 2: Fix `SandboxRunner` to support `args` (PythonTool prerequisite)

**Files:**
- Modify: `packages/opencode/src/sandbox/runner.ts`
- Test: `packages/opencode/test/sandbox/runner-args.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { SandboxRunner } from "../../src/sandbox/runner"

describe("sandbox.runner args", () => {
  test("passes args to spawned process (no quoting required)", async () => {
    const python = Bun.which("python3")
    if (!python) return

    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const run = await SandboxRunner.run({
          sessionId: "runner_args",
          toolName: "test",
          command: python,
          args: ["-c", "print('ok')"],
          capability: {
            readonlyPaths: [Instance.worktree],
            writePaths: [path.join(Instance.worktree, ".opencode")],
            exportPaths: [],
            network: { mode: "deny_all" },
            workdirMode: "isolated",
          },
          limits: { timeoutMs: 10_000 },
        })
        expect(run.exitCode).toBe(0)
        expect(run.stdout).toContain("ok")
      },
    })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd opencode-zh-build/opencode_src-p1/packages/opencode && bun test test/sandbox/runner-args.test.ts`  
Expected: FAIL (args ignored / process errors)

**Step 3: Implement args support**

Implementation requirements:
- If `args` is provided:
  - Call `spawn(command, args, ...)` (do not concatenate args into a string).
  - Prefer `shell: false` in this path to avoid shell quoting/parsing issues.
- If `args` is not provided: keep existing behavior for Bash-style command strings.

**Step 4: Run test to verify it passes**

Run: `cd opencode-zh-build/opencode_src-p1/packages/opencode && bun test test/sandbox/runner-args.test.ts`  
Expected: PASS (or skipped if python3 missing)

**Step 5: Commit**

```bash
git add packages/opencode/src/sandbox/runner.ts packages/opencode/test/sandbox/runner-args.test.ts
git commit -m "fix(sandbox): support args for runner spawn [AI:GPT-5.2]"
```

---

### Task 3: ScriptRegistry + scripts manifest（SSOT）+ path safety

**Files:**
- Create: `packages/opencode/src/python/scripts/summarize-json.py`
- Create: `packages/opencode/src/python/scripts.manifest.json`
- Create: `packages/opencode/src/python/registry.ts`
- Test: `packages/opencode/test/python/manifest.test.ts`
- Test: `packages/opencode/test/python/registry.test.ts`

**Step 1: Write failing tests**

`manifest.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { ScriptRegistry } from "../../src/python/registry"

describe("python.scripts manifest", () => {
  test("manifest includes summarize-json with sha256", async () => {
    const manifest = await ScriptRegistry.manifest()
    const entry = manifest.find((x) => x.id === "summarize-json")
    expect(entry).toBeDefined()
    expect(entry!.sha256.length).toBe(64)
  })
})
```

`registry.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { ScriptRegistry } from "../../src/python/registry"

describe("python.registry", () => {
  test("resolves built-in script id", async () => {
    await Instance.provide({
      directory: path.join(__dirname, "../.."),
      fn: async () => {
        const script = await ScriptRegistry.resolve({ scriptId: "summarize-json" })
        expect(script.id).toBe("summarize-json")
        expect(script.sha256.length).toBe(64)
        expect(script.path.endsWith("summarize-json.py")).toBe(true)
      },
    })
  })

  test("project scripts require explicit config flag", async () => {
    await using tmp = await tmpdir({ config: { python: { allowProjectScripts: false } } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await fs.mkdir(path.join(tmp.path, ".opencode", "scripts"), { recursive: true })
        await Bun.write(path.join(tmp.path, ".opencode", "scripts", "hello.py"), "print('hi')")
        await expect(ScriptRegistry.resolve({ scriptId: "project:hello" })).rejects.toThrow("allowProjectScripts")
      },
    })
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `cd opencode-zh-build/opencode_src-p1/packages/opencode && bun test test/python/manifest.test.ts test/python/registry.test.ts`  
Expected: FAIL

**Step 3: Implement manifest as SSOT**

Implementation requirements:
- `scripts.manifest.json` is the **single source of truth** for built-in scripts: entries are `{ id, path, sha256 }`.
- `ScriptRegistry.manifest()` reads and validates manifest (Zod) and returns the list.
- `ScriptRegistry.resolve({ scriptId })`:
  - Built-in id: lookup in manifest, resolve path under `packages/opencode/src/python/scripts/`.
  - `project:<name>`: resolve to `.opencode/scripts/<name>.py` only when `config.python.allowProjectScripts === true`.
  - Always compute sha256 of resolved script contents.
  - For built-ins: computed sha256 must match manifest sha256; mismatch is a hard error (audit guarantee).

**Path safety requirements (must-have):**
- Disallow traversal (`..`) and absolute paths for project scripts.
- Disallow symlinks in `.opencode/scripts` resolution chain.
- Ensure resolved path stays within its allowed base dir.

**Step 4: Run tests**

Run: `cd opencode-zh-build/opencode_src-p1/packages/opencode && bun test test/python/manifest.test.ts test/python/registry.test.ts`  
Expected: PASS

**Step 5: Commit**

```bash
git add packages/opencode/src/python packages/opencode/test/python/manifest.test.ts packages/opencode/test/python/registry.test.ts
git commit -m "feat(python): add scripts manifest + registry [AI:GPT-5.2]"
```

---

### Task 4: PythonTool (SandboxRunner + permission merge) + registry wiring

**Files:**
- Create: `packages/opencode/src/tool/python.ts`
- Create: `packages/opencode/src/tool/python.txt`
- Modify: `packages/opencode/src/tool/registry.ts`
- Test: `packages/opencode/test/tool/python.test.ts`
- Test: `packages/opencode/test/tool/python-permission.test.ts`

**Step 1: Write failing tests**

`python.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import path from "path"
import { PythonTool } from "../../src/tool/python"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { EventV1 } from "../../src/protocol/event"

const ctx = {
  sessionID: "python_test",
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  metadata: () => {},
  ask: async () => {},
}

describe("tool.python", () => {
  test("runs built-in script via sandbox", async () => {
    const python = Bun.which("python3")
    if (!python) return

    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await PythonTool.init()
        const result = await tool.execute(
          { script_id: "summarize-json", input_json: { ok: true }, description: "Summarize JSON" },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output_artifact).toBeDefined()

        const eventsPath = path.join(Instance.worktree, ".opencode", "evidence", ctx.sessionID, "events.jsonl")
        const text = await Bun.file(eventsPath).text()
        const types = text
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => EventV1.parse(JSON.parse(line)).type)
        expect(types).toContain("tool.started")
        expect(types).toContain("tool.completed")
      },
    })
  })
})
```

`python-permission.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { PythonTool } from "../../src/tool/python"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import type { PermissionNext } from "../../src/permission/next"

const ctx = {
  sessionID: "perm",
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  metadata: () => {},
  ask: async () => {},
}

describe("tool.python permission", () => {
  test("asks once with merged capability metadata", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await PythonTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => requests.push(req),
        }
        await tool.execute(
          { script_id: "summarize-json", input_json: { ok: true }, description: "Summarize JSON" },
          testCtx,
        )
        expect(requests.length).toBe(1)
        expect(requests[0].permission).toBe("python")
        expect(requests[0].metadata).toHaveProperty("capability")
      },
    })
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `cd opencode-zh-build/opencode_src-p1/packages/opencode && bun test test/tool/python.test.ts test/tool/python-permission.test.ts`  
Expected: FAIL (tool missing)

**Step 3: Implement PythonTool**

Implementation requirements:
- Parameters:
  - `script_id: string`
  - `input_json?: record<string, unknown>` (write to artifact `python/input.json`)
  - `output_name?: string` (optional; default `output.json`)
  - `timeout?: number` (optional; default tool timeout)
  - `workdir?: string` (optional; default isolated session worktree when git)
  - `description: string`
- Resolve script via `ScriptRegistry.resolve`.
- Determine working directory (`cwd`) deterministically:
  - `const cwd = params.workdir ?? (Instance.project.vcs === "git" ? await SessionWorktree.ensure({ sessionId: ctx.sessionID }) : Instance.directory)`
  - Always pass `cwd` into `SandboxRunner.run({ cwd })` (do not rely on process cwd).
- Determine python executable:
  - `const cfg = await Config.get()`; use `cfg.python?.pythonPath ?? "python3"`.
- Determine network policy:
  - default: `deny_all`
  - if `cfg.python.allowNetwork === true`:
    - if `cfg.python.allowedDomains?.length` -> `allowlist`
    - else -> `full` (with a note field explaining no allowlist was configured)
- Execute via `SandboxRunner.run` using **args**:
  - `command: pythonPath`
  - `args: [scriptPath, "--input", inputPath, "--output", outputPath]`
- Artifactization requirements (P1 audit baseline):
  - Input JSON must be written under `.opencode/artifacts/<sessionId>/python/input.json` and registered in `manifest.json`.
  - Output JSON path must be under `.opencode/artifacts/<sessionId>/python/<output_name>` and registered in `manifest.json` after execution.
  - Do not paste full output content into `output`; return only a short preview or a pointer path (metadata) if needed.
- Evidence:
  - Emit a tool-level event (in addition to runner events) with `script_id`, `script_sha256`, `input_path`, `output_path`, `python_path`, `network_policy`.
- Permission merge:
  - One `ctx.ask` before execution:
    - `permission: "python"`
    - `metadata.capability` includes `cwd`, network policy, timeout, paths (readonly/write), and script metadata.
- Tool metadata:
  - include `exit`, `output_artifact` (path), `script_sha256`, `python_version_artifact?` (added in Task 4.1)

**Step 4: Register tool**

Add `PythonTool` to `packages/opencode/src/tool/registry.ts` near `BashTool`.

**Step 5: Run tests**

Run: `cd opencode-zh-build/opencode_src-p1/packages/opencode && bun test test/tool/python.test.ts test/tool/python-permission.test.ts`  
Expected: PASS (or skipped if python3 missing)

**Step 6: Commit**

```bash
git add packages/opencode/src/tool/python.ts packages/opencode/src/tool/python.txt packages/opencode/src/tool/registry.ts packages/opencode/test/tool/python.test.ts packages/opencode/test/tool/python-permission.test.ts
git commit -m "feat(tool): add python tool via sandbox runner [AI:GPT-5.2]"
```

---

### Task 4.1: Python env evidence（最小审计：python3 --version）

**Files:**
- Modify: `packages/opencode/src/tool/python.ts`
- Test: `packages/opencode/test/tool/python-env-evidence.test.ts`

**Step 1: Write failing test**

```ts
import { describe, expect, test } from "bun:test"
import path from "path"
import { PythonTool } from "../../src/tool/python"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("tool.python env evidence", () => {
  test("writes python version artifact", async () => {
    const python = Bun.which("python3")
    if (!python) return
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await PythonTool.init()
        const ctx = { sessionID: "env", messageID: "", callID: "", agent: "build", abort: AbortSignal.any([]), metadata: () => {}, ask: async () => {} }
        await tool.execute({ script_id: "summarize-json", input_json: { ok: true }, description: "Summarize JSON" }, ctx)
        const versionPath = path.join(Instance.worktree, ".opencode", "artifacts", "env", "python", "python-version.txt")
        const exists = await Bun.file(versionPath).exists()
        expect(exists).toBe(true)
      },
    })
  })
})
```

**Step 2: Run test**

Run: `cd opencode-zh-build/opencode_src-p1/packages/opencode && bun test test/tool/python-env-evidence.test.ts`  
Expected: FAIL

**Step 3: Implement env evidence**

- Run `python3 --version` (or configured python path), write to `.opencode/artifacts/<sessionId>/python/python-version.txt`.
- Emit an evidence event `tool.python.env` referencing the artifact path.
- If python executable is missing, record a risk (do not hard crash the whole session; still provide a usable error).

**Step 4: Run test**

Run: `cd opencode-zh-build/opencode_src-p1/packages/opencode && bun test test/tool/python-env-evidence.test.ts`  
Expected: PASS (or skipped if python3 missing)

**Step 5: Commit**

```bash
git add packages/opencode/src/tool/python.ts packages/opencode/test/tool/python-env-evidence.test.ts
git commit -m "feat(tool): add python env evidence [AI:GPT-5.2]"
```

---

### Task 5: Micro-pack protocol + writer support

**Files:**
- Create: `packages/opencode/src/protocol/evidence-micro-pack.ts`
- Modify: `packages/opencode/src/evidence/writer.ts`
- Test: `packages/opencode/test/protocol/evidence-micro-contract.test.ts`
- Test: `packages/opencode/test/evidence/micro-pack.test.ts`

**Step 1: Write failing protocol test**

```ts
import { describe, expect, test } from "bun:test"
import { EvidenceMicroPack } from "../../src/protocol/evidence-micro-pack"

describe("protocol.evidence.micro", () => {
  test("micro-pack/1.0 fixture parses and is strict", () => {
    const fixture = {
      specVersion: "evidence-micro-pack/1.0",
      packId: "MP-2026-01-28-session-01ARZ3NDEKTSV4RRFFQ69G5FAV",
      sessionId: "session_test",
      parentSessionId: "session_parent",
      generatedAtUtc: "2026-01-28T00:00:00.000Z",
      artifacts: [],
      claims: [],
      checks: [],
      events: [],
    } as const
    expect(EvidenceMicroPack.parse(fixture)).toMatchObject(fixture)
    expect(() => EvidenceMicroPack.parse({ ...fixture, extra: "nope" })).toThrow()
  })
})
```

**Step 2: Run test**

Run: `cd opencode-zh-build/opencode_src-p1/packages/opencode && bun test test/protocol/evidence-micro-contract.test.ts`  
Expected: FAIL

**Step 3: Implement schema**

- Strict Zod schema with `specVersion: "evidence-micro-pack/1.0"`.
- `events` must be an array of valid `EventV1` objects.

**Step 4: Add writer support + failing test**

Add `EvidenceWriter.microPack({ parentSessionId? })`:
- Reads `events.jsonl` from disk (SSOT) for the session.
- Uses current `manifest.entries` for artifacts.
- Writes `.opencode/evidence/<sessionId>/micro-pack.json`.
- Adds/updates manifest entry of kind `evidence-micro-pack`.

Test example:

```ts
import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { EvidenceWriter } from "../../src/evidence/writer"
import { tmpdir } from "../fixture/fixture"

describe("evidence.micro-pack", () => {
  test("writes micro-pack and registers manifest entry", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const writer = await EvidenceWriter.open({ sessionId: "child_session" })
        await writer.event({
          specVersion: "event/1.0",
          ts: "2026-01-28T00:00:00.000Z",
          sessionId: "child_session",
          severity: "info",
          actor: "tool:python",
          type: "tool.started",
          summary: "started",
          redaction: { applied: true, policyVersion: "v1" },
        })
        const micro = await writer.microPack({ parentSessionId: "parent_session" })
        expect(micro.specVersion).toBe("evidence-micro-pack/1.0")
        const manifest = await writer.manifest()
        expect(manifest.entries.some((e) => e.kind === "evidence-micro-pack")).toBe(true)
      },
    })
  })
})
```

**Step 5: Run tests**

Run: `cd opencode-zh-build/opencode_src-p1/packages/opencode && bun test test/protocol/evidence-micro-contract.test.ts test/evidence/micro-pack.test.ts`  
Expected: PASS

**Step 6: Commit**

```bash
git add packages/opencode/src/protocol/evidence-micro-pack.ts packages/opencode/src/evidence/writer.ts packages/opencode/test/protocol/evidence-micro-contract.test.ts packages/opencode/test/evidence/micro-pack.test.ts
git commit -m "feat(evidence): add micro-pack schema + writer [AI:GPT-5.2]"
```

---

### Task 6: Emit child micro-pack + parent pointer（with merge policy）

**Files:**
- Modify: `packages/opencode/src/tool/task.ts`
- Modify: `packages/opencode/src/session/message-v2.ts` (if needed)
- Test: `packages/opencode/test/tool/task-micro-pack.test.ts`
- Test: `packages/opencode/test/tool/task-micro-pack-policy.test.ts`

**Step 1: Write failing pointer-format test**

```ts
import { describe, expect, test } from "bun:test"
import { MessageV2 } from "../../src/session/message-v2"

describe("tool.task micro-pack", () => {
  test("task output includes micro-pack pointer tag", async () => {
    const output = MessageV2.renderMicroPackPointer?.(".opencode/evidence/child/micro-pack.json")
    expect(output).toContain("micro-pack.json")
  })
})
```

**Step 2: Write failing policy-tag test**

```ts
import { describe, expect, test } from "bun:test"
import { MessageV2 } from "../../src/session/message-v2"

describe("tool.task micro-pack policy", () => {
  test("micro-pack output includes merge_policy tag", async () => {
    const output = MessageV2.renderMicroPackPointer?.(".opencode/evidence/child/micro-pack.json")
    expect(output).toContain("merge_policy: micro-only")
  })
})
```

**Step 3: Run tests (expect FAIL)**

Run:
- `cd opencode-zh-build/opencode_src-p1/packages/opencode && bun test test/tool/task-micro-pack.test.ts`
- `cd opencode-zh-build/opencode_src-p1/packages/opencode && bun test test/tool/task-micro-pack-policy.test.ts`

Expected: FAIL (helper missing / policy missing)

**Step 4: Implement pointer helper + integration**

Implementation requirements:
- Add `MessageV2.renderMicroPackPointer(path: string)` (or equivalent) that renders:
  ```
  <micro_pack>
  path: .opencode/evidence/<childSessionId>/micro-pack.json
  merge_policy: micro-only
  </micro_pack>
  ```
- In `TaskTool`, after subagent completes:
  - open `EvidenceWriter` for the child session
  - call `writer.microPack({ parentSessionId: ctx.sessionID })`
  - append pointer block to parent output (do not paste micro-pack contents)
  - add an event `evidence.micro_pack_emitted` including `merge_policy: "micro-only"` and pointer path

**Step 5: Run tests (expect PASS)**

Run: `cd opencode-zh-build/opencode_src-p1/packages/opencode && bun test test/tool/task-micro-pack.test.ts test/tool/task-micro-pack-policy.test.ts`  
Expected: PASS

**Step 6: Manual QA (required)**

Run in CLI:
1) Start a session, run a subagent task that uses PythonTool.
2) Verify `.opencode/evidence/<childSessionId>/micro-pack.json` exists.
3) Verify parent output contains the `<micro_pack>` tag (with merge_policy).

**Step 7: Commit**

```bash
git add packages/opencode/src/tool/task.ts packages/opencode/src/session/message-v2.ts packages/opencode/test/tool/task-micro-pack.test.ts packages/opencode/test/tool/task-micro-pack-policy.test.ts
git commit -m "feat(session): emit micro-pack pointer for child sessions [AI:GPT-5.2]"
```

---

### Task 7: Python script contract（--input/--output）

**Files:**
- Modify: `packages/opencode/src/python/scripts/summarize-json.py`
- Test: `packages/opencode/test/python/script-contract.test.ts`

**Step 1: Write failing test**

```ts
import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import path from "path"

describe("python.script contract", () => {
  test("summarize-json consumes --input and --output", async () => {
    const python = Bun.which("python3")
    if (!python) return
    const script = path.join(__dirname, "../../src/python/scripts/summarize-json.py")
    const input = path.join(__dirname, "input.json")
    const output = path.join(__dirname, "output.json")
    await Bun.write(input, JSON.stringify({ ok: true }))
    await $`python3 ${script} --input ${input} --output ${output}`.quiet()
    const text = await Bun.file(output).text()
    const data = JSON.parse(text)
    expect(data).toHaveProperty("summary")
  })
})
```

**Step 2: Run test**

Run: `cd opencode-zh-build/opencode_src-p1/packages/opencode && bun test test/python/script-contract.test.ts`  
Expected: FAIL (script not implemented)

**Step 3: Implement script contract**

- `summarize-json.py` supports `--input` and `--output`.
- Output JSON includes at least `summary` and `keys`.

**Step 4: Run test**

Run: `cd opencode-zh-build/opencode_src-p1/packages/opencode && bun test test/python/script-contract.test.ts`  
Expected: PASS (or skipped if python3 missing)

**Step 5: Commit**

```bash
git add packages/opencode/src/python/scripts/summarize-json.py packages/opencode/test/python/script-contract.test.ts
git commit -m "test(python): add script contract [AI:GPT-5.2]"
```

---

### Task 8: `protocol.violation` event（invalid event input still leaves evidence）

**Files:**
- Modify: `packages/opencode/src/evidence/writer.ts`
- Test: `packages/opencode/test/evidence/protocol-violation.test.ts`

**Step 1: Write failing test**

```ts
import { describe, expect, test } from "bun:test"
import { EvidenceWriter } from "../../src/evidence/writer"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("evidence.protocol violation", () => {
  test("writes protocol.violation event on invalid event input", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const writer = await EvidenceWriter.open({ sessionId: "bad_pack" })
        await expect(writer.event({} as any)).rejects.toThrow()
        const eventsPath = `${Instance.worktree}/.opencode/evidence/bad_pack/events.jsonl`
        const text = await Bun.file(eventsPath).text()
        expect(text).toContain("protocol.violation")
      },
    })
  })
})
```

**Step 2: Run test**

Run: `cd opencode-zh-build/opencode_src-p1/packages/opencode && bun test test/evidence/protocol-violation.test.ts`  
Expected: FAIL

**Step 3: Implement minimal violation event**

When `EventV1.parse` fails inside `EvidenceWriter.event(...)`:
- Write an error artifact containing parse error summary + raw input (redaction as needed).
- Append a **valid** `event/1.0` to `events.jsonl` (must satisfy `EventV1`):
  - `actor`: use something like `"evidence:writer"` (must match `^[a-z][a-z0-9_-]*:[^\\s]+$`).
  - `type`: `"protocol.violation"` (must be dotted; `protocol_violation` is invalid by schema).
  - `redaction`: include `{ applied: true, policyVersion: "v1" }` (or current policy).
- Update manifest entries.
- Then re-throw (callers still fail, but audit trail exists).

**Step 4: Run test**

Run: `cd opencode-zh-build/opencode_src-p1/packages/opencode && bun test test/evidence/protocol-violation.test.ts`  
Expected: PASS

**Step 5: Commit**

```bash
git add packages/opencode/src/evidence/writer.ts packages/opencode/test/evidence/protocol-violation.test.ts
git commit -m "feat(evidence): add protocol violation events [AI:GPT-5.2]"
```

---

### Task 9: P1 verification pass

**Files:** none (command-only)

**Step 1: Run focused tests**

Run:
`cd opencode-zh-build/opencode_src-p1/packages/opencode && bun test test/config/python-config.test.ts test/sandbox/runner-args.test.ts test/python/manifest.test.ts test/python/registry.test.ts test/tool/python.test.ts test/tool/python-permission.test.ts test/tool/python-env-evidence.test.ts test/protocol/evidence-micro-contract.test.ts test/evidence/micro-pack.test.ts test/tool/task-micro-pack.test.ts test/tool/task-micro-pack-policy.test.ts test/python/script-contract.test.ts test/evidence/protocol-violation.test.ts`

Expected: PASS (python tests may skip if python3 missing)

**Step 2: Run typecheck**

Run: `cd opencode-zh-build/opencode_src-p1/packages/opencode && bun run typecheck`  
Expected: PASS

**Step 3: Commit bookkeeping**

Run: `git status -sb`  
Expected: clean or expected staged changes only.
