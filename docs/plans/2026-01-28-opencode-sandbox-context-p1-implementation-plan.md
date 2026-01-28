# OpenCode Sandbox + Evidence Pack P1 Implementation Plan

> **NOTE (2026-01-28):** This plan is superseded by the revised, execution-safe version:
> `opencode-zh-build/opencode_src/docs/plans/2026-01-28-opencode-sandbox-context-p1-implementation-plan.v2.md`
>
> Rationale: v2 fixes task ordering for strict config parsing, adds missing `SandboxRunner args` prerequisite, removes Create/Modify contradictions, and makes protocol_violation testing align with actual failure paths.

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver P1 “PythonTool + 子会话沙盒一致性 + micro-pack” so Python scripts run via SandboxRunner, child sessions emit micro evidence packs, and the main session gets pointers (not pasted content).

**Architecture:** Add a controlled PythonTool backed by a script registry (built-in scripts + optional project scripts). Execute all Python runs through `SandboxRunner`, record script metadata in evidence events, and write outputs as artifacts. Implement a micro-pack schema and writer that uses the session’s evidence log + manifest. After subagent completion, emit a micro-pack for the child session and surface a pointer in the parent output.

**Tech Stack:** TypeScript, Bun, Zod 4, SandboxRunner, EvidenceWriter, git worktree, existing Tool/Session/Permission modules.

---

## Addendum: P1 审计/协议/一致性补强（必须纳入执行）

本节为设计稿对 P1 的强约束补强，避免“能跑但不可审计/不可复盘”。

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

### Task 0.1: PythonTool 审批合并与能力审计（PermissionNext）

**Files:**
- Modify: `packages/opencode/src/tool/python.ts`
- Test: `packages/opencode/test/tool/python-permission.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test"
import { PythonTool } from "../../src/tool/python"
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
  test("asks once with merged reasons", async () => {
    const tool = await PythonTool.init()
    const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
    const testCtx = { ...ctx, ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => requests.push(req) }
    await tool.execute(
      { script_id: "summarize-json", input_json: { ok: true }, description: "Summarize JSON" },
      testCtx,
    )
    expect(requests.length).toBe(1)
    expect(requests[0].permission).toBe("python")
    expect(requests[0].metadata).toHaveProperty("capability")
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd opencode-zh-build/opencode_src-p1/packages/opencode && bun test test/tool/python-permission.test.ts`  
Expected: FAIL (permission handling missing)

**Step 3: Implement minimal permission ask**

- 在 PythonTool 执行前，合并路径/网络/脚本信息为一次 `ctx.ask`。
- `permission: "python"`，`metadata.capability` 包含 network/workdir/paths。

**Step 4: Run test to verify it passes**

Run: `cd opencode-zh-build/opencode_src-p1/packages/opencode && bun test test/tool/python-permission.test.ts`  
Expected: PASS

**Step 5: Commit**

```bash
git add packages/opencode/src/tool/python.ts packages/opencode/test/tool/python-permission.test.ts
git commit -m "feat(tool): add python permission merge [AI:GPT-5.2]"
```

---

### Task 1: Script registry (built-in + optional project scripts) + tests

**Files:**
- Create: `packages/opencode/src/python/scripts/summarize-json.py`
- Create: `packages/opencode/src/python/registry.ts`
- Test: `packages/opencode/test/python/registry.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test"
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
        await Bun.write(path.join(tmp.path, ".opencode/scripts/hello.py"), "print('hi')")
        await expect(
          ScriptRegistry.resolve({ scriptId: "project:hello" }),
        ).rejects.toThrow("allowProjectScripts")
      },
    })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd opencode-zh-build/opencode_src-p1/packages/opencode && bun test test/python/registry.test.ts`  
Expected: FAIL (registry not implemented)

**Step 3: Implement minimal registry**

```ts
export const ScriptRegistry = {
  async resolve(input: { scriptId: string }) {
    // "summarize-json" -> built-in script in packages/opencode/src/python/scripts/
    // "project:foo" -> .opencode/scripts/foo.py (only if config.python.allowProjectScripts)
  },
}
```

