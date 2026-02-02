#!/usr/bin/env python3

import argparse
import hashlib
import json
import os
import stat as stat_module
from difflib import SequenceMatcher
from typing import Any, Dict, List, Optional, Tuple


def sha256_bytes(data: bytes) -> str:
  digest = hashlib.sha256()
  digest.update(data)
  return digest.hexdigest()


def sha256_text(text: str) -> str:
  return sha256_bytes(text.encode("utf-8"))


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
      normalized = stable_normalize(value[key])
      if normalized is not None:
        result[key] = normalized
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


def anchor_signature(anchor: Any) -> str:
  if not isinstance(anchor, dict):
    return ""
  return stable_json(anchor)


def read_text_with_guard(path: str, size_limit: int, line_limit: int) -> Tuple[Optional[str], Optional[str]]:
  try:
    if os.path.getsize(path) > size_limit:
      return None, "text_too_large"
  except OSError:
    return None, "stat_failed"
  try:
    with open(path, "r", encoding="utf-8") as f:
      text = f.read()
  except Exception:
    return None, "read_failed"
  if text.count("\n") > line_limit:
    return None, "line_too_large"
  return text, None


def line_number(offset: int, newline_positions: List[int]) -> int:
  lo = 0
  hi = len(newline_positions)
  while lo < hi:
    mid = (lo + hi) // 2
    if newline_positions[mid] < offset:
      lo = mid + 1
    else:
      hi = mid
  return lo + 1


def find_substrings(text: str, needle: str, limit: int) -> List[Tuple[int, int]]:
  results: List[Tuple[int, int]] = []
  start = 0
  while len(results) < limit:
    idx = text.find(needle, start)
    if idx < 0:
      break
    results.append((idx, idx + len(needle)))
    start = idx + len(needle)
  return results


def fuzzy_match(text: str, needle: str) -> Optional[Tuple[int, int, float]]:
  matcher = SequenceMatcher(None, needle, text)
  match = matcher.find_longest_match(0, len(needle), 0, len(text))
  if match.size == 0:
    return None
  ratio = match.size / max(1, len(needle))
  return match.b, match.b + match.size, ratio


def anchors_from_text(text: str, needle: str, top_k: int, size_limit: int) -> Tuple[List[Dict[str, Any]], Optional[str]]:
  if len(text.encode("utf-8")) > size_limit:
    return [], "text_too_large"
  newline_positions = [index for index, ch in enumerate(text) if ch == "\n"]
  candidates: List[Dict[str, Any]] = []

  for start, end in find_substrings(text, needle, top_k):
    line_start = line_number(start, newline_positions)
    line_end = line_number(end, newline_positions)
    candidates.append({
      "anchor": {"lineStart": line_start, "lineEnd": line_end},
      "score_bps": 10000,
      "method": "substring",
    })

  if len(candidates) >= top_k:
    return candidates, None

  fuzzy = fuzzy_match(text, needle)
  if not fuzzy:
    return candidates, None
  start, end, ratio = fuzzy
  if ratio < 0.6:
    return candidates, None
  line_start = line_number(start, newline_positions)
  line_end = line_number(end, newline_positions)
  candidates.append({
    "anchor": {"lineStart": line_start, "lineEnd": line_end},
    "score_bps": int(round(ratio * 10000)),
    "method": "fuzzy",
  })
  return candidates, None


def build_view(summary: Dict[str, Any], items: List[Dict[str, Any]]) -> str:
  lines = ["# Doc Quote Anchor", "", f"Total: {summary.get('total', 0)}", ""]
  for item in items:
    status = item.get("status", "")
    text = item.get("text", "")
    lines.append(f"- {status}: {text[:60]}")
  return "\n".join(lines) + "\n"


