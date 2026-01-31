# Task 13 Execution Plan — File Workbench P2 upgrades (stable PDF pages + OCR pipeline + Office parsing)

Date: **2026-01-31**  
Scope: `packages/opencode`  
Related master plan: `docs/plans/2026-01-30-opencode-sandbox-context-p2-implementation-plan.md` (Task 13)  
Design anchor: `docs/plans/2026-01-25-opencode-sandbox-context-design.md` (Section **13.2.1**)  

---

## GOAL

Implement the **P2 quality/coverage upgrades** for the file workbench:

1) **Stable PDF pages** output:
   - Produce `derived/<inputId>/pdf.pages.json` with page-level provenance (`page_number`, `content_hash`, pointers).
2) **OCR pipeline** (images and “scanned-like” inputs):
   - Add `doc.ocr_image` derivation that is **policy-gated** and evidence-backed.
3) **Office parsing (docx first)**:
   - Parse `.docx` into `text + structure`, emitting `derived/<inputId>/text.txt`, `chunks.json`, plus structure metadata.

All outputs must remain **artifact-first** (pointers, not paste), and all failures must be **explicit evidence** (no silent
degradation).

---

## PREREQUISITES (already done in our branch)

These must exist before Task 13 is started:

- Task 11 baseline: `packages/opencode/src/file/workbench.ts` ingests file parts and writes:
  - `.opencode/artifacts/<sessionId>/inputs/*` and `inputs/inputs.json`
  - `derived/<inputId>/text.txt` + `chunks.json` for text-like inputs
  - `doc.unpack_archive` artifacts for zip/tar
  - `doc.extract_pdf_text` best-effort with failure evidence
- Task 11.1: cross-session cache reuse (`packages/opencode/src/file/workbench-cache.ts`)
- Task 12: built-in python doc scripts (already present; may be used later)
- Task 14: python deps offline-first (`python.deps.*`) for any Python dependency needs

Exit gate: baseline `bun test` is green before touching Task 13.

---

## NON-GOALS (Task 13 does NOT attempt)

- Hard sandbox enforcement (still soft).
- Full scanned-PDF OCR end-to-end (render PDF to images) unless the toolchain is clearly available and the change stays
  small; otherwise produce a clear “unavailable” evidence artifact.
- PPTX/XLSX parsing (docx only in v1, as per design).
- KB ingestion / indexing integration (optional future).

---

## EXECUTION RULES (must follow)

### Strict TDD

Each step must follow RED → GREEN with focused tests, then refactor.

### “No hallucination” rule (Context7 escalation)

If you need behavior you’re not sure about (Poppler `pdftotext` flags, tesseract CLI semantics, docx XML details),
do not guess:
1) `rg` existing repo patterns first.
2) If still uncertain, use **Context7 MCP** for official docs.
3) Encode the decision into tests or evidence events.

### Safety policy

No deletes, no `git restore/reset/clean/rebase`, no force push without explicit user confirmation.

---

## ARTIFACTS + EVENTS (v1 contract)

### A) `pdf.pages.json` (new)

Path: `derived/<inputId>/pdf.pages.json`

Proposed schema (stable, pointer-first):

```json
{
  "specVersion": "pdf-pages/1.0",
  "inputId": "<sha256>",
  "generatedAtUtc": "<iso8601>",
  "ok": true,
  "tool": { "name": "pdftotext", "mode": "per-page" },
  "pages": [
    {
      "page_number": 1,
      "text_path": "pdf/pages/0001.txt",
      "text_sha256": "<sha256>",
      "content_hash": "<sha256>",
      "snippet_preview": "<first 200 chars>"
    }
  ]
}
```

If extraction fails, the file must still exist with:
- `ok: false`
- `error: { code, message, hint }`

Notes:
- `text_sha256` is the sha256 of the page text file bytes.
- `content_hash` can equal `text_sha256` in v1 (keeps things simple and deterministic).
- Page filenames must be **stable and sortable**: `0001.txt`, `0002.txt`, … (fixed 4-digit zero pad is acceptable v1).