Implementation requirements:
- Built-in manifest is a small in-code map: `{ id, path }`.
- Resolve project scripts only when `config.python.allowProjectScripts === true`.
- Compute `sha256` from script contents.
- Error message must mention `allowProjectScripts` when blocked.

**Step 4: Run test to verify it passes**

Run: `cd opencode-zh-build/opencode_src-p1/packages/opencode && bun test test/python/registry.test.ts`  
Expected: PASS

**Step 5: Commit**

```bash
git add packages/opencode/src/python packages/opencode/test/python/registry.test.ts
git commit -m "feat(python): add script registry [AI:GPT-5.2]"
```

---

### Task 1.1: Scripts manifest（构建期可审计清单）

**Files:**
- Create: `packages/opencode/src/python/scripts.manifest.json`
- Modify: `packages/opencode/src/python/registry.ts`
- Test: `packages/opencode/test/python/manifest.test.ts`

**Step 1: Write the failing test**

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

**Step 2: Run test to verify it fails**

Run: `cd opencode-zh-build/opencode_src-p1/packages/opencode && bun test test/python/manifest.test.ts`  
Expected: FAIL (manifest missing)

**Step 3: Implement manifest support**

- `scripts.manifest.json` 以 `{ id, path, sha256 }` 形式保存内置脚本清单。
- `ScriptRegistry.manifest()` 读取并校验（Zod）。

**Step 4: Run test to verify it passes**

Run: `cd opencode-zh-build/opencode_src-p1/packages/opencode && bun test test/python/manifest.test.ts`  
Expected: PASS

**Step 5: Commit**

```bash
git add packages/opencode/src/python/scripts.manifest.json packages/opencode/src/python/registry.ts packages/opencode/test/python/manifest.test.ts
git commit -m "feat(python): add scripts manifest [AI:GPT-5.2]"
```

---

### Task 2: PythonTool (SandboxRunner) + tool registry + tests

**Files:**
- Create: `packages/opencode/src/tool/python.ts`
- Create: `packages/opencode/src/tool/python.txt`
- Modify: `packages/opencode/src/tool/registry.ts`
- Test: `packages/opencode/test/tool/python.test.ts`

**Step 1: Write the failing test**

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
          {
            script_id: "summarize-json",
            input_json: { ok: true },
            description: "Summarize JSON",
          },
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

**Step 2: Run test to verify it fails**

Run: `cd opencode-zh-build/opencode_src-p1/packages/opencode && bun test test/tool/python.test.ts`  
Expected: FAIL (tool not implemented)

**Step 3: Implement PythonTool**

```ts
export const PythonTool = Tool.define("python", async () => {
  return {
    description: DESCRIPTION,
    parameters: z.object({
      script_id: z.string().min(1),
      input_json: z.record(z.string(), z.unknown()).optional(),
      output_name: z.string().optional(),
      timeout: z.number().int().positive().optional(),
      workdir: z.string().optional(),
      description: z.string().min(1),
    }),
    async execute(params, ctx) { ... },
  }
})
```

Implementation requirements:
- Resolve script via `ScriptRegistry.resolve`.
- Write `input_json` to an artifact file if provided (e.g. `.opencode/artifacts/<sessionId>/python/input.json`).
- Choose output file path inside `.opencode/artifacts/<sessionId>/python/`.
- Execute `python3 <scriptPath> --input <inputPath> --output <outputPath>` via `SandboxRunner.run`.
- Default `network: deny_all`, `workdirMode: isolated` when git, else shared.
- Emit extra evidence event in PythonTool with `script_id`, `script_sha256`, `input_path`, `output_path`.
- Tool metadata must include `output_artifact` and `script_sha256`.

**Step 4: Register tool**

Add `PythonTool` to `ToolRegistry.all()` near `BashTool`.

**Step 5: Run test to verify it passes**

Run: `cd opencode-zh-build/opencode_src-p1/packages/opencode && bun test test/tool/python.test.ts`  
Expected: PASS (or skipped if python3 missing)

