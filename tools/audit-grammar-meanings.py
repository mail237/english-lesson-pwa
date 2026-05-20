#!/usr/bin/env python3
"""Report grammar items where meaningJa looks inconsistent with tokens."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "data" / "lessons"


def join_tokens(tokens):
    s = " ".join(tokens)
    for p in ",?.!:":
        s = s.replace(f" {p}", p)
    return s


def main():
    for path in sorted(ROOT.glob("*.json")):
        if path.name == "index.json":
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        items = (data.get("grammarReorder") or {}).get("items") or []
        for i, it in enumerate(items):
            en = join_tokens(it.get("tokens") or [])
            ja = (it.get("meaningJa") or "").strip()
            if not ja or not en:
                continue
            # flag if meaning mentions practice but english has play only
            if "練習" in ja and "practice" not in en.lower():
                print(f"{path.name} #{i+1}: JA has 練習 but EN={en}")
            if "play soccer" in en.lower() and "練習" in ja:
                print(f"{path.name} #{i+1}: play vs 練習 mismatch: {en}")


if __name__ == "__main__":
    main()
