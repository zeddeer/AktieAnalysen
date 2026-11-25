#!/usr/bin/env python3
"""Analyserar FI:s blankningsregister (data/fi/positions.csv.gz) och skriver data/shorts.json.

För firmorna i data/shorts_config.json ("focus", t.ex. Citadel):
  * aktuella positioner, förändring senaste 7 och 30 dagarna
  * "band": inom vilka nivåer positionen rört sig senaste året, och vid vilka
    tröskelvärden den vänt (trolig nedre/övre gräns)
  * händelsestudie: kursutveckling efter att firman rapporterat ökning/minskning
  * test av "köp i bandet": avkastning när positionen just gått in i sitt band

Plus en mönstersökning bland alla firmor: vilka innehavare/bolag som pendlar
fram och tillbaka mellan samma två tröskelnivåer.

Viktigt: FI publicerar bara positioner >= 0,5 % och en ny rad först när positionen
korsar ett nytt tiondels steg (0,5 / 0,6 / 0,7 ...). Rörelser inom ett steg syns inte.
"""
import csv
import gzip
import io
import json
import math
import os
import statistics as st
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "fi", "positions.csv.gz")
PRICES = os.path.join(ROOT, "data", "short_prices.json")
CONFIG = os.path.join(ROOT, "data", "shorts_config.json")
OUT = os.path.join(ROOT, "data", "shorts.json")
META = os.path.join(ROOT, "data", "fi", "meta.json")

HORIZONS = (5, 20, 60)
EXIT = 0.0  # position under 0,5 % räknas som 0 i serierna


def d(s):
    return datetime.strptime(s, "%Y-%m-%d").date()


def bucket(p):
    return round(math.floor(p * 10 + 1e-9) / 10, 1)


