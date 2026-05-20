#!/usr/bin/env python3
"""Merge multiple lesson JSON files into one."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def merge_vocab(items):
    seen = set()
    out = []
    for it in items:
        w = (it.get("word") or "").strip()
        key = w.lower()
        if not w or key in seen:
            continue
        seen.add(key)
        out.append(it)
    return out


def merge_keywords(items):
    seen = set()
    out = []
    for it in items:
        w = (it.get("word") or "").strip()
        key = w.lower()
        if not w or key in seen:
            continue
        seen.add(key)
        out.append(it)
    return out


def merge_glosses(*dicts):
    out = {}
    for d in dicts:
        if d:
            out.update(d)
    return out


def merge_lessons(paths, meta):
    parts = []
    for p in paths:
        with open(p, encoding="utf-8") as f:
            parts.append(json.load(f))

    base = parts[0]
    reading = []
    for i, p in enumerate(parts):
        if i:
            reading.append("")
        reading.extend(p.get("readingPassages") or [])

    dialogue = []
    for p in parts:
        dialogue.extend(p.get("dialogue") or [])

    vocab = []
    keywords = []
    glosses = []
    grammar_items = []
    for p in parts:
        vocab.extend(p.get("vocabulary") or [])
        keywords.extend(p.get("keywords") or [])
        glosses.append(p.get("wordGlosses") or {})
        gr = p.get("grammarReorder") or {}
        grammar_items.extend(gr.get("items") or [])

    out = {
        "id": meta["id"],
        "titleJa": meta["titleJa"],
        "title": meta["title"],
        "dialogue": dialogue,
        "readingPassages": reading,
        "vocabulary": merge_vocab(vocab),
        "keywords": merge_keywords(keywords),
        "wordGlosses": merge_glosses(*glosses),
        "wordSprint": dict(base.get("wordSprint") or {}),
        "grammarReorder": dict(base.get("grammarReorder") or {}),
    }
    if out["wordSprint"] and meta.get("wordSprintTitleJa"):
        out["wordSprint"]["titleJa"] = meta["wordSprintTitleJa"]
    if out["grammarReorder"]:
        if meta.get("grammarTitleJa"):
            out["grammarReorder"]["titleJa"] = meta["grammarTitleJa"]
        out["grammarReorder"]["items"] = grammar_items

    return out


def main():
    lessons_dir = ROOT / "data" / "lessons"
    jobs = json.loads(sys.argv[1]) if len(sys.argv) > 1 else "[]"
    for job in jobs:
        paths = [ROOT / p for p in job["sources"]]
        out_path = ROOT / job["out"]
        merged = merge_lessons(paths, job["meta"])
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(merged, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print("wrote", out_path)
        for src in job.get("delete", []):
            p = ROOT / src
            if p.exists():
                p.unlink()
                print("deleted", p)


if __name__ == "__main__":
    main()
