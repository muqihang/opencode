#!/usr/bin/env python3

import argparse
import hashlib
import json
import os
import re
import stat as stat_module
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


def mask_sample(value: str) -> str:
  if not value:
    return ""
  if len(value) <= 4:
    return "*" * len(value)
  return value[:2] + "*" * (len(value) - 4) + value[-2:]


def location_from_index(text: str, index: int) -> str:
  line = text.count("\n", 0, index) + 1
  last_newline = text.rfind("\n", 0, index)
  col = index - last_newline
  return f"{line}:{col}"


def luhn_check(digits: str) -> bool:
  total = 0
  reverse = digits[::-1]
  for idx, ch in enumerate(reverse):
    num = int(ch)
    if idx % 2 == 1:
      num *= 2
      if num > 9:
        num -= 9
    total += num
  return total % 10 == 0


def build_view(summary: Dict[str, Any], findings: List[Dict[str, Any]]) -> str:
  lines = ["# Redaction Scan", "", f"Total: {summary.get('total', 0)}", ""]
  for finding in findings:
    severity = finding.get("severity", "")
    reason = finding.get("reason", "")
    lines.append(f"- {severity}: {reason}")
  return "\n".join(lines) + "\n"


def main() -> None:
  parser = argparse.ArgumentParser()
  parser.add_argument("--input", required=True)
  parser.add_argument("--output", required=True)
  args = parser.parse_args()

  output_spec = "redaction-scan/1.0"
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
      "summary": {"total": 0, "high": 0, "medium": 0, "low": 0},
      "findings": [],
      "error": {"code": "invalid_json", "message": "input json parse failed"},
      "viewMarkdown": "# Redaction Scan\n\nError: invalid_json\n",
    }
    write_json(args.output, result)
    return

  cache_key = sha256_text(stable_json(raw_input))
  spec_version = raw_input.get("specVersion") if isinstance(raw_input, dict) else output_spec
  policy_version = raw_input.get("policyVersion") if isinstance(raw_input, dict) else "unknown"
  pointers = raw_input.get("pointers") if isinstance(raw_input, dict) else None
  rules = raw_input.get("rules") if isinstance(raw_input, dict) else {}
  if not isinstance(spec_version, str) or not isinstance(policy_version, str) or not isinstance(pointers, list):
    result = {
      "specVersion": output_spec,
      "policyVersion": policy_version if isinstance(policy_version, str) else "unknown",
      "cacheKey": cache_key,
      "ok": False,
      "summary": {"total": 0, "high": 0, "medium": 0, "low": 0},
      "findings": [],
      "error": {"code": "invalid_input", "message": "specVersion/policyVersion/pointers required"},
      "viewMarkdown": "# Redaction Scan\n\nError: invalid_input\n",
    }
    write_json(args.output, result)
    return

  pii_enabled = True
  secrets_enabled = True
  if isinstance(rules, dict):
    if isinstance(rules.get("pii"), bool):
      pii_enabled = rules.get("pii")
    if isinstance(rules.get("secrets"), bool):
      secrets_enabled = rules.get("secrets")

  root = session_root(args.input)
  findings: List[Dict[str, Any]] = []

  email_re = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
  phone_re = re.compile(r"\b(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b")
  ssn_re = re.compile(r"\b\d{3}-\d{2}-\d{4}\b")
  cc_re = re.compile(r"\b(?:\d[ -]*?){13,16}\b")
  aws_key_re = re.compile(r"\bAKIA[0-9A-Z]{16}\b")
  private_key_re = re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----")
  token_re = re.compile(r"(?i)(api_key|token|secret)\s*[:=]\s*([A-Za-z0-9\-_=]{16,})")

  for pointer in pointers:
    if not isinstance(pointer, dict):
      continue
    rel = pointer.get("path")
    if not isinstance(rel, str):
      continue
    safe, target, reason = safe_resolve(root, rel)
    if not safe or not target:
      findings.append({
        "severity": "medium",
        "pointer": {"path": rel},
        "location": "0:0",
        "reason": f"invalid_path:{reason}",
        "sample_redacted": "",
        "suggestedAction": "fix_pointer_path",
      })
      continue
    if not os.path.exists(target):
      findings.append({
        "severity": "medium",
        "pointer": {"path": rel},
        "location": "0:0",
        "reason": "missing_file",
        "sample_redacted": "",
        "suggestedAction": "ensure_artifact_exists",
      })
      continue
    try:
      with open(target, "r", encoding="utf-8") as f:
        text = f.read()
    except Exception:
      findings.append({
        "severity": "medium",
        "pointer": {"path": rel},
        "location": "0:0",
        "reason": "read_failed",
        "sample_redacted": "",
        "suggestedAction": "check_encoding",
      })
      continue

    if pii_enabled:
      for match in email_re.finditer(text):
        raw = match.group(0)
        findings.append({
          "severity": "medium",
          "pointer": {"path": rel},
          "location": location_from_index(text, match.start()),
          "reason": "pii_email",
          "sample_redacted": mask_sample(raw),
          "hash": sha256_text(raw),
          "length": len(raw),
          "suggestedAction": "redact_email",
        })
      for match in phone_re.finditer(text):
        raw = match.group(0)
        findings.append({
          "severity": "low",
          "pointer": {"path": rel},
          "location": location_from_index(text, match.start()),
          "reason": "pii_phone",
          "sample_redacted": mask_sample(raw),
          "hash": sha256_text(raw),
          "length": len(raw),
          "suggestedAction": "redact_phone",
        })
      for match in ssn_re.finditer(text):
        raw = match.group(0)
        findings.append({
          "severity": "high",
          "pointer": {"path": rel},
          "location": location_from_index(text, match.start()),
          "reason": "pii_ssn",
          "sample_redacted": mask_sample(raw),
          "hash": sha256_text(raw),
          "length": len(raw),
          "suggestedAction": "redact_ssn",
        })
      for match in cc_re.finditer(text):
        raw = match.group(0)
        digits = re.sub(r"\D", "", raw)
        if len(digits) >= 13 and len(digits) <= 16 and luhn_check(digits):
          findings.append({
            "severity": "high",
            "pointer": {"path": rel},
            "location": location_from_index(text, match.start()),
            "reason": "pii_credit_card",
            "sample_redacted": mask_sample(raw),
            "hash": sha256_text(raw),
            "length": len(raw),
            "suggestedAction": "redact_card",
          })

    if secrets_enabled:
      for match in aws_key_re.finditer(text):
        raw = match.group(0)
        findings.append({
          "severity": "high",
          "pointer": {"path": rel},
          "location": location_from_index(text, match.start()),
          "reason": "secret_aws_access_key",
          "sample_redacted": mask_sample(raw),
          "hash": sha256_text(raw),
          "length": len(raw),
          "suggestedAction": "rotate_key",
        })
      for match in private_key_re.finditer(text):
        raw = match.group(0)
        findings.append({
          "severity": "high",
          "pointer": {"path": rel},
          "location": location_from_index(text, match.start()),
          "reason": "secret_private_key",
          "sample_redacted": mask_sample(raw),
          "hash": sha256_text(raw),
          "length": len(raw),
          "suggestedAction": "remove_private_key",
        })
      for match in token_re.finditer(text):
        raw = match.group(2)
        findings.append({
          "severity": "high",
          "pointer": {"path": rel},
          "location": location_from_index(text, match.start(2)),
          "reason": "secret_token",
          "sample_redacted": mask_sample(raw),
          "hash": sha256_text(raw),
          "length": len(raw),
          "suggestedAction": "rotate_token",
        })

  severity_rank = {"high": 0, "medium": 1, "low": 2}
  findings.sort(key=lambda item: (severity_rank.get(item.get("severity", "low"), 3), item.get("pointer", {}).get("path", ""), item.get("location", "")))

  summary = {"total": len(findings), "high": 0, "medium": 0, "low": 0}
  for item in findings:
    level = item.get("severity")
    if level in summary:
      summary[level] += 1
  ok = summary["high"] == 0
  view_markdown = build_view(summary, findings)
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
    "findings": findings,
    "viewMarkdown": view_markdown,
  }
  if view_path:
    result["viewPath"] = view_path

  write_json(args.output, result)


if __name__ == "__main__":
  main()
