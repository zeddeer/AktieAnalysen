#!/usr/bin/env python3
"""Fetch one year of daily closes for every stock in data/stocks.json
and write data/prices.json. Runs in GitHub Actions (no dependencies).

Source: Yahoo Finance chart endpoint (unofficial, free, no key).
If a ticker fails, the previous data for it is kept.
"""
import json
import os
import sys
import time
import http.cookiejar
import urllib.parse
import urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STOCKS = os.path.join(ROOT, "data", "stocks.json")
PRICES = os.path.join(ROOT, "data", "prices.json")
HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]
URL = "https://{host}/v8/finance/chart/{sym}?range=1y&interval=1d{crumb}"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"


JAR = http.cookiejar.CookieJar()
OPENER = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(JAR))
OPENER.addheaders = [("User-Agent", UA), ("Accept", "application/json,text/html,*/*")]
CRUMB = ""


def get_crumb():
    """Yahoo sometimes requires a session cookie + crumb (429/401 without)."""
    global CRUMB
    for url in ("https://fc.yahoo.com", "https://finance.yahoo.com/"):
        try:
            OPENER.open(url, timeout=20).read(1000)
        except Exception:
            pass  # fc.yahoo.com returns 404 but still sets the cookie
    try:
        CRUMB = OPENER.open("https://query2.finance.yahoo.com/v1/test/getcrumb", timeout=20).read().decode().strip()
    except Exception as e:
        print(f"crumb failed: {e}", file=sys.stderr)


def fetch_json(sym):
    errs = []
    for attempt in range(3):
        for host in HOSTS:
            crumb = f"&crumb={urllib.parse.quote(CRUMB)}" if CRUMB else ""
            try:
                with OPENER.open(URL.format(host=host, sym=urllib.parse.quote(sym), crumb=crumb), timeout=30) as r:
                    return json.load(r)
            except Exception as e:
                errs.append(f"{host}: {e}")
        time.sleep(3 * (attempt + 1))
    raise RuntimeError("; ".join(errs[-2:]))


def fetch(sym):
    data = fetch_json(sym)
    res = data["chart"]["result"][0]
    meta = res["meta"]
    ts = res.get("timestamp") or []
    closes = res["indicators"]["quote"][0].get("close") or []
    history = [
        [datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%d"), round(c, 4)]
        for t, c in zip(ts, closes)
        if c is not None
    ]
    if not history:
        raise ValueError("no closes")
    price = meta.get("regularMarketPrice") or history[-1][1]
    prev = history[-2][1] if len(history) > 1 else meta.get("chartPreviousClose")
    vals = [c for _, c in history]
    return {
        "price": round(price, 4),
        "prevClose": round(prev, 4) if prev else None,
        "changePct": round((price / prev - 1) * 100, 2) if prev else None,
        "currency": meta.get("currency"),
        "marketTime": datetime.fromtimestamp(
            meta.get("regularMarketTime", ts[-1]), timezone.utc
        ).isoformat(),
        "high52": max(vals),
        "low52": min(vals),
        "history": history,
    }


def main():
    stocks = json.load(open(STOCKS, encoding="utf-8"))["stocks"]
    try:
        old = json.load(open(PRICES, encoding="utf-8")).get("quotes", {})
    except (FileNotFoundError, json.JSONDecodeError):
        old = {}
    get_crumb()
    quotes, failed = {}, []
    for s in stocks:
        sym = s["yahoo"]
        try:
            quotes[sym] = fetch(sym)
            print(f"ok   {sym}: {quotes[sym]['price']}")
        except Exception as e:  # keep going, keep old data
            failed.append(sym)
            print(f"::warning title=Kurs saknas {sym}::{e}")
            if sym in old:
                quotes[sym] = old[sym]
        time.sleep(1)
    out = {
        "updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "Yahoo Finance",
        "failed": failed,
        "quotes": quotes,
    }
    with open(PRICES, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    if len(failed) == len(stocks):
        sys.exit(1)


if __name__ == "__main__":
    main()