def main() -> None:
  parser = argparse.ArgumentParser()
  parser.add_argument("--input", required=True)
  parser.add_argument("--output", required=True)
  args = parser.parse_args()

  output_spec = "doc-quote-anchor/1.0"
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
      "summary": {"total": 0, "matched": 0, "unknown": 0, "invalid_path": 0},
      "items": [],
      "error": {"code": "invalid_json", "message": "input json parse failed"},
      "viewMarkdown": "# Doc Quote Anchor\n\nError: invalid_json\n",
    }
    write_json(args.output, result)
    return

  cache_key = sha256_text(stable_json(raw_input))
  spec_version = raw_input.get("specVersion") if isinstance(raw_input, dict) else output_spec
  policy_version = raw_input.get("policyVersion") if isinstance(raw_input, dict) else "unknown"
  quotes = raw_input.get("quotes") if isinstance(raw_input, dict) else None
  top_k = raw_input.get("topK") if isinstance(raw_input, dict) else None
  if not isinstance(top_k, int) or top_k < 1:
    top_k = 3
  if not isinstance(spec_version, str) or not isinstance(policy_version, str) or not isinstance(quotes, list):
    result = {
      "specVersion": output_spec,
      "policyVersion": policy_version if isinstance(policy_version, str) else "unknown",
      "cacheKey": cache_key,
      "ok": False,
      "summary": {"total": 0, "matched": 0, "unknown": 0, "invalid_path": 0},
      "items": [],
      "error": {"code": "invalid_input", "message": "specVersion/policyVersion/quotes required"},
      "viewMarkdown": "# Doc Quote Anchor\n\nError: invalid_input\n",
    }
    write_json(args.output, result)
    return

  root = session_root(args.input)
  size_limit = 2 * 1024 * 1024
  line_limit = 200000
  items: List[Dict[str, Any]] = []
  summary = {"total": 0, "matched": 0, "unknown": 0, "invalid_path": 0}

  for index, quote in enumerate(quotes):
    summary["total"] += 1
    if not isinstance(quote, dict):
      items.append({"quote_index": index, "text": "", "status": "unknown", "anchors": [], "reason": "invalid_quote"})
      summary["unknown"] += 1
      continue
    text = quote.get("text")
    source = quote.get("sourcePointer")
    if not isinstance(text, str) or not isinstance(source, dict):
      items.append({"quote_index": index, "text": text if isinstance(text, str) else "", "status": "unknown", "anchors": [], "reason": "missing_fields"})
      summary["unknown"] += 1
      continue
    rel = source.get("path")
    if not isinstance(rel, str):
      items.append({"quote_index": index, "text": text, "sourcePointer": source, "status": "unknown", "anchors": [], "reason": "missing_path"})
      summary["unknown"] += 1
      continue
    safe, target, reason = safe_resolve(root, rel)
    if not safe or not target:
      items.append({"quote_index": index, "text": text, "sourcePointer": source, "status": "invalid_path", "anchors": [], "reason": reason})
      summary["invalid_path"] += 1
      continue
    if not os.path.exists(target):
      items.append({"quote_index": index, "text": text, "sourcePointer": source, "status": "unknown", "anchors": [], "reason": "not_found"})
      summary["unknown"] += 1
      continue

    anchors: List[Dict[str, Any]] = []
    if target.endswith("pdf.pages.json"):
      pages_doc = read_json(target)
      pages = pages_doc.get("pages", []) if isinstance(pages_doc, dict) else []
      for page in pages:
        if not isinstance(page, dict):
          continue
        text_rel = page.get("text_path")
        page_no = page.get("page_number")
        if not isinstance(text_rel, str) or not isinstance(page_no, int):
          continue
        page_path = os.path.join(os.path.dirname(target), text_rel)
        page_text, error = read_text_with_guard(page_path, size_limit, line_limit)
        if error:
          continue
        found, _ = anchors_from_text(page_text, text, top_k, size_limit)
        for item in found:
          anchor = item["anchor"]
          anchor["page"] = page_no
          anchors.append(item)
    elif target.endswith("docx.structure.json"):
      text_path = os.path.join(os.path.dirname(target), "text.txt")
      text_data, error = read_text_with_guard(text_path, size_limit, line_limit)
      if error:
        anchors = []
      else:
        lines = text_data.splitlines()
        for idx, line in enumerate(lines):
          if text in line:
            anchors.append({
              "anchor": {"paragraphIndex": idx},
              "score_bps": 10000,
              "method": "substring",
            })
            if len(anchors) >= top_k:
              break
        if len(anchors) < top_k:
          joined = "\n".join(lines)
          found, _ = anchors_from_text(joined, text, 1, size_limit)
          for item in found:
            anchors.append({
              "anchor": {"paragraphIndex": item["anchor"]["lineStart"] - 1},
              "score_bps": item["score_bps"],
              "method": item["method"],
            })
    elif target.endswith("chunks.json"):
      text_path = os.path.join(os.path.dirname(target), "text.txt")
      text_data, error = read_text_with_guard(text_path, size_limit, line_limit)
      if error:
        anchors = []
      else:
        found, _ = anchors_from_text(text_data, text, top_k, size_limit)
        chunks = read_json(target)
        if isinstance(chunks, list):
          for item in found:
            anchor = item["anchor"]
            offset = anchor["lineStart"]
            line_offset = 0
            for idx, line in enumerate(text_data.splitlines()):
              if idx + 1 == anchor["lineStart"]:
                break
              line_offset += len(line) + 1
            match_start = line_offset
            chunk_index = None
            for chunk in chunks:
              if not isinstance(chunk, dict):
                continue
              start = chunk.get("start")
              end = chunk.get("end")
              if isinstance(start, int) and isinstance(end, int) and start <= match_start < end:
                chunk_index = chunk.get("chunk_index")
                break
            if isinstance(chunk_index, int):
              anchors.append({
                "anchor": {"chunkIndex": chunk_index},
                "score_bps": item["score_bps"],
                "method": item["method"],
              })
    else:
      text_data, error = read_text_with_guard(target, size_limit, line_limit)
      if not error and isinstance(text_data, str):
        anchors, _ = anchors_from_text(text_data, text, top_k, size_limit)

    anchors.sort(key=lambda item: (-item.get("score_bps", 0), anchor_signature(item.get("anchor"))))
    status = "matched" if anchors else "unknown"
    if status == "matched":
      summary["matched"] += 1
    if status == "unknown":
      summary["unknown"] += 1
    items.append({
      "quote_index": index,
      "text": text,
      "sourcePointer": source,
      "status": status,
      "anchors": anchors,
    })

  items.sort(key=lambda item: item.get("quote_index", 0))
  ok = summary["total"] == summary["matched"]
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
