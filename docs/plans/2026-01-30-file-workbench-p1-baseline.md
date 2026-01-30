# File Workbench P1 Baseline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the Task 11 P1 file workbench baseline (inputs/derived/evidence) on the user file-attachment path in `session/prompt.ts`, with deterministic artifacts and evidence-backed behavior.

**Architecture:** Add a small file-workbench ingest module that accepts a validated file part + session context, writes inputs/derived artifacts with EvidenceWriter, and returns derived pointers. `session/prompt.ts` will call it for `file` parts without changing prompt content behavior. EvidenceWriter gets a minimal binary-safe artifact helper so binary inputs (zip/pdf) can be recorded deterministically.

**Tech Stack:** Bun (fs/Bun.file/Bun.CryptoHasher), Zod, EvidenceWriter, stableJson, Archive helper, child_process for `tar`/`pdftotext` best-effort.

---

## Execution Safety Rules (required)

1) **No hallucinations (required):** If unsure about any Bun/Node API, Zod shape, URL decoding rules, or archive/PDF tooling:
   - First, search this repo for patterns (`rg`) and follow existing conventions.
   - Still unsure → use Context7 MCP to query official docs (Bun/Node/Zod). Do not guess.
   - Convert the decision into a test assertion or runtime validation so it is enforced.

2) **Evidence-first behavior:** For every best-effort step, failures must be evidence-backed (error artifact + event), not silent.

3) **Avoid unneeded surface area:** Do not touch `session/prompt.ts` until Task 5, unless it is strictly required to compile tests.

---

## Task 11 Checklist Mapping (from docs/plans/2026-01-30-opencode-sandbox-context-p2-implementation-plan.md)

Each checklist item below must be tested directly (no mocks) and tied to a task/test in this plan:

1. `.opencode/artifacts/<sessionId>/inputs/` + `inputs.json`
   - Covered by Task 1 test: `writes inputs artifacts and inputs.json`
2. `inputId = sha256(file_bytes)` dedupe + `events: cache_hit`
   - Covered by Task 1 test: `duplicate input emits cache_hit event and skips derivation`
3. Derived `text.txt` + `chunks.json` for text-like files
   - Covered by Task 2 test: `text-like input writes derived text + chunks`
4. `doc.unpack_archive` (zip/tar)
   - Covered by Task 3 test: `archive input writes derived/unpacked + manifest entry`
5. Best-effort `doc.extract_pdf_text` (failure must still write evidence)
   - Covered by Task 4 test: `pdf extract failure writes evidence artifact`

---

### Task -1: Preflight verification (do not skip)

**Intent:** Task 11 is defined as “verify baseline exists; implement missing pieces if needed”. Before writing new code,
quickly confirm what already exists in the branch you are implementing on.

**Steps:**
1. `rg -n "file/workbench|inputs.json|doc\\.unpack_archive|doc\\.extract_pdf_text" packages/opencode/src packages/opencode/test -S`
2. If any baseline implementation already exists:
   - Keep/extend it; do not duplicate modules.
   - Still add/keep the tests below; if tests already pass, skip the corresponding implementation task and only commit tests.
3. Confirm deterministic base dir rule for artifacts: `baseDir = Instance.worktree === "/" ? Instance.directory : Instance.worktree`.

---

### Task 0: Add binary-safe evidence artifacts (needed for zip/pdf inputs)

**Files:**
- Modify: `packages/opencode/src/evidence/writer.ts`
- Test: `packages/opencode/test/evidence/evidence-writer.test.ts`

**Step 1: Write the failing test**

```ts
test("evidence.writer supports binary artifacts", async () => {
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const writer = await EvidenceWriter.open({ sessionId: "binary" })
      const bytes = new Uint8Array([1, 2, 3, 4])
      const entry = await writer.artifact({
        kind: "binary",
        path: "inputs/binary.bin",
        data: bytes,
      })
      const file = Bun.file(path.join(tmp.path, ".opencode", "artifacts", "binary", "inputs/binary.bin"))
      const got = new Uint8Array(await file.arrayBuffer())
      expect([...got]).toEqual([...bytes])
      expect(entry.path).toContain(".opencode/artifacts/binary/inputs/binary.bin")
    },
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd "$P2_WORKTREE_DIR/packages/opencode" && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test test/evidence/evidence-writer.test.ts`  
Expected: FAIL (Zod schema/type mismatch for `data`).

**Step 3: Write minimal implementation**

Update `ArtifactInput` and `writeAtomic` to accept `string | Uint8Array`, and compute sha/size from the raw bytes:

```ts
const ArtifactInput = z
  .object({
    kind: z.string().min(1),
    path: z.string().min(1).optional(),
    manifestPath: z.string().min(1).optional(),
    data: z.union([z.string(), z.instanceof(Uint8Array)]),
  })
  .strict()

function sha(input: string | Uint8Array) {
  const hash = new Bun.CryptoHasher("sha256")
  hash.update(input)
  return hash.digest("hex")
}

async function writeAtomic(file: string, data: string | Uint8Array) {
  // use Bun.write with raw data; compute size from bytes
}
```

**Step 4: Run test to verify it passes**

Run: `cd "$P2_WORKTREE_DIR/packages/opencode" && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test test/evidence/evidence-writer.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/opencode/src/evidence/writer.ts packages/opencode/test/evidence/evidence-writer.test.ts
git commit -m "feat(evidence): support binary artifacts"
```

---

### Task 1: Inputs ingestion + inputs.json + cache_hit event

**Files:**
- Create: `packages/opencode/src/file/workbench.ts`
- Test: `packages/opencode/test/file/workbench-inputs.test.ts`

**Step 1: Write the failing test**

```ts
test("writes inputs artifacts and inputs.json", async () => {
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      const filePath = path.join(tmp.path, "note.txt")
      await Bun.write(filePath, "hello")
      const input = {
        sessionId: session.id,
        part: { type: "file", url: `file://${filePath}`, mime: "text/plain", filename: "note.txt" },
      }
      await Workbench.ingest(input)
      const inputsDir = path.join(tmp.path, ".opencode", "artifacts", session.id, "inputs")
      expect(await Bun.file(path.join(inputsDir, "inputs.json")).exists()).toBe(true)
    },
  })
})

