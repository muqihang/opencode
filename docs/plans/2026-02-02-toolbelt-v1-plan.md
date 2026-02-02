# Tool Belt v1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add 4 allowlisted Python toolbelt scripts with stable JSON I/O, cache keys, safe path handling, and tests.

**Architecture:** Four self-contained Python scripts in `packages/opencode/src/python/scripts/` that read `--input` JSON, derive session artifact root from input path (`dirname(dirname(input_path))`), validate pointers safely (relative only, no traversal, no symlink chain), compute deterministic results, and emit SSOT JSON plus optional view markdown. `error` is reserved for fatal script failures; `ok=false` indicates a failed check/scan result. Tests run scripts against tmpdir fixtures without touching repo `.opencode`.

**Tech Stack:** Python 3 (stdlib only), Bun test, existing TS stableJson utility for cacheKey verification.

### Task 1: Add TDD fixtures + failing tests for citation-check

**Files:**
- Create: `packages/opencode/test/python/toolbelt-citation-check.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { stableJson } from "../../src/util/stable-json"

const sha256 = (text: string) => {
  const hash = new Bun.CryptoHasher("sha256")
  hash.update(text)
  return hash.digest("hex")
}

describe("toolbelt.citation-check", () => {
  test("emits stable output + cacheKey + sorted items", async () => {
    const python = Bun.which("python3")
    if (!python) return
    const script = path.join(__dirname, "../../src/python/scripts/citation-check.py")
    await using tmp = await tmpdir({})
    const sessionId = "session-1"
    const root = path.join(tmp.path, ".opencode", "artifacts", sessionId)
    const derived = path.join(root, "derived", "input-1")
    await Bun.write(path.join(derived, "note.txt"), "hello\nworld\n")
    const okPath = path.join(derived, "note.txt")
    const okSha = sha256(await Bun.file(okPath).text())
    const input = {
      specVersion: "citation-check/1.0",
      policyVersion: "v1",
      pointers: [
        { path: `derived/input-1/note.txt`, sha256: okSha, anchor: { lineStart: 1, lineEnd: 1 } },
        { path: `derived/input-1/missing.txt`, sha256: okSha },
      ],
    }
    const inputPath = path.join(root, "python", "input.json")
    const outputPath = path.join(root, "python", "output.json")
    await Bun.write(inputPath, JSON.stringify(input))
    await $`${python} ${script} --input ${inputPath} --output ${outputPath}`.quiet()
    const data = JSON.parse(await Bun.file(outputPath).text())
    expect(data.specVersion).toBe("citation-check/1.0")
    expect(data.policyVersion).toBe("v1")
    expect(data.cacheKey).toBe(sha256(stableJson(input)))
    expect(Array.isArray(data.items)).toBe(true)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd packages/opencode && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test test/python/toolbelt-citation-check.test.ts`
Expected: FAIL (script missing / output mismatch)

**Step 3: Write minimal implementation**

Add `packages/opencode/src/python/scripts/citation-check.py` with self-contained stableJson, sha256, safe path validation, anchor validation, and viewMarkdown.

**Step 4: Run test to verify it passes**

Run: `cd packages/opencode && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test test/python/toolbelt-citation-check.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/opencode/src/python/scripts/citation-check.py packages/opencode/test/python/toolbelt-citation-check.test.ts
 git commit -m "feat: add citation-check toolbelt script"
```

### Task 2: Add TDD fixtures + failing tests for doc-quote-anchor