### B) OCR artifacts (new)

For image inputs (or OCR-eligible inputs when enabled):
- `derived/<inputId>/ocr.text.txt` (optional; only on success)
- `derived/<inputId>/ocr.meta.json`
- `derived/<inputId>/ocr.error.json` (on failure)

### C) Docx artifacts (new)

For `.docx` inputs:
- `derived/<inputId>/text.txt` (extracted text; keep consistent with other types)
- `derived/<inputId>/chunks.json` (chunked per paragraph or per block)
- `derived/<inputId>/docx.structure.json` (structure v1: paragraphs list, hashes, counts)
- `derived/<inputId>/docx.error.json` (on failure)

### Events (v1)

Keep event naming consistent with earlier P1/P2 patterns (type is stable string):
- `doc.pdf_pages` (info|error)
- `doc.ocr_image` (info|error)
- `doc.parse_docx` (info|error)

All events must include:
- `sessionId`, `inputId`
- artifact pointers (paths), not raw blobs
- `redaction: { applied: true, policyVersion: "v1" }`

---

## IMPLEMENTATION PLAN (TDD breakdown)

### Task 13.0 — Worktree + baseline

1) Create a new worktree from `feature/opencode-custom` (example branch `p2b-task13`).
2) Install deps:
   - `BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun install`
3) Baseline sanity:
   - `cd packages/opencode && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test`

Exit gate: baseline green.

### Task 13.1 — Stable PDF pages (pdf.pages.json)

**Primary file:** `packages/opencode/src/file/workbench.ts`

TDD steps:
1) Add a new test file:
   - `packages/opencode/test/file/workbench-pdf-pages.test.ts`
2) RED: ingest a fake PDF (`bad.pdf`) and assert:
   - `derived/<inputId>/pdf.pages.json` exists
   - schema `specVersion === "pdf-pages/1.0"`
   - `ok === false`
   - `error` present and mentions missing/failed `pdftotext` (environment-independent)
3) GREEN: implement `derivePdfPages(...)`:
   - Determine page count:
     - Prefer Poppler `pdfinfo` (parse `Pages: <n>`), because `pdftotext` alone does not reliably expose page count.
     - If `pdfinfo` is missing/unusable, still write `pdf.pages.json` with `ok=false` and
       `error.code="dependency_unavailable"` (do not silently fall back to whole-doc text).
   - Use `pdftotext -f N -l N` per-page when page count is known
   - Write per-page text files under `derived/<inputId>/pdf/pages/<zeroPad>.txt`
   - Write `pdf.pages.json` with page entries and hashes
   - On any failure, still write `pdf.pages.json` with `ok=false` and an explicit `error` object (no silent failure)
4) Integrate into ingest flow:
   - For PDF inputs, call stable pages derivation (P2 upgrade)
   - Keep existing `text.txt` behavior (optional: `text.txt` may be derived from pages join; do not regress)

Cache integration:
- Extend the existing `pdf` cache write to include:
  - `pdf.pages.json`
  - `pdf/pages/*.txt` (if any)
  - plus existing `text.txt` or error artifacts

Implementation note:
- For caching `pdf/pages/*.txt`, enumerate the derived folder after generation, normalize paths, sort them, and pass
  explicit artifact rel-paths into `WorkbenchCache.writeCategoryFromSessionDerived(...)` (no globbing inside cache).

Exit gate:
- `bun test test/file/workbench-pdf-pages.test.ts` passes.

### Task 13.2 — OCR (image inputs; policy-gated)

**Primary file:** `packages/opencode/src/file/workbench.ts`  
**Config file:** `packages/opencode/src/config/config.ts`

Design decision (v1):
- OCR is **disabled by default** and must be enabled via config:

```json
{
  "workbench": {
    "ocr": { "mode": "tesseract", "language": "eng" }
  }
}
```

