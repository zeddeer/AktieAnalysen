#!/usr/bin/env python3
"""Tillfällig felsökning: visar hur FI:s registersidor ser ut."""
import re, sys, time, html as H
sys.path.insert(0, "scripts")
from fetch_shorts import get

def strip(s):
    return re.sub(r"\s+", " ", H.unescape(re.sub(r"<[^>]+>", " ", s))).strip()

def show(url, n=25):
    try:
        h = get(url, tries=4).decode("utf-8", "replace")
    except Exception as e:
        print("FEL", url, e); return ""
    print("=====", url, len(h))
    for t in re.findall(r"<table.*?</table>", h, re.S)[:3]:
        rows = re.findall(r"<tr.*?</tr>", t, re.S)
        print(f"  tabell {len(rows)} rader")
        for r in rows[:n]:
            cells = [strip(c) for c in re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", r, re.S)]
            links = re.findall(r'href="([^"]+)"', r)
            print("   ", cells, links[:2])
    for f in re.findall(r"<form.*?</form>", h, re.S)[:3]:
        print("  form", strip(f)[:200], re.findall(r'(?:action|name)="([^"]+)"', f)[:12])
    return h

main = show("https://www.fi.se/sv/vara-register/blankningsregistret/", 400)
tob = re.search(r'href="([^"]*Emittent\?id=[^"]+)"[^>]*>\s*Tobii', main or "")
if tob:
    show("https://www.fi.se" + H.unescape(tob.group(1)), 60)
show("https://www.fi.se/sv/vara-register/blankningsregistret/Positionsinnehavare", 30)
for q in ("Citadel",):
    for u in (f"https://www.fi.se/sv/vara-register/blankningsregistret/Positionsinnehavare?query={q}",
              f"https://www.fi.se/sv/vara-register/blankningsregistret/Positionsinnehavare?searchString={q}"):
        show(u, 30)
