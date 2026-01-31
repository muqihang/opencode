# File Workbench Task 11.1 (Cross-Session Cache Reuse) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable **cross-session reuse** of file-workbench derived artifacts for the same `inputId = sha256(file_bytes)`, while recording reuse as evidence (`file.cache_hit` event + `inputs.json events: ["cache_hit"]`) and keeping existing Task 11 outputs/backwards-compat behavior intact.

**Architecture:** Add a small **on-disk cache layer** under `.opencode/cache/file-workbench/<inputId>/<category>/...` with per-category metadata. During `Workbench.ingest`, after writing the session-scoped input artifact, attempt to **rehydrate cached derived artifacts** (text/archive/pdf) into the session’s `.opencode/artifacts/<sessionId>/derived/<inputId>/...` using `EvidenceWriter.artifact`. For cache misses, run the existing derivation logic and then **store** the produced outputs into the global cache for future sessions.

**Tech Stack:** Bun, `fs/promises`, Zod, `EvidenceWriter`, `stableJson`, `Lock` (in-memory), `Filesystem.contains` (path safety).

---

## Spec / Requirements (source of truth)

From the master design doc Section 13.2.1:
- `inputId = sha256(file_bytes)` is a stable identifier.
- “同 inputId 的派生结果可跨 session 复用”，且**复用事实必须写入 Evidence Pack（`events: cache_hit`）**，避免不透明复用。

Current repo state (already implemented):
- Task 11 baseline exists in `packages/opencode/src/file/workbench.ts` and writes:
  - `inputs/inputs.json`
  - `derived/<inputId>/text.txt` + `chunks.json` for text-like
  - `derived/<inputId>/unpacked/...` + `filelist.json` for archives
  - `derived/<inputId>/pdf.extract.error.json` (and possibly `text.txt`) for PDF best-effort
- Task 12 python doc scripts exist but are **not wired** into the workbench yet. Task 11.1 must work with the current Bun-based derivations.

---

## Execution Safety Rules (required)

1) **No hallucinations:** If unsure about Bun APIs, `fs` behavior, or path safety:
   - First `rg` the repo for existing patterns.
   - Still unsure → use Context7 MCP to check official docs. Do not guess.
   - Convert the decision into a test assertion or runtime validation.

2) **Never rehydrate “irrelevant” outputs:** Cache reuse must respect the current session’s derivation intent:
   - If a file is *not* treated as PDF in this session, do **not** rehydrate PDF artifacts even if PDF cache exists.
   - Same principle for archive/text categories.

3) **Evidence-first:** Any global cache reuse must emit `file.cache_hit` (with `scope: "global"`).

4) **No high-risk ops without approval:** No deletes, `git restore/reset/clean/rebase`, force pushes, sudo, or recursive chmod/chown without explicit approval.

---

## Cache Design (v1)

**Cache root (project-scoped):**
- `baseDir = Instance.worktree === "/" ? Instance.directory : Instance.worktree`
- `cacheRoot = <baseDir>/.opencode/cache/file-workbench`

**Per inputId + category:**
- `cacheDir = <cacheRoot>/<inputId>/<category>/`
- `cacheMeta = <cacheDir>/cache.json`

**Categories (v1):**
- `text`: `text.txt` + `chunks.json`
- `archive`: `unpacked/**` (including `filelist.json` and extracted files)
- `pdf`: either `text.txt` (success) OR `pdf.extract.error.json` (failure)

**Tool fingerprint (to avoid reusing stale failures):**
- Some derived artifacts depend on external tools (`tar`, `unzip`, `pdftotext`).
- Cache meta MUST record a minimal “tool availability fingerprint” (v1: just `present: boolean` per tool).
- Cache reuse MUST be gated by fingerprint equality; e.g. if `pdftotext` was missing when the cache was created but is
  present now, treat as a cache miss and re-derive (so installing dependencies “unlocks” success).

**Meta schema (v1):**
- `specVersion: "file-workbench-cache/1.0"`
- `category: "text" | "archive" | "pdf"`
- `inputId: string`
- `createdAtUtc: string`
- `toolFingerprint?: { tar?: { present: boolean }; unzip?: { present: boolean }; pdftotext?: { present: boolean } }`
- `artifacts: [{ path: string; sha256: string; kind: string }]` where `path` is relative to the category dir

