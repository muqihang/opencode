#!/usr/bin/env python3

import argparse
import hashlib
import json
import os
import tarfile
import zipfile
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
