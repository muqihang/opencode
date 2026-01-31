# Task 12 Doc Processing Scripts Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add built-in Python doc processing scripts (PDF text extraction, archive unpack, OCR stub), update the script manifest with sha256, and add tests that validate registry + script contract.

**Architecture:** Each script reads a JSON input file (`--input`) that includes `input_path`, `output_dir`, and `input_id`. The script writes derived artifacts under `output_dir` (which should be `.opencode/artifacts/<sessionId>/derived/<inputId>/...`) and always emits a structured JSON result to `--output` with `ok`, `type`, `input`, `artifacts`, and `error` (when applicable). PDF extraction uses `pdftotext` if available; OCR is a stub that returns a structured “unavailable” result.

**Tech Stack:** Bun tests, TypeScript, Python 3 standard library

---

### Task 1: Add failing tests for doc scripts (manifest + registry + contract)

**Files:**
- Create: `packages/opencode/test/python/doc-scripts.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import path from "path"
import { ScriptRegistry } from "../../src/python/registry"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

const scriptIds = ["doc-extract-pdf-text", "doc-unpack-archive", "doc-ocr-image"]

describe("python.doc scripts", () => {
  test("manifest includes doc scripts", async () => {
    const manifest = await ScriptRegistry.manifest()
    for (const id of scriptIds) {
      const entry = manifest.find((item) => item.id === id)
      expect(entry).toBeDefined()
      expect(entry!.sha256.length).toBe(64)
      expect(entry!.path.endsWith(".py")).toBe(true)
    }
  })

  test("registry resolves doc scripts", async () => {
    await Instance.provide({
      directory: path.join(__dirname, "../.."),
      fn: async () => {
        for (const id of scriptIds) {
          const script = await ScriptRegistry.resolve({ scriptId: id })
          expect(script.id).toBe(id)
          expect(script.sha256.length).toBe(64)
          expect(script.path.endsWith(`${id}.py`)).toBe(true)
        }
      },
    })
  })

  test("doc-unpack-archive contract", async () => {
    const python = Bun.which("python3")
    if (!python) return
    const script = path.join(__dirname, "../../src/python/scripts/doc-unpack-archive.py")
    await using tmp = await tmpdir({})
    const source = path.join(tmp.path, "source.txt")
    await Bun.write(source, "hello")
    const archive = path.join(tmp.path, "archive.tar")
    await $`tar -cf ${archive} -C ${tmp.path} source.txt`.quiet()
    const outputDir = path.join(tmp.path, "derived", "input-1")
    const input = path.join(tmp.path, "input.json")
    const output = path.join(tmp.path, "output.json")
    await Bun.write(
      input,
      JSON.stringify({ input_path: archive, output_dir: outputDir, input_id: "input-1" }),
    )
    await $`${python} ${script} --input ${input} --output ${output}`.quiet()
    const data = JSON.parse(await Bun.file(output).text())
    expect(data.type).toBe("doc.unpack_archive")
    expect(data.ok).toBe(true)
    const extracted = path.join(outputDir, "unpacked", "source.txt")
    const exists = await Bun.file(extracted).exists()
    expect(exists).toBe(true)
    expect(Array.isArray(data.artifacts)).toBe(true)
  })

  test("doc-extract-pdf-text contract", async () => {
    const python = Bun.which("python3")
    if (!python) return
    const script = path.join(__dirname, "../../src/python/scripts/doc-extract-pdf-text.py")
    await using tmp = await tmpdir({})
    const source = path.join(tmp.path, "sample.pdf")
    await Bun.write(source, "not a real pdf")
    const outputDir = path.join(tmp.path, "derived", "input-2")
    const input = path.join(tmp.path, "input.json")
    const output = path.join(tmp.path, "output.json")
    await Bun.write(
      input,
      JSON.stringify({ input_path: source, output_dir: outputDir, input_id: "input-2" }),
    )
    await $`${python} ${script} --input ${input} --output ${output}`.quiet()
    const data = JSON.parse(await Bun.file(output).text())
    expect(data.type).toBe("doc.extract_pdf_text")
    expect(typeof data.ok).toBe("boolean")
    if (data.ok) {
      expect(Array.isArray(data.artifacts)).toBe(true)
    }
    if (!data.ok) {
      expect(data.error).toBeDefined()
    }
  })

  test("doc-ocr-image stub contract", async () => {
    const python = Bun.which("python3")
    if (!python) return
    const script = path.join(__dirname, "../../src/python/scripts/doc-ocr-image.py")
    await using tmp = await tmpdir({})
    const source = path.join(tmp.path, "sample.png")
    await Bun.write(source, "fake")
    const outputDir = path.join(tmp.path, "derived", "input-3")
    const input = path.join(tmp.path, "input.json")
    const output = path.join(tmp.path, "output.json")
    await Bun.write(
      input,
      JSON.stringify({ input_path: source, output_dir: outputDir, input_id: "input-3" }),
    )
    await $`${python} ${script} --input ${input} --output ${output}`.quiet()
    const data = JSON.parse(await Bun.file(output).text())
    expect(data.type).toBe("doc.ocr_image")
    expect(data.ok).toBe(false)
    expect(data.error?.code).toBe("ocr_unavailable")
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd packages/opencode && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test test/python/doc-scripts.test.ts`
Expected: FAIL (scripts/manifest missing).