**Step 6: Commit**

```bash
git add packages/opencode/src/tool/python.ts packages/opencode/src/tool/python.txt packages/opencode/src/tool/registry.ts packages/opencode/test/tool/python.test.ts
git commit -m "feat(tool): add python tool via sandbox runner [AI:GPT-5.2]"
```

---

### Task 2.1: Python 运行环境与依赖证据（P1 最小审计）

**Files:**
- Modify: `packages/opencode/src/tool/python.ts`
- Test: `packages/opencode/test/tool/python-env-evidence.test.ts`

**Step 1: Write the failing test**

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
        const versionPath = path.join(Instance.worktree, ".opencode", "artifacts", "env", "python-version.txt")
        const exists = await Bun.file(versionPath).exists()
        expect(exists).toBe(true)
      },
    })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd opencode-zh-build/opencode_src-p1/packages/opencode && bun test test/tool/python-env-evidence.test.ts`  
Expected: FAIL (env artifact missing)

**Step 3: Implement minimal env evidence**

- 运行 `python3 --version`，写入 `.opencode/artifacts/<sessionId>/python/python-version.txt`。
- 记录 event `tool.python.env`（包含 version artifact path）。
- 若 python 不可用，写入风险项（risk: "python missing")。

**Step 4: Run test to verify it passes**

Run: `cd opencode-zh-build/opencode_src-p1/packages/opencode && bun test test/tool/python-env-evidence.test.ts`  
Expected: PASS (or skip if python3 missing)

**Step 5: Commit**

```bash
git add packages/opencode/src/tool/python.ts packages/opencode/test/tool/python-env-evidence.test.ts
git commit -m "feat(tool): add python env evidence [AI:GPT-5.2]"
```

---

### Task 3: PythonTool config surface (allowlist + project scripts)

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
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd opencode-zh-build/opencode_src-p1/packages/opencode && bun test test/config/python-config.test.ts`  
Expected: FAIL (schema missing)

**Step 3: Add config schema**

Add a `python` block in `Config.Info` with:
- `allowProjectScripts: boolean` (default `false`)
- `allowNetwork: boolean` (default `false`)
- `allowedDomains: string[]` (optional, allowlist)
- `pythonPath: string` (optional)

**Step 4: Run test to verify it passes**

Run: `cd opencode-zh-build/opencode_src-p1/packages/opencode && bun test test/config/python-config.test.ts`  
Expected: PASS

**Step 5: Commit**

```bash
git add packages/opencode/src/config/config.ts packages/opencode/test/config/python-config.test.ts
git commit -m "feat(config): add python tool config [AI:GPT-5.2]"
```

---

### Task 4: Micro-pack protocol + writer support + tests

**Files:**
- Create: `packages/opencode/src/protocol/evidence-micro-pack.ts`
- Modify: `packages/opencode/src/evidence/writer.ts`
- Test: `packages/opencode/test/protocol/evidence-micro-contract.test.ts`
- Test: `packages/opencode/test/evidence/micro-pack.test.ts`

**Step 1: Write the failing protocol test**

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

**Step 2: Run test to verify it fails**

Run: `cd opencode-zh-build/opencode_src-p1/packages/opencode && bun test test/protocol/evidence-micro-contract.test.ts`  
Expected: FAIL (schema missing)

**Step 3: Implement schema**

```ts
export const EvidenceMicroPack = z.object({
  specVersion: z.literal("evidence-micro-pack/1.0"),
  packId: z.string().min(1),
  sessionId: z.string().min(1),
  parentSessionId: z.string().min(1).optional(),
  generatedAtUtc: IsoDateTimeUtc,
  artifacts: z.array(Artifact),
  claims: z.array(Claim),
  checks: z.array(Check),
  events: z.array(EventV1),
}).strict()
```

**Step 4: Add writer support + test**

Test (failing first):

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

Implementation requirements:
- `microPack` reads `events.jsonl` and current manifest entries for `artifacts`.
- Writes `.opencode/evidence/<sessionId>/micro-pack.json`.
- Updates manifest with kind `evidence-micro-pack`.

