#!/usr/bin/env python3

import argparse
import hashlib
import json
import os
import shutil
import subprocess
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
      message = proc.stderr.decode("utf-8").strip()
      if not message:
        message = proc.stdout.decode("utf-8").strip()
      if not message:
        message = f"pdftotext exit {proc.returncode}"
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
