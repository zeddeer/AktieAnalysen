#!/usr/bin/env python3
"""Fetch one year of daily closes for every stock in data/stocks.json
and write data/prices.json. Runs in GitHub Actions (no dependencies).

Sources, tried in order until one works:
  1. Avanza (unofficial public chart API) – Swedish and US stocks.
     Orderbook id from `avanzaId` in stocks.json, otherwise looked up by search.
  2. Stooq daily CSV – US stocks (e.g. ibm.us).
  3. Yahoo Finance chart API – often rate-limited from GitHub runners.
If every source fails for a ticker, the previous data for it is kept.
Problems are emitted as GitHub warning annotations.
"""
import csv
import http.cookiejar
import io
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STOCKS = os.path.join(ROOT, "data", "stocks.json")
PRICES = os.path.join(ROOT, "data", "prices.json")
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"

JAR = http.cookiejar.CookieJar()
OPENER = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(JAR))
OPENER.addheaders = [("User-Agent", UA), ("Accept", "application/json,text/csv,text/html,*/*")]


def get(url, data=None, timeout=30):
    headers = {"Content-Type": "application/json"} if data is not None else {}
    req = urllib.request.Request(url, data=data, headers=headers)
    with OPENER.open(req, timeout=timeout) as r:
        return r.read()


def warn(title, msg):
    print(f"::warning title={title}::{str(msg)[:500]}")


def build(history, currency, market_time=None, price=None):
    history = sorted({d: c for d, c in history if c is not None}.items())
    history = [[d, round(c, 4)] for d, c in history]
    if len(history) < 2:
        raise ValueError("för få datapunkter")
    price = price or history[-1][1]
    prev = history[-2][1] if history[-1][1] == price else history[-1][1]
    vals = [c for _, c in history]
    return {
        "price": round(price, 4),
        "prevClose": round(prev, 4),
        "changePct": round((price / prev - 1) * 100, 2),
        "currency": currency,
        "marketTime": market_time or f"{history[-1][0]}T{'20:00' if currency == 'USD' else '15:30'}:00+00:00",
        "high52": max(vals),
        "low52": min(vals),
        "history": history,
    }


# ---------- Avanza ----------
def _find_hits(obj, out):
    if isinstance(obj, dict):
        oid = obj.get("orderBookId") or obj.get("orderbookId")
        if oid and (obj.get("title") or obj.get("name")):
            out.append(obj)
        for v in obj.values():
            _find_hits(v, out)
    elif isinstance(obj, list):
        for v in obj:
            _find_hits(v, out)
    return out


def avanza_search(stock):
    q = stock.get("avanzaQuery") or f"{stock['name']} {stock.get('shareClass', '')}".strip()
    hits, errs = [], []
    try:
        body = json.dumps({"query": q, "searchFilter": {"types": ["STOCK"]}, "pagination": {"from": 0, "size": 10}}).encode()
        hits = _find_hits(json.loads(get("https://www.avanza.se/_api/search/filtered-search", data=body)), [])
    except Exception as e:
        errs.append(f"filtered-search: {e}")
    if not hits:
        try:
            url = "https://www.avanza.se/_api/search/global-search?query=" + urllib.parse.quote(q)
            hits = _find_hits(json.loads(get(url)), [])
        except Exception as e:
            errs.append(f"global-search: {e}")
    if not hits:
        raise RuntimeError("Avanza-sök gav inget: " + "; ".join(errs))
    ticker = stock["ticker"].replace(" ", "").upper()

    def score(h):
        t = str(h.get("tickerSymbol") or h.get("symbol") or "").replace(" ", "").upper()
        s = 0
        if t == ticker:
            s += 10
        if str(h.get("type", "STOCK")).upper() == "STOCK":
            s += 2
        if stock["currency"] == "SEK" and str(h.get("flagCode", "SE")).upper() == "SE":
            s += 1
        return s

    best = max(hits, key=score)
    return str(best.get("orderBookId") or best.get("orderbookId"))