---

### Task 2: Implement scripts + update manifest

**Files:**
- Add: `packages/opencode/src/python/scripts/doc-extract-pdf-text.py`
- Add: `packages/opencode/src/python/scripts/doc-unpack-archive.py`
- Add: `packages/opencode/src/python/scripts/doc-ocr-image.py`
- Update: `packages/opencode/src/python/scripts.manifest.json`

**Step 1: Write minimal implementation**

`packages/opencode/src/python/scripts/doc-extract-pdf-text.py`

```python
#!/usr/bin/env python3

import argparse
import hashlib
import json
import os
import shutil
import subprocess
from typing import Any, Dict, List


def sha256_bytes(data: bytes) -> str:
  digest = hashlib.sha256()
  digest.update(data)
  return digest.hexdigest()


def sha256_file(path: str) -> str:
  with open(path, "rb") as f:
    return sha256_bytes(f.read())


def write_json(path: str, data: Dict[str, Any]) -> None:
  with open(path, "w", encoding="utf-8") as f:
    json.dump(data, f)


def ensure_dir(path: str) -> None:
  os.makedirs(path, exist_ok=True)


def read_input(path: str) -> Dict[str, Any]:
  with open(path, "r", encoding="utf-8") as f:
    return json.load(f)


def error_result(kind: str, input_path: str, input_id: str, message: str, code: str, hint: str, artifact: str) -> Dict[str, Any]:
  return {
    "ok": False,
    "type": kind,
    "input": {"path": input_path, "id": input_id},
    "error": {"code": code, "message": message, "hint": hint},
    "artifacts": [
      {"path": artifact, "sha256": sha256_file(artifact), "kind": "error"},
    ],
  }


def main() -> None:
  parser = argparse.ArgumentParser()
  parser.add_argument("--input", required=True)
  parser.add_argument("--output", required=True)
  args = parser.parse_args()

  kind = "doc.extract_pdf_text"

  try:
    payload = read_input(args.input)
    input_path = str(payload.get("input_path", ""))
    output_dir = str(payload.get("output_dir", ""))
    input_id = str(payload.get("input_id", ""))
    if not input_path or not output_dir or not input_id:
      result = {
        "ok": False,
        "type": kind,
        "input": {"path": input_path, "id": input_id},
        "error": {"code": "invalid_input", "message": "input_path/output_dir/input_id are required"},
        "artifacts": [],
      }
      write_json(args.output, result)
      return

    ensure_dir(output_dir)

    tool = shutil.which("pdftotext")
    if not tool:
      error_path = os.path.join(output_dir, "pdf.extract.error.json")
      write_json(
        error_path,
        {"error": "pdftotext not available", "hint": "install poppler utils or enable OCR pipeline"},
      )
      result = error_result(
        kind,
        input_path,
        input_id,
        "pdftotext not available",
        "dependency_unavailable",
        "install poppler utils or enable OCR pipeline",
        error_path,
      )
      write_json(args.output, result)
      return

    text_path = os.path.join(output_dir, "text.txt")
    proc = subprocess.run([tool, input_path, text_path], capture_output=True)
    if proc.returncode != 0 or not os.path.exists(text_path):
      message = proc.stderr.decode("utf-8").strip() or proc.stdout.decode("utf-8").strip() or f"pdftotext exit {proc.returncode}"
      error_path = os.path.join(output_dir, "pdf.extract.error.json")
      write_json(error_path, {"error": message, "hint": "pdftotext failed"})
      result = error_result(
        kind,
        input_path,
        input_id,
        message,
        "extract_failed",
        "pdftotext failed",
        error_path,
      )
      write_json(args.output, result)
      return

    text_sha = sha256_file(text_path)
    meta_path = os.path.join(output_dir, "pdf.extract.meta.json")
    write_json(
      meta_path,
      {
        "input": input_path,
        "text_path": text_path,
        "text_sha256": text_sha,
        "tool": "pdftotext",
      },
    )
    result = {
      "ok": True,
      "type": kind,
      "input": {"path": input_path, "id": input_id},
      "artifacts": [
        {"path": text_path, "sha256": text_sha, "kind": "text"},
        {"path": meta_path, "sha256": sha256_file(meta_path), "kind": "meta"},
      ],
    }
    write_json(args.output, result)
  except Exception as exc:
    result = {
      "ok": False,
      "type": kind,
      "input": {"path": "", "id": ""},
      "error": {"code": "exception", "message": str(exc)},
      "artifacts": [],
    }
    write_json(args.output, result)


if __name__ == "__main__":
  main()
```