TDD steps:
1) Add config schema + config test:
   - Extend config schema with `workbench.ocr.mode` (`disabled|tesseract`, default `disabled`)
   - Add `workbench.ocr.language?: string` (optional; default `"eng"` when mode is tesseract)
   - Add/extend `packages/opencode/test/config/...` to ensure defaults are stable
2) Add test:
   - `packages/opencode/test/file/workbench-ocr.test.ts`
   - Use a fake `.png` file (invalid image bytes) so behavior is deterministic:
     - When OCR enabled, we must emit `doc.ocr_image` event and write `ocr.error.json`
3) Implement OCR derivation:
   - Load config via `await Config.get()` inside `Workbench.ingest(...)` (Workbench currently does not read config).
   - If OCR disabled: do nothing.
   - If enabled and `tesseract` exists: attempt OCR, but still produce evidence on failure.
   - If enabled and `tesseract` missing: produce `ocr.error.json` + `doc.ocr_image` error event.

Exit gate:
- OCR tests pass without requiring tesseract to be present.

### Task 13.3 — Office parsing (docx → text + structure)

**Primary file:** `packages/opencode/src/file/workbench.ts`

TDD steps:
1) Add test:
   - `packages/opencode/test/file/workbench-docx.test.ts`
2) Test input generation (deterministic):
   - Use `python3` stdlib `zipfile` to create a minimal `.docx` zip with `word/document.xml`
   - If `python3` is unavailable, the test may `return` early (consistent with existing python tests)
   - If unzip tooling is unavailable (`unzip` missing on non-Windows), the test may `return` early, because the v1
     implementation reuses `Archive.extractZip()` which relies on platform unzip tooling.
3) RED assertions:
   - ingest `.docx` file should produce `derived/<inputId>/text.txt` containing “Hello”
   - `docx.structure.json` exists with paragraph count >= 1
4) GREEN implementation:
   - Detect docx by extension/mime
   - Extract `word/document.xml` to temp dir (reuse `Archive.extractZip`)
   - Extract text by collecting `<w:t>` nodes, and map paragraphs by `<w:p>`
   - Emit:
     - `text.txt`
     - `chunks.json` (one chunk per paragraph; include preview + hash)
     - `docx.structure.json`
   - If extraction fails, emit `docx.error.json` + error event (no silent failure)

Cache integration (optional, v1):
- If docx extraction succeeds, write into existing **text cache category**:
  - `text.txt`, `chunks.json` (and optionally `docx.structure.json`)
- For cross-session reuse, treat `.docx` as “text-derived” for caching purposes:
  - When ingesting a docx, try rehydrating cache category `"text"` first (even though the bytes are not text-like).

Exit gate:
- docx test passes (or skips cleanly if python3 missing).

### Task 13.4 — Regression pass

Run focused suites:
- `cd packages/opencode && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test test/file`
- `cd packages/opencode && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test`

Exit gate: full suite green.

---

## DEFINITION OF DONE (Task 13)

Task 13 is done when:
- PDF inputs produce `derived/<inputId>/pdf.pages.json` (success or explicit failure) and a `doc.pdf_pages` event.
- Image inputs (when OCR enabled) produce `doc.ocr_image` evidence (success or explicit failure); OCR is disabled by
  default.
- `.docx` inputs produce `text + chunks + structure` (or explicit failure evidence), plus `doc.parse_docx` event.
- Cross-session cache behavior is not broken; cache writes remain deterministic.
- `cd packages/opencode && ... bun test` passes.

---

## Executor prompt (single-agent, single worktree)

> Execute **Task 13** strictly following `docs/plans/2026-01-31-task13-file-workbench-p2-upgrades.md`.  
> Constraints: strict TDD (RED→GREEN), no deletes/git-restore/reset/clean/rebase, no force push.  
> If unsure about OCR/PDF/Docx tooling semantics, use Context7 MCP for official docs before implementing.  
> Use bun (npm install fails due to `catalog:`) with `BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp`.  
> Finish with `cd packages/opencode && ... bun test` all green and report changed files + test summaries.
