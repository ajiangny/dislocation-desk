"""Local DuckDB cache so the demo never depends on wifi.

Table `bars(market_id, ts, price, volume)`, one row per market per bar.
"""

from __future__ import annotations

from pathlib import Path

import duckdb
import pandas as pd

from ..config import CACHE_PATH


def connect(path: Path | str = CACHE_PATH) -> duckdb.DuckDBPyConnection:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(path))
    con.execute(
        "CREATE TABLE IF NOT EXISTS bars (market_id VARCHAR, ts TIMESTAMPTZ, price DOUBLE, volume DOUBLE, PRIMARY KEY (market_id, ts))"
    )
    return con


def save(con: duckdb.DuckDBPyConnection, market_id: str, df: pd.DataFrame) -> int:
    if df.empty:
        return 0
    rows = df.reset_index().rename(columns={df.index.name or "index": "ts"})[["ts", "price", "volume"]]
    rows.insert(0, "market_id", market_id)
    con.register("incoming", rows)
    con.execute("INSERT OR REPLACE INTO bars SELECT market_id, ts, price, volume FROM incoming")
    con.unregister("incoming")
    return len(rows)


def load(con: duckdb.DuckDBPyConnection, market_id: str, start=None, end=None) -> pd.DataFrame:
    q = "SELECT ts, price, volume FROM bars WHERE market_id = ?"
    args: list = [market_id]
    if start is not None:
        q += " AND ts >= ?"
        args.append(pd.Timestamp(start))
    if end is not None:
        q += " AND ts <= ?"
        args.append(pd.Timestamp(end))
    df = con.execute(q + " ORDER BY ts", args).df()
    if df.empty:
        return pd.DataFrame(columns=["price", "volume"])
    df["ts"] = pd.to_datetime(df["ts"], utc=True)
    return df.set_index("ts")


def cached_markets(con: duckdb.DuckDBPyConnection) -> list[str]:
    return [r[0] for r in con.execute("SELECT DISTINCT market_id FROM bars ORDER BY 1").fetchall()]