test("duplicate input emits cache_hit event and skips derivation", async () => {
  // ingest same file twice and assert events.jsonl contains cache_hit + no duplicate derived writes
})
```

**Step 2: Run test to verify it fails**

Run: `cd "$P2_WORKTREE_DIR/packages/opencode" && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test test/file/workbench-inputs.test.ts`  
Expected: FAIL (module not found / behavior missing).

**Step 3: Write minimal implementation**

Create `Workbench.ingest` with Zod-validated input, compute `inputId = sha256(file_bytes)`, and:
- Write input file to `.opencode/artifacts/<sessionId>/inputs/<inputId>/<safeFilename>` (binary-safe).
- Upsert `inputs.json` (stableJson, sorted by `inputId` then `filename`).
  - Must include at least: `name/size/sha256/mime/addedAt` per the master design doc.
- On duplicate (same inputId already present), emit evidence event `file.cache_hit` and mark `events: ["cache_hit"]` in the input record.

**Note (design gap checkpoint):** The master design doc suggests derived results can be reused across sessions for the same
`inputId`. If you want to keep Task 11 minimal, implement “dedupe within session” first. If you decide to implement
cross-session reuse now, the simplest v1 is a disk cache under `.opencode/cache/file-workbench/<inputId>/...` and
copy/rehydrate into the session’s `derived/<inputId>/...` while recording `cache_hit`.

**Step 4: Run test to verify it passes**

Run: `cd "$P2_WORKTREE_DIR/packages/opencode" && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test test/file/workbench-inputs.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/opencode/src/file/workbench.ts packages/opencode/test/file/workbench-inputs.test.ts
git commit -m "feat(file): ingest inputs and record cache hits"
```

---

### Task 2: Text-like derived `text.txt` + `chunks.json`

**Files:**
- Modify: `packages/opencode/src/file/workbench.ts`
- Test: `packages/opencode/test/file/workbench-text.test.ts`

**Step 1: Write the failing test**

```ts
test("text-like input writes derived text + chunks", async () => {
  // ingest .md or .txt, assert:
  // derived/<inputId>/text.txt exists
  // derived/<inputId>/chunks.json contains chunk_index/start/end/content_hash/snippet_preview
})
```

**Step 2: Run test to verify it fails**

Run: `cd "$P2_WORKTREE_DIR/packages/opencode" && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test test/file/workbench-text.test.ts`  
Expected: FAIL (no derived output).

**Step 3: Write minimal implementation**

Add extension-based detection + UTF-8 fallback:
- Extension allowlist: `.md .txt .json .yaml .yml .csv .log` and common code extensions.
- If extension unknown, attempt UTF-8 decode; treat as text if valid.

Write:
- `derived/<inputId>/text.txt` (original text)
- `derived/<inputId>/chunks.json` (single chunk with bytes `start=0`, `end=byteLength`, `content_hash`, `snippet_preview`).

Ensure `Workbench` uses EvidenceWriter for both artifacts.

**Step 4: Run test to verify it passes**

Run: `cd "$P2_WORKTREE_DIR/packages/opencode" && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test test/file/workbench-text.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/opencode/src/file/workbench.ts packages/opencode/test/file/workbench-text.test.ts
git commit -m "feat(file): derive text and chunks for text-like inputs"
```

---

### Task 3: Archive unpack (zip/tar) into derived + evidence

**Files:**
- Modify: `packages/opencode/src/file/workbench.ts`
- Test: `packages/opencode/test/file/workbench-archive.test.ts`

**Step 1: Write the failing test**

```ts
test("archive input writes derived/unpacked + manifest entry", async () => {
  // create a small zip/tar in tmpdir
  // ingest and assert derived/<inputId>/unpacked/<file> exists
  // assert filelist.json (or similar) artifact recorded in manifest
})
```

**Step 2: Run test to verify it fails**

Run: `cd "$P2_WORKTREE_DIR/packages/opencode" && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test test/file/workbench-archive.test.ts`  
Expected: FAIL (no unpack logic).

**Step 3: Write minimal implementation**

Implement `doc.unpack_archive` best-effort:
- For `.zip`, use existing `Archive.extractZip`.
- For `.tar`/`.tar.gz`/`.tgz`, call `tar -xf` (best-effort; no try/catch, use exit code).
- Extract into temp dir, then write each file into `derived/<inputId>/unpacked/<rel>` via EvidenceWriter to ensure manifest entries.
- Write `derived/<inputId>/unpacked/filelist.json` listing files + sha256, sorted by path.
 - Always emit an evidence event `doc.unpack_archive` with success/failure metadata (and on failure, write an error artifact
   under `derived/<inputId>/unpacked/` rather than throwing silently).

**Step 4: Run test to verify it passes**

Run: `cd "$P2_WORKTREE_DIR/packages/opencode" && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test test/file/workbench-archive.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/opencode/src/file/workbench.ts packages/opencode/test/file/workbench-archive.test.ts
git commit -m "feat(file): unpack archives into derived artifacts"
```

---

### Task 4: PDF extract best-effort (failure still writes evidence)

**Files:**
- Modify: `packages/opencode/src/file/workbench.ts`
- Test: `packages/opencode/test/file/workbench-pdf.test.ts`

**Step 1: Write the failing test**

```ts
test("pdf extract failure writes evidence artifact", async () => {
  // create an invalid/empty pdf, ingest, assert:
  // derived/<inputId>/pdf.extract.error.json exists (or similar)
  // manifest includes that artifact
})
```

**Step 2: Run test to verify it fails**

Run: `cd "$P2_WORKTREE_DIR/packages/opencode" && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test test/file/workbench-pdf.test.ts`  
Expected: FAIL.

**Step 3: Write minimal implementation**

Best-effort PDF extraction:
- If `pdftotext` available, attempt to run and write `derived/<inputId>/text.txt`.
- On failure or missing binary, write `derived/<inputId>/pdf.extract.error.json` with error + hint.
- Always record an evidence event `doc.extract_pdf_text` with success/failure data.

**Step 4: Run test to verify it passes**

Run: `cd "$P2_WORKTREE_DIR/packages/opencode" && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test test/file/workbench-pdf.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/opencode/src/file/workbench.ts packages/opencode/test/file/workbench-pdf.test.ts
git commit -m "feat(file): best-effort pdf text extraction with failure evidence"
```

---

### Task 5: Wire ingestion into `session/prompt.ts` file parts

**Files:**
- Modify: `packages/opencode/src/session/prompt.ts`
- Test: `packages/opencode/test/file/workbench-inputs.test.ts` (extend)

**Step 1: Write the failing test**

```ts
test("prompt file parts call workbench ingestion (inputs.json created)", async () => {
  // Recommendation: extract a tiny helper that prompt uses (e.g. ingestFilePartToWorkbench)
  // so the test can call it directly without having to run the full prompt loop.
  // Assert: inputs.json exists after handling a file part.
})
```

**Step 2: Run test to verify it fails**

Run: `cd "$P2_WORKTREE_DIR/packages/opencode" && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test test/file/workbench-inputs.test.ts`  
Expected: FAIL until prompt calls ingestion helper.

**Step 3: Write minimal implementation**

In `createUserMessage`, before existing file handling logic, call `Workbench.ingest` for `file://` and `data:` parts. Preserve current prompt behavior (still uses Read tool for text/plain and list tool for directories).

**Step 4: Run test to verify it passes**

Run: `cd "$P2_WORKTREE_DIR/packages/opencode" && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test test/file/workbench-inputs.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/opencode/src/session/prompt.ts packages/opencode/test/file/workbench-inputs.test.ts
git commit -m "feat(session): ingest file parts into workbench artifacts"
```