**Files:**
- Create: `packages/opencode/test/python/toolbelt-doc-quote-anchor.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { stableJson } from "../../src/util/stable-json"

const sha256 = (text: string) => {
  const hash = new Bun.CryptoHasher("sha256")
  hash.update(text)
  return hash.digest("hex")
}

describe("toolbelt.doc-quote-anchor", () => {
  test("anchors substring with line range", async () => {
    const python = Bun.which("python3")
    if (!python) return
    const script = path.join(__dirname, "../../src/python/scripts/doc-quote-anchor.py")
    await using tmp = await tmpdir({})
    const sessionId = "session-2"
    const root = path.join(tmp.path, ".opencode", "artifacts", sessionId)
    const derived = path.join(root, "derived", "input-2")
    const textPath = path.join(derived, "text.txt")
    await Bun.write(textPath, "alpha\nhello world\nomega\n")
    const input = {
      specVersion: "doc-quote-anchor/1.0",
      policyVersion: "v1",
      quotes: [
        {
          text: "hello world",
          sourcePointer: { path: "derived/input-2/text.txt", sha256: sha256("alpha\nhello world\nomega\n") },
        },
      ],
      topK: 3,
    }
    const inputPath = path.join(root, "python", "input.json")
    const outputPath = path.join(root, "python", "output.json")
    await Bun.write(inputPath, JSON.stringify(input))
    await $`${python} ${script} --input ${inputPath} --output ${outputPath}`.quiet()
    const data = JSON.parse(await Bun.file(outputPath).text())
    expect(data.cacheKey).toBe(sha256(stableJson(input)))
    expect(data.items[0].anchors.length).toBeGreaterThan(0)
    expect(data.items[0].anchors[0].anchor.lineStart).toBe(2)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd packages/opencode && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test test/python/toolbelt-doc-quote-anchor.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

Add `packages/opencode/src/python/scripts/doc-quote-anchor.py` with safe pointer resolution, substring + fuzzy matching (SequenceMatcher) and line mapping, size guardrails, and deterministic anchor sorting.

**Step 4: Run test to verify it passes**

Run: `cd packages/opencode && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test test/python/toolbelt-doc-quote-anchor.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/opencode/src/python/scripts/doc-quote-anchor.py packages/opencode/test/python/toolbelt-doc-quote-anchor.test.ts
 git commit -m "feat: add doc-quote-anchor toolbelt script"
```

### Task 3: Add TDD fixtures + failing tests for table-check

**Files:**
- Create: `packages/opencode/test/python/toolbelt-table-check.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { stableJson } from "../../src/util/stable-json"

const sha256 = (text: string) => {
  const hash = new Bun.CryptoHasher("sha256")
  hash.update(text)
  return hash.digest("hex")
}

