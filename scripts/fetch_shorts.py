#!/usr/bin/env python3
"""Hämtar Finansinspektionens blankningsregister (aktuella + historiska positioner)
och skriver:
  data/fi/positions.csv.gz  – alla publika positioner (>= 0,5 %), rådata för analys
  data/short_prices.json    – kurshistorik för bolag som de bevakade firmorna blankat
Körs i GitHub Actions (inga beroenden). Analysen görs av scripts/analyze_shorts.py.
"""
import csv
import gzip
import http.cookiejar
import io
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "fi", "positions.csv.gz")
PRICES = os.path.join(ROOT, "data", "short_prices.json")
CONFIG = os.path.join(ROOT, "data", "shorts_config.json")
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"

JAR = http.cookiejar.CookieJar()
OPENER = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(JAR))
OPENER.addheaders = [("User-Agent", UA), ("Accept", "*/*"), ("Accept-Language", "sv-SE,sv;q=0.9,en;q=0.8")]

PAGES = [
    "https://www.fi.se/sv/vara-register/blankningsregistret/",
]
CANDIDATES = {
    "aktuella": ["https://www.fi.se/BlankningsRegister/GetAktuellFile"],
    "historiska": ["https://www.fi.se/BlankningsRegister/GetHistFile"],
}


def get(url, data=None, timeout=60, tries=3, headers=None):
    headers = dict(headers or {})
    if data is not None:
        headers["Content-Type"] = "application/json"
    for i in range(tries):
        try:
            with OPENER.open(urllib.request.Request(url, data=data, headers=headers), timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            body = b""
            try:
                body = e.read()[:300]
            except Exception:
                pass
            print(f"  försök {i + 1}/{tries} {url[:90]}: HTTP {e.code} {dict(e.headers).get('Server', '')} {body[:160]!r}")
            if i == tries - 1 or e.code not in (403, 404, 429, 500, 502, 503):
                raise
            time.sleep(3 + 4 * i)


def curl(url, tries=4):
    """FI svarar 404 på Pythons urllib men levererar till curl, så filerna hämtas med curl."""
    import subprocess
    import tempfile
    last = ""
    for i in range(tries):
        with tempfile.NamedTemporaryFile() as tmp:
            r = subprocess.run(["curl", "-sSL", "--max-time", "240", "-A", UA, "-o", tmp.name,
                                "-w", "%{http_code} %{content_type}", url], capture_output=True, text=True)
            code = r.stdout.strip()
            if r.returncode == 0 and code.startswith("200"):
                return open(tmp.name, "rb").read()
            last = f"curl {r.returncode} {code} {r.stderr.strip()[:200]}"
            print(f"  försök {i + 1}/{tries} {url}: {last}")
        time.sleep(3 + 4 * i)
    raise RuntimeError(last)


def warn(title, msg):
    print(f"::warning title={title}::{str(msg)[:500]}")


# ---------- hitta filerna ----------
def discover():
    found = {"aktuella": [], "historiska": []}
    for page in PAGES:
        try:
            html = get(page).decode("utf-8", "replace")
        except Exception as e:
            print(f"sida {page}: {e}")
            continue
        hrefs = re.findall(r'(?:href|data-url|data-href)="([^"]+)"', html)
        print(f"sida {page}: {len(html)} tecken, {len(hrefs)} länkar")
        if os.environ.get("FI_DEBUG"):
            for m in re.findall(r"<base[^>]*>", html):
                print("  base", m)
            for m in re.findall(r"(?i)(?:url|action)\s*[:=]\s*['\"]([^'\"]*(?:Blankning|Hist|Aktuell)[^'\"]*)['\"]", html)[:10]:
                print("  url-ref", m)
        for path in re.findall(r"RunReport\('([^']+)'", html):
            low = path.lower()
            kind = "historiska" if "hist" in low else ("aktuella" if "aktuell" in low or "current" in low else None)
            if kind:
                for base in ("https://www.fi.se",):
                    u = base + path
                    print(f"RunReport-länk: {u}")
                    if u not in found[kind]:
                        found[kind].append(u)
        for href in hrefs:
            h = href.replace("&amp;", "&")
            low = h.lower()
            if not re.search(r"(getaktuell|gethist|\.ods|\.xlsx?|file|download|export|excel)", low):
                continue
            url = urllib.parse.urljoin(page, h)
            print(f"länk på {page}: {url}")
            if "hist" in low:
                found["historiska"].append(url)
            elif "aktuell" in low or "current" in low:
                found["aktuella"].append(url)
    for k in found:
        for c in CANDIDATES[k]:
            if c not in found[k]:
                found[k].append(c)
    return found


# ---------- läsa kalkylark utan beroenden ----------
NS_T = "urn:oasis:names:tc:opendocument:xmlns:table:1.0"
NS_X = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def read_ods(z):
    root = ET.fromstring(z.read("content.xml"))
    rows = []
    for row in root.iter(f"{{{NS_T}}}table-row"):
        rep_r = int(row.get(f"{{{NS_T}}}number-rows-repeated", "1"))
        cells = []
        for cell in row:
            if not cell.tag.endswith("table-cell") and not cell.tag.endswith("covered-table-cell"):
                continue
            rep = int(cell.get(f"{{{NS_T}}}number-columns-repeated", "1"))
            val = cell.get("{urn:oasis:names:tc:opendocument:xmlns:office:1.0}value")
            dval = cell.get("{urn:oasis:names:tc:opendocument:xmlns:office:1.0}date-value")
            text = " ".join("".join(p.itertext()) for p in cell if p.tag.endswith("}p"))
            v = dval[:10] if dval else (val if val is not None else text)
            cells.extend([v] * min(rep, 50))
        while cells and cells[-1] in ("", None):
            cells.pop()
        if cells:
            rows.extend([cells] * min(rep_r, 1))
    return rows


def read_xlsx(z):
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).iter(f"{NS_X}si"):
            shared.append("".join(t.text or "" for t in si.iter(f"{NS_X}t")))
    sheet = sorted(n for n in z.namelist() if n.startswith("xl/worksheets/sheet"))[0]
    rows = []
    for row in ET.fromstring(z.read(sheet)).iter(f"{NS_X}row"):
        cells = {}
        for c in row.iter(f"{NS_X}c"):
            ref = re.match(r"([A-Z]+)", c.get("r", "A")).group(1)
            col = 0
            for ch in ref:
                col = col * 26 + ord(ch) - 64
            v = c.find(f"{NS_X}v")
            val = v.text if v is not None else ""
            if c.get("t") == "s" and val != "":
                val = shared[int(val)]
            elif c.get("t") == "inlineStr":
                val = "".join(t.text or "" for t in c.iter(f"{NS_X}t"))
            cells[col - 1] = val
        if cells:
            rows.append([cells.get(i, "") for i in range(max(cells) + 1)])
    return rows