---

## Task 0: Commit this plan doc (anchor the plan)

**Files:**
- Add: `docs/plans/2026-01-31-file-workbench-task11_1-cross-session-cache.md`

**Step 1: Git status**

Run: `git status -sb`  
Expected: on the Task 11.1 work branch, this plan file is untracked.

**Step 2: Add + commit**

```bash
git add docs/plans/2026-01-31-file-workbench-task11_1-cross-session-cache.md
git commit -m "docs(plans): add Task 11.1 cross-session cache plan [AI:GPT-5.2]"
```

---

## Task 1: Add RED tests for cross-session cache reuse (text + filtering)

**Files:**
- Create: `packages/opencode/test/file/workbench-cross-session-cache.test.ts`

**Step 1: Write the failing test (text reuse across sessions)**

```ts
import { describe, expect, test } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Workbench } from "../../src/file/workbench"

function sha(bytes: Uint8Array) {
  const hash = new Bun.CryptoHasher("sha256")
  hash.update(Buffer.from(bytes))
  return hash.digest("hex")
}

function readEvents(file: string) {
  return Bun.file(file)
    .text()
    .then((text) =>
      text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { type?: string; data?: any }),
    )
}

describe("file.workbench cross-session cache", () => {
  test("rehydrates cached text derived across sessions and records cache_hit", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const filePath = path.join(tmp.path, "note.md")
        const text = "# Hello\n"
        await Bun.write(filePath, text)
        const bytes = await Bun.file(filePath).bytes()
        const inputId = sha(bytes)

        const sessionA = await Session.create({})
        await Workbench.ingest({
          sessionId: sessionA.id,
          part: { type: "file", url: `file://${filePath}`, mime: "text/markdown", filename: "note.md" },
        })

        const cacheMeta = path.join(
          tmp.path,
          ".opencode",
          "cache",
          "file-workbench",
          inputId,
          "text",
          "cache.json",
        )
        expect(await Bun.file(cacheMeta).exists()).toBe(true)

        const sessionB = await Session.create({})
        await Workbench.ingest({
          sessionId: sessionB.id,
          part: { type: "file", url: `file://${filePath}`, mime: "text/markdown", filename: "note.md" },
        })

        const inputsPath = path.join(tmp.path, ".opencode", "artifacts", sessionB.id, "inputs", "inputs.json")
        const inputs = JSON.parse(await Bun.file(inputsPath).text()) as { inputs: Array<{ inputId: string; events?: string[] }> }
        const entry = inputs.inputs.find((x) => x.inputId === inputId)
        expect(entry).toBeDefined()
        expect(entry!.events?.includes("cache_hit")).toBe(true)

        const eventsPath = path.join(tmp.path, ".opencode", "evidence", sessionB.id, "events.jsonl")
        const events = await readEvents(eventsPath)
        const hits = events.filter((e) => e.type === "file.cache_hit" && e.data?.scope === "global")
        expect(hits.length).toBeGreaterThan(0)

        const derivedText = path.join(tmp.path, ".opencode", "artifacts", sessionB.id, "derived", inputId, "text.txt")
        expect(await Bun.file(derivedText).exists()).toBe(true)
        expect(await Bun.file(derivedText).text()).toBe(text)
      },
    })
  })

  test("does not rehydrate pdf artifacts when current session is not pdf", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const filePath = path.join(tmp.path, "bad.pdf")
        await Bun.write(filePath, "not a pdf")
        const bytes = await Bun.file(filePath).bytes()
        const inputId = sha(bytes)

        const sessionA = await Session.create({})
        await Workbench.ingest({
          sessionId: sessionA.id,
          part: { type: "file", url: `file://${filePath}`, mime: "application/pdf", filename: "bad.pdf" },
        })

        const sessionB = await Session.create({})
        await Workbench.ingest({
          sessionId: sessionB.id,
          part: { type: "file", url: `file://${filePath}`, mime: "application/octet-stream", filename: "bad.bin" },
        })

        const pdfError = path.join(
          tmp.path,
          ".opencode",
          "artifacts",
          sessionB.id,
          "derived",
          inputId,
          "pdf.extract.error.json",
        )
        expect(await Bun.file(pdfError).exists()).toBe(false)
      },
    })
  })

  test("rehydrates cached pdf failure artifact across sessions and records cache_hit", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const filePath = path.join(tmp.path, "bad.pdf")
        await Bun.write(filePath, "not a pdf")
        const bytes = await Bun.file(filePath).bytes()
        const inputId = sha(bytes)

        const sessionA = await Session.create({})
        await Workbench.ingest({
          sessionId: sessionA.id,
          part: { type: "file", url: `file://${filePath}`, mime: "application/pdf", filename: "bad.pdf" },
        })

        const cacheMeta = path.join(
          tmp.path,
          ".opencode",
          "cache",
          "file-workbench",
          inputId,
          "pdf",
          "cache.json",
        )
        expect(await Bun.file(cacheMeta).exists()).toBe(true)

        const sessionB = await Session.create({})
        await Workbench.ingest({
          sessionId: sessionB.id,
          part: { type: "file", url: `file://${filePath}`, mime: "application/pdf", filename: "bad.pdf" },
        })

        const pdfError = path.join(
          tmp.path,
          ".opencode",
          "artifacts",
          sessionB.id,
          "derived",
          inputId,
          "pdf.extract.error.json",
        )
        expect(await Bun.file(pdfError).exists()).toBe(true)

        const eventsPath = path.join(tmp.path, ".opencode", "evidence", sessionB.id, "events.jsonl")
        const events = await readEvents(eventsPath)
        const hits = events.filter((e) => e.type === "file.cache_hit" && e.data?.scope === "global")
        expect(hits.length).toBeGreaterThan(0)
      },
    })
  })
})
```

**Step 2: Run test to verify it fails**

Run:
`cd "$P2_WORKTREE_DIR/packages/opencode" && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test test/file/workbench-cross-session-cache.test.ts`  
Expected: FAIL (no cache directory + no global cache_hit event).

**Step 3: Commit tests (optional but recommended)**

```bash
git add packages/opencode/test/file/workbench-cross-session-cache.test.ts
git commit -m "test(file): add cross-session cache tests for workbench [AI:GPT-5.2]"
```

---

## Task 2: Implement cache module (text + pdf filtering) and make tests GREEN

**Files:**
- Create: `packages/opencode/src/file/workbench-cache.ts`
- Modify: `packages/opencode/src/file/workbench.ts`

**Step 1: Write the minimal cache module**

Create `packages/opencode/src/file/workbench-cache.ts` with:
- cache root: `.opencode/cache/file-workbench`
- category dirs: `<inputId>/<category>/`
- metadata file: `cache.json`
- safe path join (deny absolute + `..`, enforce `Filesystem.contains`)
- atomic writes for cache files (`.tmp` + rename)

Skeleton (copy/paste and then implement):

```ts
import fs from "fs/promises"
import path from "path"
import z from "zod"
import { Instance } from "@/project/instance"
import { Filesystem } from "@/util/filesystem"
import { Identifier } from "@/id/id"
import { stableJson } from "@/util/stable-json"
import { Lock } from "@/util/lock"

