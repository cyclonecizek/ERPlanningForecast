#!/usr/bin/env python3
"""Stamp each page's script tags with the script's content hash (name.js?v=<first 10 hex of MD5>),
so browsers load new code after a change. Run after editing any docs/*.js, then rebuild the offline
file with pipeline/build_standalone.py."""
import hashlib
import os
import re
import sys

DOCS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "docs")


def main():
    hashes = {}
    for f in os.listdir(DOCS):
        if f.endswith(".js"):
            with open(os.path.join(DOCS, f), "rb") as fh:
                hashes[f] = hashlib.md5(fh.read()).hexdigest()[:10]
    changed = 0
    for f in sorted(os.listdir(DOCS)):
        if not f.endswith(".html") or f == "ER_Weather_Tools.html":
            continue
        p = os.path.join(DOCS, f)
        with open(p, encoding="utf-8") as fh:
            s = fh.read()
        t = re.sub(r'src="([A-Za-z0-9_.-]+\.js)(?:\?v=[0-9a-f]*)?"',
                   lambda m: f'src="{m.group(1)}?v={hashes[m.group(1)]}"' if m.group(1) in hashes else m.group(0), s)
        if t != s:
            with open(p, "w", encoding="utf-8") as fh:
                fh.write(t)
            changed += 1
    print(f"stamped {changed} page(s): " + ", ".join(f"{k}={v}" for k, v in sorted(hashes.items())))
    return 0


if __name__ == "__main__":
    sys.exit(main())