`packages/opencode/src/python/scripts/doc-unpack-archive.py`

```python
#!/usr/bin/env python3

import argparse
import hashlib
import json
import os
import tarfile
import zipfile
from typing import Any, Dict, List, Tuple


def sha256_bytes(data: bytes) -> str:
  digest = hashlib.sha256()
  digest.update(data)
  return digest.hexdigest()


def sha256_file(path: str) -> str:
  with open(path, "rb") as f:
    return sha256_bytes(f.read())


def write_json(path: str, data: Dict[str, Any]) -> None:
  with open(path, "w", encoding="utf-8") as f:
    json.dump(data, f)


def ensure_dir(path: str) -> None:
  os.makedirs(path, exist_ok=True)


def read_input(path: str) -> Dict[str, Any]:
  with open(path, "r", encoding="utf-8") as f:
    return json.load(f)


def safe_join(base: str, name: str) -> str:
  target = os.path.abspath(os.path.join(base, name))
  if not target.startswith(os.path.abspath(base) + os.sep):
    raise ValueError("path traversal detected")
  return target


def extract_zip(source: str, dest: str) -> List[str]:
  files: List[str] = []
  with zipfile.ZipFile(source) as zf:
    for info in zf.infolist():
      if info.is_dir():
        continue
      target = safe_join(dest, info.filename)
      ensure_dir(os.path.dirname(target))
      with zf.open(info) as src:
        data = src.read()
      with open(target, "wb") as out:
        out.write(data)
      files.append(target)
  return files


def extract_tar(source: str, dest: str) -> List[str]:
  files: List[str] = []
  with tarfile.open(source, "r:*") as tf:
    for member in tf.getmembers():
      if not member.isfile():
        continue
      target = safe_join(dest, member.name)
      ensure_dir(os.path.dirname(target))
      data = tf.extractfile(member)
      if not data:
        continue
      with open(target, "wb") as out:
        out.write(data.read())
      files.append(target)
  return files


def main() -> None:
  parser = argparse.ArgumentParser()
  parser.add_argument("--input", required=True)
  parser.add_argument("--output", required=True)
  args = parser.parse_args()

  kind = "doc.unpack_archive"

  try:
    payload = read_input(args.input)
    input_path = str(payload.get("input_path", ""))
    output_dir = str(payload.get("output_dir", ""))
    input_id = str(payload.get("input_id", ""))
    if not input_path or not output_dir or not input_id:
      result = {
        "ok": False,
        "type": kind,
        "input": {"path": input_path, "id": input_id},
        "error": {"code": "invalid_input", "message": "input_path/output_dir/input_id are required"},
        "artifacts": [],
      }
      write_json(args.output, result)
      return

    unpack_dir = os.path.join(output_dir, "unpacked")
    ensure_dir(unpack_dir)

    files: List[str] = []
    if input_path.endswith(".zip"):
      files = extract_zip(input_path, unpack_dir)
    if not files and (
      input_path.endswith(".tar")
      or input_path.endswith(".tar.gz")
      or input_path.endswith(".tgz")
    ):
      files = extract_tar(input_path, unpack_dir)

    if not files:
      error_path = os.path.join(unpack_dir, "unpack.error.json")
      write_json(error_path, {"error": "unsupported or empty archive", "input": input_path})
      result = {
        "ok": False,
        "type": kind,
        "input": {"path": input_path, "id": input_id},
        "error": {"code": "unpack_failed", "message": "unsupported or empty archive"},
        "artifacts": [
          {"path": error_path, "sha256": sha256_file(error_path), "kind": "error"},
        ],
      }
      write_json(args.output, result)
      return

    entries: List[Dict[str, str]] = []
    for file in files:
      rel = os.path.relpath(file, unpack_dir).replace("\\", "/")
      entries.append({"path": rel, "sha256": sha256_file(file)})
    entries.sort(key=lambda item: item["path"])

    list_path = os.path.join(unpack_dir, "filelist.json")
    write_json(list_path, entries)

    artifacts = [
      {"path": list_path, "sha256": sha256_file(list_path), "kind": "filelist"},
    ]
    for entry in entries:
      artifacts.append(
        {
          "path": os.path.join(unpack_dir, entry["path"]),
          "sha256": entry["sha256"],
          "kind": "file",
        }
      )

    result = {
      "ok": True,
      "type": kind,
      "input": {"path": input_path, "id": input_id},
      "artifacts": artifacts,
      "files": entries,
    }
    write_json(args.output, result)
  except Exception as exc:
    result = {
      "ok": False,
      "type": kind,
      "input": {"path": "", "id": ""},
      "error": {"code": "exception", "message": str(exc)},
      "artifacts": [],
    }
    write_json(args.output, result)


if __name__ == "__main__":
  main()
```