**Step 5: Run tests to verify they pass**

Run:  
`cd opencode-zh-build/opencode_src-p1/packages/opencode && bun test test/protocol/evidence-micro-contract.test.ts test/evidence/micro-pack.test.ts`  
Expected: PASS

**Step 6: Commit**

```bash
git add packages/opencode/src/protocol/evidence-micro-pack.ts packages/opencode/src/evidence/writer.ts packages/opencode/test/protocol/evidence-micro-contract.test.ts packages/opencode/test/evidence/micro-pack.test.ts
git commit -m "feat(evidence): add micro-pack schema + writer [AI:GPT-5.2]"
```

---

### Task 4.1: micro-pack 合并策略的“指针化声明”

**Files:**
- Modify: `packages/opencode/src/tool/task.ts`
- Test: `packages/opencode/test/tool/task-micro-pack-policy.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test"
import { MessageV2 } from "../../src/session/message-v2"

describe("tool.task micro-pack policy", () => {
  test("micro-pack output includes policy tag", async () => {
    const output = MessageV2.renderMicroPackPointer?.(".opencode/evidence/child/micro-pack.json")
    expect(output).toContain("merge_policy")
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd opencode-zh-build/opencode_src-p1/packages/opencode && bun test test/tool/task-micro-pack-policy.test.ts`  
Expected: FAIL

**Step 3: Implement policy tag**

- 在 micro-pack 指针标签中追加 `merge_policy: micro-only`（P1 仅指针，不做合并）。
- 并写入 `events: micro_pack_emitted`，data 包含 policy 字段。

**Step 4: Run test to verify it passes**

Run: `cd opencode-zh-build/opencode_src-p1/packages/opencode && bun test test/tool/task-micro-pack-policy.test.ts`  
Expected: PASS

**Step 5: Commit**

```bash
git add packages/opencode/src/tool/task.ts packages/opencode/test/tool/task-micro-pack-policy.test.ts
git commit -m "feat(session): add micro-pack policy tag [AI:GPT-5.2]"
```

---

### Task 5: Child-session micro-pack emission + parent pointer

**Files:**
- Modify: `packages/opencode/src/tool/task.ts`
- (Optional) Modify: `packages/opencode/src/session/message-v2.ts` if metadata needs a new field
- Test: `packages/opencode/test/tool/task-micro-pack.test.ts`

**Step 1: Write the failing test (unit-level micro-pack pointer)**

```ts
import { describe, expect, test } from "bun:test"
import { MessageV2 } from "../../src/session/message-v2"

describe("tool.task micro-pack", () => {
  test("task output includes micro-pack pointer tag", async () => {
    // This is a shallow test that validates formatting behavior.
    // Use a helper that formats the output when given a microPackPath.
    const output = MessageV2.renderMicroPackPointer?.(".opencode/evidence/child/micro-pack.json")
    expect(output).toContain("micro-pack.json")
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd opencode-zh-build/opencode_src-p1/packages/opencode && bun test test/tool/task-micro-pack.test.ts`  
Expected: FAIL (helper missing)

**Step 3: Implement micro-pack pointer helper + integration**

Implementation requirements:
- Add a small helper (e.g., `MessageV2.renderMicroPackPointer`) that formats:
  ```
  <micro_pack>
  path: .opencode/evidence/<childSessionId>/micro-pack.json
  </micro_pack>
  ```
- In `TaskTool`, after subagent completes, call:
  ```ts
  const writer = await EvidenceWriter.open({ sessionId: session.id })
  const micro = await writer.microPack({ parentSessionId: ctx.sessionID })
  ```
- Append the pointer tag to `output` and include `microPackPath` in metadata.

**Step 4: Run test to verify it passes**

Run: `cd opencode-zh-build/opencode_src-p1/packages/opencode && bun test test/tool/task-micro-pack.test.ts`  
Expected: PASS

**Step 5: Manual QA (required)**