const CacheCategory = z.enum(["text", "archive", "pdf"])

const CacheArtifact = z
  .object({
    path: z.string().min(1),
    sha256: z.string().min(1),
    kind: z.string().min(1),
  })
  .strict()

const CacheMeta = z
  .object({
    specVersion: z.literal("file-workbench-cache/1.0"),
    category: CacheCategory,
    inputId: z.string().min(1),
    createdAtUtc: z.string().min(1),
    toolFingerprint: z
      .object({
        tar: z.object({ present: z.boolean() }).optional(),
        unzip: z.object({ present: z.boolean() }).optional(),
        pdftotext: z.object({ present: z.boolean() }).optional(),
      })
      .strict()
      .optional(),
    artifacts: z.array(CacheArtifact),
  })
  .strict()

function baseDir() {
  return Instance.worktree === "/" ? Instance.directory : Instance.worktree
}

function cacheRoot() {
  return path.join(baseDir(), ".opencode", "cache", "file-workbench")
}

function isTraversal(rel: string) {
  if (path.isAbsolute(rel)) return true
  const parts = rel.split(path.sep)
  return parts.includes("..")
}

async function safePath(base: string, rel: string) {
  if (isTraversal(rel)) throw new Error("Path traversal is not allowed")
  const target = path.resolve(base, rel)
  if (!Filesystem.contains(base, target)) throw new Error("Path is outside base directory")
  return target
}

