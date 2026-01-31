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
