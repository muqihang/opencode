#!/usr/bin/env python3

import argparse
import ast
import hashlib
import json
import os
import re
import stat as stat_module
from decimal import Decimal, InvalidOperation, getcontext
from typing import Any, Dict, List, Optional, Tuple

getcontext().prec = 28


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


def decimal_to_string(value: Decimal) -> str:
  text = format(value, "f")
  if "." in text:
    text = text.rstrip("0").rstrip(".")
  if text == "-0":
    return "0"
  return text


def to_decimal(value: Any) -> Optional[Decimal]:
  if isinstance(value, Decimal):
    return value
  if isinstance(value, int):
    return Decimal(value)
  if isinstance(value, float):
    return Decimal(str(value))
  if isinstance(value, str):
    try:
      return Decimal(value)
    except InvalidOperation:
      return None
  return None


def extract_numbers_from_json(data: Any) -> List[Decimal]:
  numbers: List[Decimal] = []
  if isinstance(data, dict):
    for value in data.values():
      numbers.extend(extract_numbers_from_json(value))
  elif isinstance(data, list):
    for value in data:
      numbers.extend(extract_numbers_from_json(value))
  else:
    dec = to_decimal(data)
    if dec is not None:
      numbers.append(dec)
  return numbers


def extract_numbers_from_text(text: str) -> List[Decimal]:
  numbers: List[Decimal] = []
  pattern = re.compile(r"[-+]?\d+(?:,\d{3})*(?:\.\d+)?")
  for match in pattern.findall(text):
    value = match.replace(",", "")
    dec = to_decimal(value)
    if dec is not None:
      numbers.append(dec)
  return numbers


def read_numbers(path: str) -> Tuple[List[Decimal], Optional[str]]:
  try:
    raw = read_json(path)
    numbers = extract_numbers_from_json(raw)
    return numbers, None
  except Exception:
    pass
  try:
    with open(path, "r", encoding="utf-8") as f:
      text = f.read()
  except Exception:
    return [], "read_failed"
  numbers = extract_numbers_from_text(text)
  return numbers, None


def eval_expr(expr: str, values: Dict[str, Decimal]) -> Tuple[Optional[Decimal], Optional[str]]:
  try:
    parsed = ast.parse(expr, mode="eval")
  except Exception:
    return None, "invalid_expr"

  def eval_node(node: ast.AST) -> Decimal:
    if isinstance(node, ast.Expression):
      return eval_node(node.body)
    if isinstance(node, ast.BinOp):
      left = eval_node(node.left)
      right = eval_node(node.right)
      if isinstance(node.op, ast.Add):
        return left + right
      if isinstance(node.op, ast.Sub):
        return left - right
      if isinstance(node.op, ast.Mult):
        return left * right
      if isinstance(node.op, ast.Div):
        if right == 0:
          raise ValueError("divide_by_zero")
        return left / right
      raise ValueError("unsupported_op")
    if isinstance(node, ast.UnaryOp):
      value = eval_node(node.operand)
      if isinstance(node.op, ast.UAdd):
        return value
      if isinstance(node.op, ast.USub):
        return -value
      raise ValueError("unsupported_unary")
    if isinstance(node, ast.Name):
      if node.id not in values:
        raise ValueError("unknown_name")
      return values[node.id]
    if isinstance(node, ast.Constant):
      dec = to_decimal(node.value)
      if dec is None:
        raise ValueError("invalid_constant")
      return dec
    raise ValueError("invalid_node")

  try:
    value = eval_node(parsed)
  except Exception as exc:
    return None, str(exc)
  return value, None


def build_view(summary: Dict[str, Any], items: List[Dict[str, Any]]) -> str:
  lines = ["# Table Check", "", f"Cases: {summary.get('cases', 0)}", f"Mismatches: {summary.get('mismatches', 0)}", ""]
  for item in items:
    title = item.get("title", "")
    mismatches = item.get("mismatches", [])
    lines.append(f"- {title}: {len(mismatches)} mismatch(es)")
  return "\n".join(lines) + "\n"