`packages/opencode/src/python/scripts/doc-ocr-image.py`

```python
#!/usr/bin/env python3

import argparse
import hashlib
import json
import os
from typing import Any, Dict


def sha256_bytes(data: bytes) -> str:
  digest = hashlib.sha256()
  digest.update(data)
  return digest.hexdigest()


def sha256_file(path: str) -> str:
  with open(path, "rb") as f:
    return sha256_bytes(f.read())


def write_json(path: str, data: Dict[str, Any]) -> None:
  with open(path, "w", encoding="utf-8") as f:
    json.dump(data, f)


def ensure_dir(path: str) -> None:
  os.makedirs(path, exist_ok=True)


def read_input(path: str) -> Dict[str, Any]:
  with open(path, "r", encoding="utf-8") as f:
    return json.load(f)


def main() -> None:
  parser = argparse.ArgumentParser()
  parser.add_argument("--input", required=True)
  parser.add_argument("--output", required=True)
  args = parser.parse_args()

  kind = "doc.ocr_image"

  try:
    payload = read_input(args.input)
    input_path = str(payload.get("input_path", ""))
    output_dir = str(payload.get("output_dir", ""))
    input_id = str(payload.get("input_id", ""))
    if not input_path or not output_dir or not input_id:
      result = {
        "ok": False,
        "type": kind,
        "input": {"path": input_path, "id": input_id},
        "error": {"code": "invalid_input", "message": "input_path/output_dir/input_id are required"},
        "artifacts": [],
      }
      write_json(args.output, result)
      return

    ensure_dir(output_dir)
    error_path = os.path.join(output_dir, "ocr.error.json")
    write_json(
      error_path,
      {
        "error": "OCR not available",
        "code": "ocr_unavailable",
        "hint": "Requires local OCR (tesseract) or approved cloud OCR policy",
      },
    )
    result = {
      "ok": False,
      "type": kind,
      "input": {"path": input_path, "id": input_id},
      "error": {"code": "ocr_unavailable", "message": "OCR not available"},
      "artifacts": [
        {"path": error_path, "sha256": sha256_file(error_path), "kind": "error"},
      ],
    }
    write_json(args.output, result)
  except Exception as exc:
    result = {
      "ok": False,
      "type": kind,
      "input": {"path": "", "id": ""},
      "error": {"code": "exception", "message": str(exc)},
      "artifacts": [],
    }
    write_json(args.output, result)


if __name__ == "__main__":
  main()
```

**Step 2: Update manifest with sha256**

Run:
```
cd packages/opencode
shasum -a 256 src/python/scripts/doc-extract-pdf-text.py
shasum -a 256 src/python/scripts/doc-unpack-archive.py
shasum -a 256 src/python/scripts/doc-ocr-image.py
```

Then update `packages/opencode/src/python/scripts.manifest.json` with entries:

```json
{
  "id": "doc-extract-pdf-text",
  "path": "scripts/doc-extract-pdf-text.py",
  "sha256": "<sha256>"
}
```

```json
{
  "id": "doc-unpack-archive",
  "path": "scripts/doc-unpack-archive.py",
  "sha256": "<sha256>"
}
```

```json
{
  "id": "doc-ocr-image",
  "path": "scripts/doc-ocr-image.py",
  "sha256": "<sha256>"
}
```

**Step 3: Run tests to verify pass**

Run: `cd packages/opencode && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test test/python/doc-scripts.test.ts`
Expected: PASS.

---

### Task 3: Verify full python test subset

**Step 1: Run python tests**

Run: `cd packages/opencode && BUN_INSTALL=/tmp/bun-install TMPDIR=/tmp bun test test/python/...`
Expected: PASS.