def from_avanza(stock):
    oid = stock.get("avanzaId") or avanza_search(stock)
    data = json.loads(get(f"https://www.avanza.se/_api/price-chart/stock/{oid}?timePeriod=one_year&resolution=day"))
    rows = data.get("ohlc") or data.get("dataPoints") or []
    hist = []
    for r in rows:
        if isinstance(r, dict):
            ts, c = r.get("timestamp"), r.get("close")
        else:
            ts, c = r[0], r[-1]
        if ts is None or c is None:
            continue
        hist.append((datetime.fromtimestamp(ts / 1000, timezone.utc).strftime("%Y-%m-%d"), float(c)))
    q = build(hist, stock["currency"])
    q["avanzaId"] = oid
    return q


# ---------- Stooq (US) ----------
def from_stooq(stock):
    if stock["currency"] != "USD":
        raise RuntimeError("bara US")
    sym = stock["yahoo"].lower() + ".us"
    d1 = (date.today() - timedelta(days=370)).strftime("%Y%m%d")
    raw = get(f"https://stooq.com/q/d/l/?s={sym}&d1={d1}&d2={date.today():%Y%m%d}&i=d").decode()
    rows = list(csv.DictReader(io.StringIO(raw)))
    if not rows or "Close" not in rows[0]:
        raise RuntimeError(f"oväntat svar: {raw[:80]}")
    return build([(r["Date"], float(r["Close"])) for r in rows], "USD")


# ---------- Yahoo ----------
CRUMB = None


def from_yahoo(stock):
    global CRUMB
    if CRUMB is None:
        CRUMB = ""
        try:
            OPENER.open("https://fc.yahoo.com", timeout=15).read(100)
        except Exception:
            pass
        try:
            CRUMB = get("https://query2.finance.yahoo.com/v1/test/getcrumb", timeout=15).decode().strip()
        except Exception:
            pass
    crumb = f"&crumb={urllib.parse.quote(CRUMB)}" if CRUMB else ""
    sym = urllib.parse.quote(stock["yahoo"])
    data = json.loads(get(f"https://query2.finance.yahoo.com/v8/finance/chart/{sym}?range=1y&interval=1d{crumb}"))
    res = data["chart"]["result"][0]
    meta = res["meta"]
    ts = res.get("timestamp") or []
    closes = res["indicators"]["quote"][0].get("close") or []
    hist = [(datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%d"), c) for t, c in zip(ts, closes)]
    mt = meta.get("regularMarketTime")
    return build(
        hist,
        meta.get("currency") or stock["currency"],
        datetime.fromtimestamp(mt, timezone.utc).isoformat() if mt else None,
        meta.get("regularMarketPrice"),
    )


SOURCES = [("Avanza", from_avanza), ("Stooq", from_stooq), ("Yahoo", from_yahoo)]


def main():
    stocks = json.load(open(STOCKS, encoding="utf-8"))["stocks"]
    try:
        old = json.load(open(PRICES, encoding="utf-8")).get("quotes", {})
    except (FileNotFoundError, json.JSONDecodeError):
        old = {}
    quotes, failed = {}, []
    for s in stocks:
        key = s["yahoo"]
        errs = []
        for name, fn in SOURCES:
            try:
                q = fn(s)
                q["source"] = name
                quotes[key] = q
                print(f"ok   {key} via {name}: {q['price']} ({len(q['history'])} dagar)")
                break
            except Exception as e:
                errs.append(f"{name}: {e}")
            time.sleep(1)
        else:
            failed.append(key)
            warn(f"Kurs saknas {key}", " | ".join(errs))
            if key in old:
                quotes[key] = old[key]
    out = {
        "updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "failed": failed,
        "quotes": quotes,
    }
    with open(PRICES, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    if len(failed) == len(stocks):
        sys.exit(1)


if __name__ == "__main__":
    main()