def main() -> None:
  parser = argparse.ArgumentParser()
  parser.add_argument("--input", required=True)
  parser.add_argument("--output", required=True)
  args = parser.parse_args()

  output_spec = "table-check/1.0"
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
      "summary": {"cases": 0, "mismatches": 0},
      "items": [],
      "error": {"code": "invalid_json", "message": "input json parse failed"},
      "viewMarkdown": "# Table Check\n\nError: invalid_json\n",
    }
    write_json(args.output, result)
    return

  cache_key = sha256_text(stable_json(raw_input))
  spec_version = raw_input.get("specVersion") if isinstance(raw_input, dict) else output_spec
  policy_version = raw_input.get("policyVersion") if isinstance(raw_input, dict) else "unknown"
  cases = raw_input.get("cases") if isinstance(raw_input, dict) else None
  if not isinstance(spec_version, str) or not isinstance(policy_version, str) or not isinstance(cases, list):
    result = {
      "specVersion": output_spec,
      "policyVersion": policy_version if isinstance(policy_version, str) else "unknown",
      "cacheKey": cache_key,
      "ok": False,
      "summary": {"cases": 0, "mismatches": 0},
      "items": [],
      "error": {"code": "invalid_input", "message": "specVersion/policyVersion/cases required"},
      "viewMarkdown": "# Table Check\n\nError: invalid_input\n",
    }
    write_json(args.output, result)
    return

  root = session_root(args.input)
  items: List[Dict[str, Any]] = []
  mismatch_count = 0

  for case_index, case in enumerate(cases):
    if not isinstance(case, dict):
      continue
    title = case.get("title") if isinstance(case.get("title"), str) else f"case-{case_index}"
    inputs = case.get("inputs") if isinstance(case.get("inputs"), list) else []
    checks = case.get("checks") if isinstance(case.get("checks"), list) else []

    input_values: List[Decimal] = []
    input_details: List[Dict[str, Any]] = []

    for input_index, entry in enumerate(inputs):
      pointer = entry.get("pointer") if isinstance(entry, dict) else None
      rel = pointer.get("path") if isinstance(pointer, dict) else None
      if not isinstance(rel, str):
        input_values.append(Decimal(0))
        input_details.append({"pointer": pointer, "status": "invalid_path", "value": "0", "count": 0})
        continue
      safe, target, reason = safe_resolve(root, rel)
      if not safe or not target:
        input_values.append(Decimal(0))
        input_details.append({"pointer": pointer, "status": "invalid_path", "reason": reason, "value": "0", "count": 0})
        continue
      if not os.path.exists(target):
        input_values.append(Decimal(0))
        input_details.append({"pointer": pointer, "status": "missing", "value": "0", "count": 0})
        continue
      numbers, error = read_numbers(target)
      total = sum(numbers, Decimal(0))
      status = "ok" if error is None else error
      input_values.append(total)
      input_details.append({"pointer": pointer, "status": status, "value": decimal_to_string(total), "count": len(numbers)})

    values = {f"input{idx}": val for idx, val in enumerate(input_values)}
    computed: List[Dict[str, Any]] = []
    mismatches: List[Dict[str, Any]] = []

    for check in checks:
      if not isinstance(check, dict):
        continue
      kind = check.get("kind") if isinstance(check.get("kind"), str) else "unknown"
      expr = check.get("expr") if isinstance(check.get("expr"), str) else None
      expected_raw = check.get("expected")
      expected = to_decimal(expected_raw)
      computed_value: Optional[Decimal] = None
      error: Optional[str] = None

      if kind == "sum":
        computed_value = sum(values.values(), Decimal(0))
      elif kind == "difference":
        if len(input_values) >= 2:
          computed_value = input_values[0] - input_values[1]
        else:
          error = "insufficient_inputs"
      elif kind == "ratio":
        if len(input_values) >= 2:
          if input_values[1] == 0:
            error = "divide_by_zero"
          else:
            computed_value = input_values[0] / input_values[1]
        else:
          error = "insufficient_inputs"
      elif kind == "expr" and expr is not None:
        computed_value, error = eval_expr(expr, values)
      else:
        error = "unsupported_kind"

      computed_entry: Dict[str, Any] = {"kind": kind}
      if expr:
        computed_entry["expr"] = expr
      if computed_value is not None:
        computed_entry["value"] = decimal_to_string(computed_value)
      if error:
        computed_entry["error"] = error
      computed.append(computed_entry)

      if expected is not None:
        if computed_value is None:
          mismatch_count += 1
          mismatches.append({
            "kind": kind,
            "expected": decimal_to_string(expected),
            "actual": None,
            "delta": None,
            "reason": error or "no_value",
          })
        else:
          if computed_value != expected:
            mismatch_count += 1
            delta = computed_value - expected
            mismatches.append({
              "kind": kind,
              "expected": decimal_to_string(expected),
              "actual": decimal_to_string(computed_value),
              "delta": decimal_to_string(delta),
              "reason": "mismatch",
            })

    computed.sort(key=lambda item: (item.get("kind", ""), item.get("expr", "")))
    mismatches.sort(key=lambda item: (item.get("kind", ""), item.get("reason", "")))

    items.append({
      "case_index": case_index,
      "title": title,
      "inputs": input_details,
      "computed": computed,
      "mismatches": mismatches,
    })

  summary = {"cases": len(items), "mismatches": mismatch_count}
  ok = mismatch_count == 0
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