def load_rows():
    with gzip.open(RAW, "rt", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    out = []
    for r in rows:
        if not r["date"]:
            continue
        p = float(r["pct"]) if r["pct"] not in ("", None) else None
        if r["below"] == "1" or p is None or p < 0.5:
            p = EXIT
        out.append({**r, "p": p, "d": d(r["date"])})
    out.sort(key=lambda r: (r["d"], r["holder"]))
    return out


def series_by_pair(rows):
    """(holder, isin) -> [(date, pct)] med en punkt per dag (sista värdet)."""
    s = defaultdict(dict)
    names = {}
    for r in rows:
        s[(r["holder"], r["isin"])][r["d"]] = r["p"]
        names[r["isin"]] = r["issuer"]
    return {k: sorted(v.items()) for k, v in s.items()}, names


def group_series(pairs, holders):
    """Summerar flera juridiska enheter (t.ex. Citadel Advisors + Citadel Europe) per emittent."""
    per_isin = defaultdict(list)
    for (h, isin), ser in pairs.items():
        if h in holders:
            per_isin[isin].append(ser)
    out = {}
    for isin, sers in per_isin.items():
        days = sorted({dt for ser in sers for dt, _ in ser})
        cur = [None] * len(sers)
        idx = [0] * len(sers)
        pts = []
        for day in days:
            for i, ser in enumerate(sers):
                while idx[i] < len(ser) and ser[idx[i]][0] <= day:
                    cur[i] = ser[idx[i]][1]
                    idx[i] += 1
            pts.append((day, round(sum(c or 0 for c in cur), 4)))
        clean = []
        for p in pts:
            if not clean or clean[-1][1] != p[1]:
                clean.append(p)
        out[isin] = clean
    return out


def value_at(ser, day):
    v = EXIT
    for dt, p in ser:
        if dt > day:
            break
        v = p
    return v


def threshold_stats(ser, since):
    """Korsningar per tröskel och 'studsar' (korsar och vänder tillbaka inom 60 dagar)."""
    pts = [(dt, p) for dt, p in ser if dt >= since]
    ups, downs = defaultdict(int), defaultdict(int)
    cap, floor = defaultdict(int), defaultdict(int)
    reversals = 0
    for i in range(1, len(pts)):
        a, b = pts[i - 1][1], pts[i][1]
        if b > a:
            for t in [round(0.5 + 0.1 * k, 1) for k in range(60)]:
                if a < t <= b:
                    ups[t] += 1
        elif b < a:
            for t in [round(0.5 + 0.1 * k, 1) for k in range(60)]:
                if b < t <= a:
                    downs[t] += 1
        if i >= 2:
            pa = pts[i - 2][1]
            if (a - pa) * (b - a) < 0:
                reversals += 1
                within = (pts[i][0] - pts[i - 1][0]).days <= 60
                if within and a > pa and b < a:
                    cap[bucket(a) if a > 0 else 0.5] += 1  # gick upp till nivån och vände ned
                if within and a < pa and b > a:
                    floor[bucket(a) if a > 0 else 0.0] += 1  # gick ned till nivån och vände upp
    return pts, ups, downs, cap, floor, reversals


def band_of(pts):
    vals = [p for _, p in pts if p > 0]
    if len(vals) < 3:
        return None
    hist = defaultdict(int)
    for v in vals:
        hist[bucket(v)] += 1
    best, share = None, 0
    for b in hist:
        s = hist[b] + hist.get(round(b + 0.1, 1), 0)
        if s > share:
            best, share = b, s
    return {
        "min": round(min(vals), 2),
        "max": round(max(vals), 2),
        "median": round(st.median(vals), 2),
        "low": best,
        "high": round(best + 0.2, 1),
        "share": round(share / len(vals), 2),
        "reports": len(vals),
        "histogram": {f"{k:.1f}": v for k, v in sorted(hist.items())},
    }


# ---------- kurser ----------
def price_index(prices, isin):
    q = prices.get("quotes", {}).get(isin)
    if not q or not q.get("history"):
        return None
    return [(d(a), float(b)) for a, b in q["history"]]


def fwd(hist, day, n):
    """Köp på första handelsdagen EFTER positionsdatumet (FI publicerar dagen efter)."""
    i = next((k for k, (dt, _) in enumerate(hist) if dt > day), None)
    if i is None or i + n >= len(hist):
        return None
    return hist[i + n][1] / hist[i][1] - 1


def baseline(hist, n):
    r = [hist[i + n][1] / hist[i][1] - 1 for i in range(0, len(hist) - n)]
    return st.mean(r) if r else None


def agg(vals):
    vals = [v for v in vals if v is not None]
    if not vals:
        return {"n": 0}
    return {
        "n": len(vals),
        "mean": round(st.mean(vals) * 100, 2),
        "median": round(st.median(vals) * 100, 2),
        "hit": round(sum(v > 0 for v in vals) / len(vals) * 100, 0),
    }


def event_study(ser, hist, since):
    ev = {"ökning": defaultdict(list), "minskning": defaultdict(list), "under 0,5": defaultdict(list),
          "in i bandet uppifrån": defaultdict(list), "in i bandet underifrån": defaultdict(list)}
    base = {n: [] for n in HORIZONS}
    pts = [(dt, p) for dt, p in ser]
    bd = band_of([(dt, p) for dt, p in pts if dt >= since])
    for i in range(1, len(pts)):
        day, p = pts[i]
        if day < since:
            continue
        prev = pts[i - 1][1]
        kind = "under 0,5" if p == 0 and prev > 0 else ("ökning" if p > prev else "minskning")
        for n in HORIZONS:
            r = fwd(hist, day, n)
            ev[kind][n].append(r)
            if bd and bd["low"] <= p < bd["low"] + 0.1 + 1e-9:
                if prev > p:
                    ev["in i bandet uppifrån"][n].append(r)
                elif prev < p:
                    ev["in i bandet underifrån"][n].append(r)
    h2 = [(dt, c) for dt, c in hist if dt >= since]
    for n in HORIZONS:
        base[n] = baseline(h2, n)
    return {k: {str(n): agg(v[n]) for n in HORIZONS} for k, v in ev.items()}, {
        str(n): (round(base[n] * 100, 2) if base[n] is not None else None) for n in HORIZONS}


def pooled(studies):
    """Slår ihop händelser över alla bolag (viktat per händelse)."""
    out = {}
    for kind in ("ökning", "minskning", "under 0,5", "in i bandet uppifrån", "in i bandet underifrån"):
        out[kind] = {}
        for n in HORIZONS:
            tot, s, hits = 0, 0.0, 0
            for es in studies:
                a = es[kind][str(n)]
                if a["n"]:
                    tot += a["n"]
                    s += a["mean"] * a["n"]
                    hits += a["hit"] * a["n"]
            out[kind][str(n)] = {"n": tot, "mean": round(s / tot, 2) if tot else None,
                                 "hit": round(hits / tot, 0) if tot else None}
    return out


# ---------- huvudprogram ----------
def main():
    cfg = json.load(open(CONFIG, encoding="utf-8"))
    rows = load_rows()
    today = max(r["d"] for r in rows)
    try:
        prices = json.load(open(PRICES, encoding="utf-8"))
    except Exception:
        prices = {"quotes": {}}
    pairs, names = series_by_pair(rows)
    year_ago = today - timedelta(days=365)
    two_years = today - timedelta(days=730)

    focus_out = []
    for f in cfg["focus"]:
        holders = sorted({h for h, _ in pairs if f.lower() in h.lower()})
        g = group_series(pairs, set(holders))
        positions, studies = [], []
        for isin, ser in g.items():
            if ser[-1][0] < two_years and ser[-1][1] == 0:
                continue
            pts, ups, downs, cap, floor, rev = threshold_stats(ser, year_ago)
            bd = band_of(pts)
            hist = price_index(prices, isin)
            es, base = event_study(ser, hist, two_years) if hist else (None, None)
            if es:
                studies.append(es)
            cur = ser[-1][1]
            focus_out_pos = {
                "isin": isin,
                "issuer": names.get(isin, isin),
                "current": cur,
                "lastDate": ser[-1][0].isoformat(),
                "change7": round(cur - value_at(ser, today - timedelta(days=7)), 2),
                "change30": round(cur - value_at(ser, today - timedelta(days=30)), 2),
                "reports30": sum(1 for dt, _ in ser if dt > today - timedelta(days=30)),
                "reports365": len(pts),
                "reversals365": rev,
                "band": bd,
                "likelyCap": max(cap, key=cap.get) if cap else None,
                "capHits": max(cap.values()) if cap else 0,
                "likelyFloor": max(floor, key=floor.get) if floor else None,
                "floorHits": max(floor.values()) if floor else 0,
                "crossUp": {f"{k:.1f}": v for k, v in sorted(ups.items())},
                "crossDown": {f"{k:.1f}": v for k, v in sorted(downs.items())},
                "series": [[dt.isoformat(), p] for dt, p in ser if dt >= two_years] or [[ser[-1][0].isoformat(), ser[-1][1]]],
                "events": es,
                "baseline": base,
                "hasPrices": bool(hist),
            }
            positions.append(focus_out_pos)
        positions.sort(key=lambda x: (-(x["current"] > 0), -x["current"], x["issuer"]))
        active = [p for p in positions if p["current"] > 0]

        def changes(days):
            since = today - timedelta(days=days)
            out = []
            for p in positions:
                ser = [(d(a), b) for a, b in p["series"]]
                before = value_at(ser, since)
                now = p["current"]
                if round(now - before, 2) == 0:
                    continue
                kind = "ny" if before == 0 and now > 0 else ("stängd (<0,5)" if now == 0 else ("ökad" if now > before else "minskad"))
                out.append({"issuer": p["issuer"], "from": before, "to": now, "kind": kind})
            return sorted(out, key=lambda x: -abs(x["to"] - x["from"]))

        monthly = []
        m = date(today.year, today.month, 1)
        for _ in range(24):
            cnt, tot = 0, 0.0
            for isin, ser in g.items():
                v = value_at(ser, m)
                if v > 0:
                    cnt += 1
                    tot += v
            monthly.append({"month": m.isoformat()[:7], "positions": cnt, "sumPct": round(tot, 2)})
            m = (m - timedelta(days=1)).replace(day=1)
        focus_out.append({
            "name": f,
            "entities": holders,
            "active": len(active),
            "sumActive": round(sum(p["current"] for p in active), 2),
            "week": changes(7),
            "month": changes(30),
            "monthly": list(reversed(monthly)),
            "positions": positions,
            "pooled": pooled(studies),
        })

    # mönster hos alla firmor: pendlar mellan samma nivåer
    patterns = []
    for (h, isin), ser in pairs.items():
        pts = [(dt, p) for dt, p in ser if dt >= two_years]
        if len(pts) < 6:
            continue
        _, ups, downs, cap, floor, rev = threshold_stats(ser, two_years)
        bd = band_of(pts)
        if not bd or rev < 4:
            continue
        patterns.append({
            "holder": h, "issuer": names.get(isin, isin), "isin": isin,
            "reports": len(pts), "reversals": rev, "band": [bd["low"], bd["high"]], "share": bd["share"],
            "current": ser[-1][1], "lastDate": ser[-1][0].isoformat(),
            "score": round(rev * bd["share"], 1),
        })
    patterns.sort(key=lambda x: -x["score"])
    by_holder = defaultdict(lambda: {"pairs": 0, "reversals": 0})
    for p in patterns:
        by_holder[p["holder"]]["pairs"] += 1
        by_holder[p["holder"]]["reversals"] += p["reversals"]
    holders_rank = sorted(({"holder": k, **v} for k, v in by_holder.items()), key=lambda x: (-x["pairs"], -x["reversals"]))

    # nuvarande blankare i de bevakade aktierna
    watch = {}
    for sid, needle in (cfg.get("watch") or {}).items():
        lst = []
        for (h, isin), ser in pairs.items():
            if needle.lower() in names.get(isin, "").lower() and ser[-1][1] > 0:
                lst.append({"holder": h, "pct": ser[-1][1], "date": ser[-1][0].isoformat()})
        watch[sid] = sorted(lst, key=lambda x: -x["pct"])

    try:
        meta = json.load(open(META))
    except Exception:
        meta = {}
    out = {
        "updated": datetime.now(timezone.utc).isoformat(timespec="minutes"),
        "registerDate": today.isoformat(),
        "rows": len(rows),
        "files": meta,
        "note": "FI publicerar bara positioner >= 0,5 % och en ny rad först när positionen korsar ett nytt tiondels steg. Rörelser inom ett steg syns inte.",
        "focus": focus_out,
        "patterns": patterns[:40],
        "patternHolders": holders_rank[:20],
        "watch": watch,
    }
    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    for f in focus_out:
        print(f"{f['name']}: {f['active']} aktiva positioner, {len(f['positions'])} senaste 2 åren")
    print(f"mönster: {len(patterns)} par")


if __name__ == "__main__":
    main()