def read_sheet(blob):
    z = zipfile.ZipFile(io.BytesIO(blob))
    names = z.namelist()
    if "content.xml" in names:
        return read_ods(z)
    if any(n.startswith("xl/") for n in names):
        return read_xlsx(z)
    raise RuntimeError(f"okänt filformat: {names[:5]}")


def excel_date(v):
    s = str(v).strip()
    if re.match(r"^\d{4}-\d{2}-\d{2}", s):
        return s[:10]
    try:
        f = float(s)
        if 20000 < f < 80000:
            return datetime.fromordinal(datetime(1899, 12, 30).toordinal() + int(f)).strftime("%Y-%m-%d")
    except ValueError:
        pass
    m = re.match(r"^(\d{1,2})[./](\d{1,2})[./](\d{4})", s)
    if m:
        return f"{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}"
    return ""


def pct_value(v):
    s = str(v).strip().replace(",", ".").replace("%", "").replace("\xa0", "")
    below = s.startswith("<")
    s = s.lstrip("<").strip()
    try:
        f = float(s)
    except ValueError:
        return None, below
    return f, below


HEAD = {
    "holder": ("innehavare", "position holder", "holder"),
    "issuer": ("emittent", "issuer"),
    "isin": ("isin",),
    "pct": ("position i procent", "procent", "position in per cent", "per cent", "%", "position"),
    "date": ("datum", "date"),
    "comment": ("kommentar", "comment"),
}


def to_records(rows, kind):
    hi = None
    for i, r in enumerate(rows[:40]):
        line = " | ".join(str(c).lower() for c in r)
        if ("innehavare" in line or "holder" in line) and ("isin" in line):
            hi = i
            break
    if hi is None:
        raise RuntimeError("hittade ingen rubrikrad: " + repr(rows[:6])[:400])
    header = [str(c).strip().lower() for c in rows[hi]]
    print(f"{kind}: rubriker {header}")
    col = {}
    for key, words in HEAD.items():
        for j, h in enumerate(header):
            if j in col.values():
                continue
            if any(w in h for w in words):
                if key == "issuer" and ("lei" in h or "isin" in h):
                    continue
                if key == "pct" and ("datum" in h or "date" in h):
                    continue
                col[key] = j
                break
    missing = [k for k in ("holder", "issuer", "isin", "pct", "date") if k not in col]
    if missing:
        raise RuntimeError(f"saknar kolumner {missing} i {header}")
    out = []
    for r in rows[hi + 1:]:
        g = lambda k: (r[col[k]] if col.get(k) is not None and col[k] < len(r) else "")
        holder = str(g("holder")).strip()
        if not holder:
            continue
        p, below = pct_value(g("pct"))
        out.append({
            "holder": holder,
            "issuer": str(g("issuer")).strip(),
            "isin": str(g("isin")).strip().upper(),
            "pct": "" if p is None else round(p, 4),
            "below": "1" if below or (p is not None and p < 0.5) else "",
            "date": excel_date(g("date")),
            "comment": str(g("comment")).strip()[:120],
            "file": kind,
        })
    return out


