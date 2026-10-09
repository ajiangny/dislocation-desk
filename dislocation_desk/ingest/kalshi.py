"""Kalshi client (no auth needed for market data).

Docs-verified, not yet live-tested:
  Base: https://api.elections.kalshi.com/trade-api/v2   (covers all Kalshi markets)
  GET /markets?series_ticker=...&status=open
  GET /series/{series_ticker}/markets/{ticker}/candlesticks
      params: start_ts, end_ts (unix s), period_interval = 1 | 60 | 1440 (minutes)
      returns {"candlesticks": [{"end_period_ts", "price": {"close", ...}, "yes_bid": {...}, "volume", ...}]}
      Prices are in cents.
"""

from __future__ import annotations

import httpx
import pandas as pd

BASE = "https://api.elections.kalshi.com/trade-api/v2"


def list_markets(series_ticker: str, status: str = "open") -> list[dict]:
    r = httpx.get(f"{BASE}/markets", params={"series_ticker": series_ticker, "status": status, "limit": 200}, timeout=30)
    r.raise_for_status()
    return [{"ticker": m["ticker"], "title": m.get("title"), "volume": m.get("volume")} for m in r.json().get("markets", [])]


def candlesticks(series_ticker: str, ticker: str, start: pd.Timestamp, end: pd.Timestamp, period: int = 1) -> pd.DataFrame:
    params = {"start_ts": int(start.timestamp()), "end_ts": int(end.timestamp()), "period_interval": period}
    r = httpx.get(f"{BASE}/series/{series_ticker}/markets/{ticker}/candlesticks", params=params, timeout=30)
    r.raise_for_status()
    rows = []
    for c in r.json().get("candlesticks", []):
        # Last trade close when there was a trade; otherwise fall back to the bid/ask midpoint.
        close = (c.get("price") or {}).get("close")
        if close is None:
            bid = (c.get("yes_bid") or {}).get("close")
            ask = (c.get("yes_ask") or {}).get("close")
            close = (bid + ask) / 2 if bid is not None and ask is not None else None
        if close is None:
            continue
        rows.append({"ts": pd.to_datetime(c["end_period_ts"], unit="s", utc=True), "price": close / 100.0, "volume": c.get("volume", 0)})
    if not rows:
        return pd.DataFrame(columns=["price", "volume"])
    return pd.DataFrame(rows).set_index("ts")
