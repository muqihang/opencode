#!/usr/bin/env python3

import argparse
import hashlib
import json
import os
import stat as stat_module
from typing import Any, Dict, List, Optional, Tuple


def sha256_bytes(data: bytes) -> str:
  digest = hashlib.sha256()
  digest.update(data)
  return digest.hexdigest()


def sha256_text(text: str) -> str:
  return sha256_bytes(text.encode("utf-8"))


def sha256_file(path: str) -> str:
  with open(path, "rb") as f:
    return sha256_bytes(f.read())


def stable_normalize(value: Any) -> Any:
  if value is None:
    return None
  if isinstance(value, bool):
    return value
  if isinstance(value, str):
    return value
  if isinstance(value, (int, float)):
    return value
  if isinstance(value, list):
    return [stable_normalize(item) for item in value]
  if isinstance(value, dict):
    result: Dict[str, Any] = {}
    for key in sorted(value.keys()):
      result[key] = stable_normalize(value[key])
    return result
  return str(value)


def stable_json(value: Any) -> str:
  normalized = stable_normalize(value)
  return json.dumps(normalized, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def write_json(path: str, data: Dict[str, Any]) -> None:
  with open(path, "w", encoding="utf-8") as f:
    f.write(stable_json(data))


def read_json(path: str) -> Any:
  with open(path, "r", encoding="utf-8") as f:
    return json.load(f)


def session_root(input_path: str) -> str:
  return os.path.dirname(os.path.dirname(os.path.abspath(input_path)))


def has_symlink(base: str, target: str) -> bool:
  rel = os.path.relpath(target, base)
  parts = [part for part in rel.split(os.sep) if part]
  current = base
  for part in parts:
    current = os.path.join(current, part)
    try:
      info = os.lstat(current)
    except FileNotFoundError:
      continue
    if os.path.islink(current) or stat_module.S_ISLNK(info.st_mode):
      return True
  return False


def safe_resolve(root: str, rel: str) -> Tuple[bool, Optional[str], str]:
  if os.path.isabs(rel):
    return False, None, "absolute_path"
  parts = rel.replace("\\", "/").split("/")
  if ".." in parts:
    return False, None, "traversal"
  target = os.path.abspath(os.path.join(root, rel))
  try:
    common = os.path.commonpath([root, target])
  except ValueError:
    return False, None, "outside_root"
  if common != root:
    return False, None, "outside_root"
  if has_symlink(root, target):
    return False, None, "symlink"
  return True, target, ""


def anchor_kind(anchor: Any) -> Optional[str]:
  if not isinstance(anchor, dict):
    return None
  if "page" in anchor and ("lineStart" in anchor or "line_start" in anchor):
    return "pdf_page_line"
  if "lineStart" in anchor or "line_start" in anchor:
    return "line_range"
  if "paragraphIndex" in anchor or "paragraph_index" in anchor:
    return "docx_paragraph"
  if "chunkIndex" in anchor or "chunk_index" in anchor:
    return "chunk"
  return None


def anchor_signature(anchor: Any) -> str:
  if not isinstance(anchor, dict):
    return ""
  return stable_json(anchor)


def line_bounds(anchor: Dict[str, Any]) -> Tuple[Optional[int], Optional[int]]:
  start = anchor.get("lineStart", anchor.get("line_start"))
  end = anchor.get("lineEnd", anchor.get("line_end"))
  if not isinstance(start, int) or not isinstance(end, int):
    return None, None
  return start, end


def read_text_lines(path: str, size_limit: int) -> Tuple[Optional[List[str]], Optional[str]]:
  try:
    if os.path.getsize(path) > size_limit:
      return None, "file_too_large"
  except OSError:
    return None, "stat_failed"
  try:
    with open(path, "r", encoding="utf-8") as f:
      text = f.read()
  except Exception:
    return None, "read_failed"
  lines = text.splitlines()
  return lines, None


def validate_anchor(target: str, anchor: Any, size_limit: int) -> Tuple[str, Optional[str]]:
  kind = anchor_kind(anchor)
  if not kind:
    return "unknown", "unrecognized_anchor"
  if kind == "line_range":
    if not isinstance(anchor, dict):
      return "unknown", "invalid_anchor"
    start, end = line_bounds(anchor)
    if start is None or end is None:
      return "anchor_invalid", "missing_line_bounds"
    lines, error = read_text_lines(target, size_limit)
    if error:
      return "unknown", error
    if not lines:
      return "anchor_invalid", "empty_file"
    if start < 1 or end < start or end > len(lines):
      return "anchor_invalid", "line_out_of_range"
    return "ok", None
  if kind == "pdf_page_line":
    if not isinstance(anchor, dict):
      return "unknown", "invalid_anchor"
    page = anchor.get("page")
    start, end = line_bounds(anchor)
    if not isinstance(page, int) or start is None or end is None:
      return "anchor_invalid", "missing_page_bounds"
    if not target.endswith("pdf.pages.json"):
      return "unknown", "unsupported_target"
    try:
      pages_doc = read_json(target)
    except Exception:
      return "unknown", "pages_read_failed"
    pages = pages_doc.get("pages", []) if isinstance(pages_doc, dict) else []
    entry = next((item for item in pages if item.get("page_number") == page), None)
    if not entry:
      return "anchor_invalid", "page_not_found"
    text_rel = entry.get("text_path")
    if not isinstance(text_rel, str):
      return "unknown", "text_path_missing"
    page_text = os.path.join(os.path.dirname(target), text_rel)
    lines, error = read_text_lines(page_text, size_limit)
    if error:
      return "unknown", error
    if not lines:
      return "anchor_invalid", "empty_page"
    if start < 1 or end < start or end > len(lines):
      return "anchor_invalid", "line_out_of_range"
    return "ok", None
  if kind == "docx_paragraph":
    if not target.endswith("docx.structure.json"):
      return "unknown", "unsupported_target"
    if not isinstance(anchor, dict):
      return "unknown", "invalid_anchor"
    index = anchor.get("paragraphIndex", anchor.get("paragraph_index"))
    if not isinstance(index, int):
      return "anchor_invalid", "missing_paragraph_index"
    try:
      doc = read_json(target)
    except Exception:
      return "unknown", "structure_read_failed"
    count = doc.get("paragraphCount") if isinstance(doc, dict) else None
    if not isinstance(count, int):
      return "unknown", "paragraph_count_missing"
    if index < 0 or index >= count:
      return "anchor_invalid", "paragraph_out_of_range"
    return "ok", None
  if kind == "chunk":
    if not target.endswith("chunks.json"):
      return "unknown", "unsupported_target"
    if not isinstance(anchor, dict):
      return "unknown", "invalid_anchor"
    index = anchor.get("chunkIndex", anchor.get("chunk_index"))
    if not isinstance(index, int):
      return "anchor_invalid", "missing_chunk_index"
    try:
      chunks = read_json(target)
    except Exception:
      return "unknown", "chunks_read_failed"
    if not isinstance(chunks, list):
      return "unknown", "chunks_invalid"
    found = any(item.get("chunk_index") == index for item in chunks if isinstance(item, dict))
    if not found:
      return "anchor_invalid", "chunk_not_found"
    return "ok", None
  return "unknown", "unsupported_anchor"


def build_view(summary: Dict[str, Any], items: List[Dict[str, Any]]) -> str:
  lines = ["# Citation Check", "", f"Total: {summary.get('total', 0)}", ""]
  for item in items:
    pointer = item.get("pointer", {})
    path = pointer.get("path", "")
    status = item.get("status", "")
    reason = item.get("reason")
    suffix = f" ({reason})" if reason else ""
    lines.append(f"- {path}: {status}{suffix}")
  return "\n".join(lines) + "\n"


def main() -> None:
  parser = argparse.ArgumentParser()
  parser.add_argument("--input", required=True)
  parser.add_argument("--output", required=True)
  args = parser.parse_args()

  output_spec = "citation-check/1.0"
  view_path = None
  try:
    raw_input = read_json(args.input)
  except Exception:
    cache_key = sha256_text(stable_json({"error": "invalid_json"}))
    result = {
      "specVersion": output_spec,
      "policyVersion": "unknown",
      "cacheKey": cache_key,
      "ok": False,
      "summary": {"total": 0, "ok": 0, "missing": 0, "hash_mismatch": 0, "anchor_invalid": 0, "unknown": 0, "invalid_path": 0},
      "items": [],
      "error": {"code": "invalid_json", "message": "input json parse failed"},
      "viewMarkdown": "# Citation Check\n\nError: invalid_json\n",
    }
    write_json(args.output, result)
    return

  cache_key = sha256_text(stable_json(raw_input))
  spec_version = raw_input.get("specVersion") if isinstance(raw_input, dict) else output_spec
  policy_version = raw_input.get("policyVersion") if isinstance(raw_input, dict) else "unknown"
  pointers = raw_input.get("pointers") if isinstance(raw_input, dict) else None
  if not isinstance(spec_version, str) or not isinstance(policy_version, str) or not isinstance(pointers, list):
    result = {
      "specVersion": output_spec,
      "policyVersion": policy_version if isinstance(policy_version, str) else "unknown",
      "cacheKey": cache_key,
      "ok": False,
      "summary": {"total": 0, "ok": 0, "missing": 0, "hash_mismatch": 0, "anchor_invalid": 0, "unknown": 0, "invalid_path": 0},
      "items": [],
      "error": {"code": "invalid_input", "message": "specVersion/policyVersion/pointers required"},
      "viewMarkdown": "# Citation Check\n\nError: invalid_input\n",
    }
    write_json(args.output, result)
    return

  root = session_root(args.input)
  size_limit = 2 * 1024 * 1024
  items: List[Dict[str, Any]] = []
  counts = {"total": 0, "ok": 0, "missing": 0, "hash_mismatch": 0, "anchor_invalid": 0, "unknown": 0, "invalid_path": 0}

  for pointer in pointers:
    if not isinstance(pointer, dict):
      continue
    rel = pointer.get("path")
    if not isinstance(rel, str):
      continue
    counts["total"] += 1
    safe, target, reason = safe_resolve(root, rel)
    if not safe or not target:
      status = "invalid_path"
      counts["invalid_path"] += 1
      items.append({"pointer": pointer, "status": status, "reason": reason})
      continue
    if not os.path.exists(target):
      status = "missing"
      counts["missing"] += 1
      items.append({"pointer": pointer, "status": status, "reason": "not_found"})
      continue
    expected = pointer.get("sha256")
    if isinstance(expected, str):
      actual = sha256_file(target)
      if actual.lower() != expected.lower():
        status = "hash_mismatch"
        counts["hash_mismatch"] += 1
        items.append({"pointer": pointer, "status": status, "reason": "sha256_mismatch"})
        continue
    anchor = pointer.get("anchor")
    if anchor is not None:
      anchor_status, anchor_reason = validate_anchor(target, anchor, size_limit)
      if anchor_status == "anchor_invalid":
        counts["anchor_invalid"] += 1
        items.append({"pointer": pointer, "status": "anchor_invalid", "reason": anchor_reason})
        continue
      if anchor_status == "unknown":
        counts["unknown"] += 1
        items.append({"pointer": pointer, "status": "unknown", "reason": anchor_reason})
        continue
    counts["ok"] += 1
    items.append({"pointer": pointer, "status": "ok"})

  items.sort(key=lambda item: (item.get("pointer", {}).get("path", ""), item.get("status", ""), anchor_signature(item.get("pointer", {}).get("anchor"))))

  ok = counts["total"] == counts["ok"]
  summary = counts
  view_markdown = build_view(summary, items)
  try:
    view_path = args.output + ".view.md"
    with open(view_path, "w", encoding="utf-8") as f:
      f.write(view_markdown)
  except Exception:
    view_path = None

  result = {
    "specVersion": output_spec,
    "policyVersion": policy_version,
    "cacheKey": cache_key,
    "ok": ok,
    "summary": summary,
    "items": items,
    "viewMarkdown": view_markdown,
  }
  if view_path:
    result["viewPath"] = view_path

  write_json(args.output, result)


if __name__ == "__main__":
  main()
