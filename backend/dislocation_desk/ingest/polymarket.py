"""Polymarket client (no auth needed for reads).

Docs-verified, not yet live-tested:
  Gamma (market discovery): https://gamma-api.polymarket.com/markets
  CLOB price history:       https://clob.polymarket.com/prices-history
      params: market=<CLOB token id>, startTs, endTs (unix s), fidelity=<minutes>
      returns {"history": [{"t": <unix s>, "p": <price>}, ...]}

Gotcha: `market` is the CLOB token ID from the Gamma market's `clobTokenIds`
(a JSON-encoded list; index 0 is usually YES), not the market id or slug.
"""

from __future__ import annotations

import json

import httpx
import pandas as pd

GAMMA = "https://gamma-api.polymarket.com"
CLOB = "https://clob.polymarket.com"
DATA_API = "https://data-api.polymarket.com"


def search_markets(query: str = "", limit: int = 20, active: bool = True) -> list[dict]:
    """List markets by 24h volume; filter by a substring of the question."""
    params = {"limit": 200, "active": str(active).lower(), "closed": "false", "order": "volume24hr", "ascending": "false"}
    r = httpx.get(f"{GAMMA}/markets", params=params, timeout=30)
    r.raise_for_status()
    out = []
    for m in r.json():
        if query.lower() in m.get("question", "").lower():
            tokens = m.get("clobTokenIds")
            tokens = json.loads(tokens) if isinstance(tokens, str) else tokens
            out.append({"question": m.get("question"), "slug": m.get("slug"), "token_ids": tokens, "volume24hr": m.get("volume24hr")})
    return out[:limit]


def price_history(token_id: str, start: pd.Timestamp, end: pd.Timestamp, fidelity: int = 1) -> pd.DataFrame:
    """Price history for one outcome token. Polymarket returns no volume here, so `volume` is NaN.

    TODO: the API may cap how long a window you can ask for at 1-minute fidelity;
    if so, page through [start, end] in chunks.
    """
    params = {"market": token_id, "startTs": int(start.timestamp()), "endTs": int(end.timestamp()), "fidelity": fidelity}
    r = httpx.get(f"{CLOB}/prices-history", params=params, timeout=30)
    r.raise_for_status()
    hist = r.json().get("history", [])
    df = pd.DataFrame(hist)
    if df.empty:
        return pd.DataFrame(columns=["price", "volume"])
    df.index = pd.to_datetime(df["t"], unit="s", utc=True)
    return pd.DataFrame({"price": df["p"].astype(float), "volume": float("nan")})


def trades_volume(condition_id: str, start: pd.Timestamp, end: pd.Timestamp) -> pd.Series:
    """TODO: per-minute traded size from the Data API trades endpoint, to give Polymarket
    markets the volume confirmation that Kalshi gets for free. Check the docs for the
    exact params (market=<condition id>, limit/offset paging) before relying on it."""
    raise NotImplementedError