async function sha256File(file: string) {
  const bytes = await Bun.file(file).bytes()
  const hash = new Bun.CryptoHasher("sha256")
  hash.update(Buffer.from(bytes))
  return hash.digest("hex")
}

async function writeAtomic(file: string, data: string | Uint8Array) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${Identifier.ascending("tool")}.tmp`
  await Bun.write(tmp, data)
  await fs.rename(tmp, file)
}

async function readMeta(metaPath: string) {
  const text = await Bun.file(metaPath).text().catch(() => "")
  if (!text) return
  return CacheMeta.safeParse(JSON.parse(text) as unknown)
}

export const WorkbenchCache = {
  async readCategory(input: { inputId: string; category: z.infer<typeof CacheCategory> }) {
    const dir = path.join(cacheRoot(), input.inputId, input.category)
    const metaPath = path.join(dir, "cache.json")
    await using lock = await Lock.read(`file-workbench-cache:${input.inputId}:${input.category}`)
    void lock
    const parsed = await readMeta(metaPath)
    if (!parsed?.success) return
    return { dir, meta: parsed.data }
  },

  toolFingerprint() {
    // v1: presence-only, cheap + deterministic
    return {
      tar: { present: Boolean(Bun.which("tar")) },
      unzip: { present: Boolean(Bun.which("unzip")) },
      pdftotext: { present: Boolean(Bun.which("pdftotext")) },
    }
  },

  async writeCategoryFromSessionDerived(input: {
    sessionId: string
    inputId: string
    category: z.infer<typeof CacheCategory>
    artifacts: Array<{ rel: string; kind: string }>
  }) {
    const base = baseDir()
    const sessionDerived = path.join(base, ".opencode", "artifacts", input.sessionId, "derived", input.inputId)
    const categoryDir = path.join(cacheRoot(), input.inputId, input.category)
    await using lock = await Lock.write(`file-workbench-cache:${input.inputId}:${input.category}`)
    void lock

    const stored: Array<z.infer<typeof CacheArtifact>> = []
    for (const item of input.artifacts) {
      const src = await safePath(sessionDerived, item.rel)
      const bytes = await Bun.file(src).bytes()
      const dest = await safePath(categoryDir, item.rel)
      await writeAtomic(dest, bytes)
      stored.push({ path: item.rel.replace(/\\\\/g, "/"), sha256: await sha256File(dest), kind: item.kind })
    }
    stored.sort((a, b) => a.path.localeCompare(b.path))
    const meta = CacheMeta.parse({
      specVersion: "file-workbench-cache/1.0",
      category: input.category,
      inputId: input.inputId,
      createdAtUtc: new Date().toISOString(),
      toolFingerprint: WorkbenchCache.toolFingerprint(),
      artifacts: stored,
    })
    await writeAtomic(path.join(categoryDir, "cache.json"), stableJson(meta))
  },
}
```

**Step 2: Wire cache reuse into `Workbench.ingest`**

In `packages/opencode/src/file/workbench.ts`:
- Import `WorkbenchCache`.
- Compute derivation intent (`wantsText`, `wantsPdf`, `wantsArchive`) using existing helpers:
  - `isTextLike(name, bytes)`
  - `isPdf(name, mime)`
  - `archiveKind(name)`
- For new (non-duplicate) inputs:
  - Always write the input artifact (`inputs/<inputId>/<filename>`) into the session.
