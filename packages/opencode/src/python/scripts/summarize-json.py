#!/usr/bin/env python3

import argparse
import json
from typing import Any


def summarize(data: Any) -> dict:
  if isinstance(data, dict):
    keys = list(data.keys())
  else:
    keys = []
  summary = f"Object with {len(keys)} keys"
  return {"summary": summary, "keys": keys}


def main() -> None:
  parser = argparse.ArgumentParser()
  parser.add_argument("--input", required=True)
  parser.add_argument("--output", required=True)
  args = parser.parse_args()

  with open(args.input, "r", encoding="utf-8") as f:
    data = json.load(f)

  result = summarize(data)

  with open(args.output, "w", encoding="utf-8") as f:
    json.dump(result, f)


if __name__ == "__main__":
  main()