Run in CLI:
1) Start a session, run a subagent task that uses PythonTool.
2) Verify `.opencode/evidence/<childSessionId>/micro-pack.json` exists.
3) Verify parent output contains the `<micro_pack>` tag.

**Step 6: Commit**

```bash
git add packages/opencode/src/tool/task.ts packages/opencode/src/session/message-v2.ts packages/opencode/test/tool/task-micro-pack.test.ts
git commit -m "feat(session): emit micro-pack for sub sessions [AI:GPT-5.2]"
```

---

### Task 5.1: PythonTool CLI 契约（脚本输入/输出规范）

**Files:**
- Modify: `packages/opencode/src/python/scripts/summarize-json.py`
- Create: `packages/opencode/test/python/script-contract.test.ts`

**Step 1: Write the failing test**

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

**Step 2: Run test to verify it fails**

Run: `cd opencode-zh-build/opencode_src-p1/packages/opencode && bun test test/python/script-contract.test.ts`  
Expected: FAIL (script not implemented)

**Step 3: Implement script contract**

- `summarize-json.py` 支持 `--input` 与 `--output` 参数。
- 输出 JSON 含 `summary` 与 `keys` 字段。

**Step 4: Run test to verify it passes**

Run: `cd opencode-zh-build/opencode_src-p1/packages/opencode && bun test test/python/script-contract.test.ts`  
Expected: PASS (or skip if python3 missing)

**Step 5: Commit**

```bash
git add packages/opencode/src/python/scripts/summarize-json.py packages/opencode/test/python/script-contract.test.ts
git commit -m "test(python): add script contract [AI:GPT-5.2]"
```

---

### Task 5.2: 协议失败事件（events 强约束最小补强）

**Files:**
- Modify: `packages/opencode/src/evidence/writer.ts`
- Test: `packages/opencode/test/evidence/protocol-violation.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test"
import { EvidenceWriter } from "../../src/evidence/writer"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("evidence.protocol violation", () => {
  test("writes protocol_violation event on invalid pack", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const writer = await EvidenceWriter.open({ sessionId: "bad_pack" })
        await expect(writer.pack({ handoff: "" as any })).rejects.toThrow()
        const eventsPath = `${Instance.worktree}/.opencode/evidence/bad_pack/events.jsonl`
        const text = await Bun.file(eventsPath).text()
        expect(text).toContain("protocol_violation")
      },
    })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd opencode-zh-build/opencode_src-p1/packages/opencode && bun test test/evidence/protocol-violation.test.ts`  
Expected: FAIL

**Step 3: Implement minimal violation event**

- 当 `EvidencePack.parse` 失败时，写入 `event.type = "protocol_violation"`，并写入 error 摘要 artifact。

**Step 4: Run test to verify it passes**

Run: `cd opencode-zh-build/opencode_src-p1/packages/opencode && bun test test/evidence/protocol-violation.test.ts`  
Expected: PASS

**Step 5: Commit**

```bash
git add packages/opencode/src/evidence/writer.ts packages/opencode/test/evidence/protocol-violation.test.ts
git commit -m "feat(evidence): add protocol violation events [AI:GPT-5.2]"
```

---

### Task 6: P1 verification pass

**Files:** none (command-only)

**Step 1: Run focused tests**

Run:  
`cd opencode-zh-build/opencode_src-p1/packages/opencode && bun test test/python/registry.test.ts test/tool/python.test.ts test/protocol/evidence-micro-contract.test.ts test/evidence/micro-pack.test.ts test/tool/task-micro-pack.test.ts`

Expected: PASS (python test may skip if python3 missing)

**Step 2: Commit bookkeeping (if needed)**

```bash
git status -sb
```

---

**Plan complete and saved to** `docs/plans/2026-01-28-opencode-sandbox-context-p1-implementation-plan.md`.  
Two execution options:

1. **Subagent-Driven (this session)** — I dispatch a fresh subagent per task and review between tasks  
2. **Parallel Session (separate)** — Open a new session in the P1 worktree using `superpowers:executing-plans`

Which approach do you want?