describe("toolbelt.table-check", () => {
  test("computes expr with Decimal and detects mismatch", async () => {
    const python = Bun.which("python3")
    if (!python) return
    const script = path.join(__dirname, "../../src/python/scripts/table-check.py")
    await using tmp = await tmpdir({})
    const sessionId = "session-3"
    const root = path.join(tmp.path, ".opencode", "artifacts", sessionId)
    const derived = path.join(root, "derived", "input-3")
    const textPath = path.join(derived, "numbers.txt")
    await Bun.write(textPath, "10\n20\n")
    const input = {
      specVersion: "table-check/1.0",
      policyVersion: "v1",
      cases: [
        {
          title: "sum",
          inputs: [{ pointer: { path: "derived/input-3/numbers.txt" } }],
          checks: [{ kind: "expr", expr: "input0 * 2", expected: "50" }],
        },
      ],
    }
    const inputPath = path.join(root, "python", "input.json")
    const outputPath = path.join(root, "python", "output.json")
    await Bun.write(inputPath, JSON.stringify(input))
    await $`${python} ${script} --input ${inputPath} --output ${outputPath}`.quiet()
    const data = JSON.parse(await Bun.file(outputPath).text())
    expect(data.cacheKey).toBe(sha256(stableJson(input)))
    expect(data.summary.mismatches).toBe(1)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd packages/opencode && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test test/python/toolbelt-table-check.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

Add `packages/opencode/src/python/scripts/table-check.py` with safe path resolution, number extraction, Decimal arithmetic, safe AST eval for expr, and deterministic output.

**Step 4: Run test to verify it passes**

Run: `cd packages/opencode && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test test/python/toolbelt-table-check.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/opencode/src/python/scripts/table-check.py packages/opencode/test/python/toolbelt-table-check.test.ts
 git commit -m "feat: add table-check toolbelt script"
```

### Task 4: Add TDD fixtures + failing tests for redaction-scan

**Files:**
- Create: `packages/opencode/test/python/toolbelt-redaction-scan.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { stableJson } from "../../src/util/stable-json"

const sha256 = (text: string) => {
  const hash = new Bun.CryptoHasher("sha256")
  hash.update(text)
  return hash.digest("hex")
}

describe("toolbelt.redaction-scan", () => {
  test("finds pii without leaking raw value", async () => {
    const python = Bun.which("python3")
    if (!python) return
    const script = path.join(__dirname, "../../src/python/scripts/redaction-scan.py")
    await using tmp = await tmpdir({})
    const sessionId = "session-4"
    const root = path.join(tmp.path, ".opencode", "artifacts", sessionId)
    const derived = path.join(root, "derived", "input-4")
    const textPath = path.join(derived, "pii.txt")
    await Bun.write(textPath, "email test@example.com ok")
    const input = {
      specVersion: "redaction-scan/1.0",
      policyVersion: "v1",
      pointers: [{ path: "derived/input-4/pii.txt" }],
      rules: { pii: true, secrets: true },
    }
    const inputPath = path.join(root, "python", "input.json")
    const outputPath = path.join(root, "python", "output.json")
    await Bun.write(inputPath, JSON.stringify(input))
    await $`${python} ${script} --input ${inputPath} --output ${outputPath}`.quiet()
    const data = JSON.parse(await Bun.file(outputPath).text())
    expect(data.cacheKey).toBe(sha256(stableJson(input)))
    expect(data.findings.length).toBeGreaterThan(0)
    expect(data.findings[0].sample_redacted.includes("@"))
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd packages/opencode && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test test/python/toolbelt-redaction-scan.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

Add `packages/opencode/src/python/scripts/redaction-scan.py` with safe path resolution, regex-based scanning, masked samples, and deterministic output ordering.

**Step 4: Run test to verify it passes**

Run: `cd packages/opencode && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test test/python/toolbelt-redaction-scan.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/opencode/src/python/scripts/redaction-scan.py packages/opencode/test/python/toolbelt-redaction-scan.test.ts
 git commit -m "feat: add redaction-scan toolbelt script"
```

### Task 5: Update manifest + registry coverage

**Files:**
- Modify: `packages/opencode/src/python/scripts.manifest.json`
- Modify: `packages/opencode/test/python/manifest.test.ts`

**Step 1: Write failing test**

```ts
import { describe, expect, test } from "bun:test"
import { ScriptRegistry } from "../../src/python/registry"

const scriptIds = ["citation-check", "doc-quote-anchor", "table-check", "redaction-scan"]

describe("python.toolbelt manifest", () => {
  test("manifest includes toolbelt scripts", async () => {
    const manifest = await ScriptRegistry.manifest()
    for (const id of scriptIds) {
      const entry = manifest.find((item) => item.id === id)
      expect(entry).toBeDefined()
      expect(entry!.sha256.length).toBe(64)
      expect(entry!.path.endsWith(".py")).toBe(true)
    }
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd packages/opencode && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test test/python/manifest.test.ts`
Expected: FAIL

**Step 3: Update manifest + recompute sha256**

Add the four scripts to the manifest with correct sha256.

**Step 4: Run test to verify it passes**

Run: `cd packages/opencode && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test test/python/manifest.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/opencode/src/python/scripts.manifest.json packages/opencode/test/python/manifest.test.ts
 git commit -m "chore: add toolbelt scripts to manifest"
```

### Task 6: Full test run

**Step 1: Run tests**

Run: `cd packages/opencode && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test`
Expected: PASS

**Step 2: Final commit (if needed)**

```bash
git status -sb
```

If anything remains uncommitted, add and commit with a clear message.