def fetch_register():
    urls = {k: list(v) for k, v in CANDIDATES.items()}
    recs, meta = [], {}
    for kind in ("historiska", "aktuella"):
        err = []
        for u in urls[kind]:
            try:
                ref = "https://www.fi.se/sv/vara-register/blankningsregistret/"
                blob = curl(u)
                print(f"{kind}: {u} gav {len(blob)} byte, början {blob[:8]!r}")
                rows = read_sheet(blob)
                rr = to_records(rows, kind)
                print(f"ok {kind}: {u} – {len(rr)} rader")
                recs.extend(rr)
                meta[kind] = {"url": u, "rows": len(rr)}
                break
            except Exception as e:
                err.append(f"{u}: {e}")
        else:
            warn(f"FI {kind}", "; ".join(err))
    return recs, meta


# ---------- kurser via Avanza ----------
def _hits(obj, out):
    if isinstance(obj, dict):
        oid = obj.get("orderBookId") or obj.get("orderbookId")
        if oid and (obj.get("title") or obj.get("name")):
            out.append(obj)
        for v in obj.values():
            _hits(v, out)
    elif isinstance(obj, list):
        for v in obj:
            _hits(v, out)
    return out


def avanza_id(isin, name):
    for q in (isin, name):
        try:
            body = json.dumps({"query": q, "searchFilter": {"types": ["STOCK"]}, "pagination": {"from": 0, "size": 5}}).encode()
            h = _hits(json.loads(get("https://www.avanza.se/_api/search/filtered-search", data=body)), [])
            if h:
                return str(h[0].get("orderBookId") or h[0].get("orderbookId"))
        except Exception as e:
            print(f"avanza-sök {q}: {e}")
    return None


def avanza_hist(oid):
    for period, res in (("five_years", "day"), ("three_years", "day"), ("five_years", "week")):
        try:
            data = json.loads(get(f"https://www.avanza.se/_api/price-chart/stock/{oid}?timePeriod={period}&resolution={res}"))
            rows = data.get("ohlc") or data.get("dataPoints") or []
            out = []
            for r in rows:
                ts, c = (r.get("timestamp"), r.get("close")) if isinstance(r, dict) else (r[0], r[-1])
                if ts is not None and c is not None:
                    out.append([datetime.fromtimestamp(ts / 1000, timezone.utc).strftime("%Y-%m-%d"), round(float(c), 4)])
            if len(out) > 50:
                return out, f"{period}/{res}"
        except Exception as e:
            print(f"avanza-kurs {oid} {period}: {e}")
    return [], ""


def fetch_prices(recs, cfg):
    focus = [m.lower() for f in cfg["focus"] for m in (f["match"] if isinstance(f, dict) else [f])]
    isins = {}
    for r in recs:
        if any(f in r["holder"].lower() for f in focus) and r["isin"]:
            isins[r["isin"]] = r["issuer"]
    try:
        old = json.load(open(PRICES, encoding="utf-8"))
    except Exception:
        old = {"quotes": {}}
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    quotes = {}
    for isin, name in sorted(isins.items()):
        prev = old.get("quotes", {}).get(isin, {})
        oid = prev.get("avanzaId") or avanza_id(isin, name)
        if not oid:
            warn("Avanza", f"hittade inte {name} ({isin})")
            if prev:
                quotes[isin] = prev
            continue
        hist, how = avanza_hist(oid)
        if hist:
            quotes[isin] = {"name": name, "avanzaId": oid, "resolution": how, "history": hist}
            print(f"kurs ok {name}: {len(hist)} punkter ({how})")
        elif prev:
            quotes[isin] = prev
        time.sleep(0.7)
    json.dump({"updated": today, "quotes": quotes}, open(PRICES, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))


def main():
    cfg = json.load(open(CONFIG, encoding="utf-8"))
    recs, meta = fetch_register()
    if not recs:
        warn("FI", "inga positioner hämtades – behåller tidigare data")
        sys.exit(0 if os.path.exists(RAW) else 1)
    os.makedirs(os.path.dirname(RAW), exist_ok=True)
    seen, rows = set(), []
    for r in recs:
        key = (r["holder"], r["isin"], r["date"], r["pct"], r["below"])
        if key in seen:
            continue
        seen.add(key)
        rows.append(r)
    rows.sort(key=lambda r: (r["date"], r["issuer"], r["holder"]))
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=["date", "holder", "issuer", "isin", "pct", "below", "comment", "file"])
    w.writeheader()
    w.writerows(rows)
    with gzip.GzipFile(RAW, "wb", mtime=0) as f:
        f.write(buf.getvalue().encode("utf-8"))
    json.dump(meta, open(os.path.join(ROOT, "data", "fi", "meta.json"), "w"), indent=1)
    print(f"sparade {len(rows)} positioner")
    fetch_prices(rows, cfg)


if __name__ == "__main__":
    main()