- Attempt to read and rehydrate cache for categories that apply.
  - If a category hits:
    - Write derived artifacts into the session using `writer.artifact`.
    - Record evidence event `file.cache_hit` with `data.scope = "global"` and `data.categories = [...]`.
    - Mark `inputs.json` entry `events: ["cache_hit"]`.
  - For categories that miss:
    - Run the existing derive function for that category.
    - After derivation, store into cache via `WorkbenchCache.writeCategoryFromSessionDerived(...)`.

**Rehydration (minimal v1):**
- Read cache meta and for each artifact in meta:
  - Read bytes from cache file and write into session derived path via `writer.artifact`.
  - Use artifact kind based on `meta.artifacts[].kind`.
  - Gate reuse by tool fingerprint equality for tool-dependent categories (pdf/archive).

**Step 3: Run tests to verify they pass**

Run:
`cd "$P2_WORKTREE_DIR/packages/opencode" && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test test/file/workbench-cross-session-cache.test.ts`  
Expected: PASS.

**Step 4: Commit**

```bash
git add packages/opencode/src/file/workbench-cache.ts packages/opencode/src/file/workbench.ts
git commit -m "feat(file): cross-session cache reuse for workbench derived [AI:GPT-5.2]"
```

---

## Task 3: Add archive + pdf cache coverage (broaden reuse)

**Files:**
- Modify: `packages/opencode/test/file/workbench-cross-session-cache.test.ts`
- Modify: `packages/opencode/src/file/workbench-cache.ts`
- Modify: `packages/opencode/src/file/workbench.ts`

**Step 1: Add failing tests (archive cache hit across sessions)**

Add a test that:
- Creates a tar archive (same pattern as `workbench-archive.test.ts`)
- Ingest in session A (produces `derived/<inputId>/unpacked/...`)
- Ingest in session B (expects `file.cache_hit scope=global` and extracted file exists)

**Step 2: Run to verify RED**

Run:
`cd "$P2_WORKTREE_DIR/packages/opencode" && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test test/file/workbench-cross-session-cache.test.ts`  
Expected: FAIL until archive category cache is implemented.

**Step 3: Implement archive category cache**

Implementation notes:
- Archive cache should store **all files under** `derived/<inputId>/unpacked/**`.
- Use a deterministic file list:
  - Prefer using the already-generated `unpacked/filelist.json` to decide what to cache/rehydrate.
  - Cache meta artifacts list must be sorted by `path`.
- Rehydration must write:
  - `unpacked/filelist.json` as `file-unpacked-list`
  - each `unpacked/<rel>` as `file-unpacked`

**Step 4: Run test to verify GREEN**

Run:
`cd "$P2_WORKTREE_DIR/packages/opencode" && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test test/file/workbench-cross-session-cache.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/opencode/test/file/workbench-cross-session-cache.test.ts packages/opencode/src/file/workbench-cache.ts packages/opencode/src/file/workbench.ts
git commit -m "feat(file): cache + rehydrate archive derived across sessions [AI:GPT-5.2]"
```

---

## Task 4: Regression + verification

**Step 1: Run the whole file-workbench test suite**

Run:
`cd "$P2_WORKTREE_DIR/packages/opencode" && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test test/file`  
Expected: PASS.

**Step 2: Run full test suite**

Run:
`cd "$P2_WORKTREE_DIR/packages/opencode" && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test`  
Expected: PASS.

**Step 3: Final commit (only if needed)**

If you made small fixes during regression, commit them:

```bash
git add -A
git commit -m "fix(file): stabilize workbench cache reuse [AI:GPT-5.2]"
```

---

## Notes / Known Tradeoffs (explicit)

- Cache has no eviction policy in v1 → disk usage can grow. This is acceptable for P2b; retention/cleanup is a later-phase concern.
- Cache invalidation is versioned by `specVersion` only. If semantics change later, bump `specVersion` to avoid reusing stale caches.

---

## Execution Handoff

Plan complete and saved to `docs/plans/2026-01-31-file-workbench-task11_1-cross-session-cache.md`.

Two execution options:
1) **Subagent-Driven (this session)** — REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`
2) **Parallel Session (separate)** — REQUIRED SUB-SKILL: `superpowers:executing-plans`

Use option 2 (parallel session) to keep the controller (main chat) clean and keep changes isolated in a worktree.
