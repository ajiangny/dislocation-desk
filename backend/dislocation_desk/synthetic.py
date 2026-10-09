"""Synthetic market series for tests and for the dashboard before real data is cached.

The demo series contains, on purpose:
  * a real jump (big, high volume, holds)  -> should fire a "jump" alert
  * a fat-finger print (big, low volume, reverts at once) -> should NOT fire
  * a slow grind with no single big bar     -> should fire a "drift" alert
"""

from __future__ import annotations

import numpy as np
import pandas as pd


def _to_price(lg: np.ndarray) -> np.ndarray:
    p = 1 / (1 + np.exp(-lg))
    return np.round(p, 3)  # venues quote to ~0.1¢-1¢


def quiet_market(n: int = 1440, p0: float = 0.4, noise: float = 0.01, seed: int = 0,
                 start: str = "2025-12-10 12:00", freq: str = "1min") -> pd.DataFrame:
    """A random walk in log-odds with Poisson-ish volume. No events."""
    rng = np.random.default_rng(seed)
    lg = np.log(p0 / (1 - p0)) + np.cumsum(rng.normal(0, noise, n))
    vol = rng.gamma(shape=2.0, scale=50.0, size=n)
    idx = pd.date_range(start, periods=n, freq=freq, tz="UTC")
    return pd.DataFrame({"price": _to_price(lg), "volume": vol}, index=idx)


def add_jump(df: pd.DataFrame, at: int, size: float, over: int = 10, vol_mult: float = 6.0) -> pd.DataFrame:
    """Shift log-odds by `size` spread over `over` bars starting at bar `at`, and keep it there."""
    out = df.copy()
    lg = np.log(out["price"] / (1 - out["price"])).to_numpy(copy=True)
    ramp = np.clip((np.arange(len(lg)) - at) / over, 0, 1) * size
    out["price"] = _to_price(lg + ramp)
    out.iloc[at : at + over + 5, out.columns.get_loc("volume")] *= vol_mult
    return out


def add_fat_finger(df: pd.DataFrame, at: int, size: float, length: int = 2) -> pd.DataFrame:
    """A brief print far from the market that reverts immediately, on normal volume."""
    out = df.copy()
    lg = np.log(out["price"] / (1 - out["price"])).to_numpy(copy=True)
    lg[at : at + length] += size
    out["price"] = _to_price(lg)
    return out


def add_drift(df: pd.DataFrame, at: int, size: float, over: int = 240) -> pd.DataFrame:
    """A slow steady grind of `size` log-odds over `over` bars, normal volume."""
    out = df.copy()
    lg = np.log(out["price"] / (1 - out["price"])).to_numpy(copy=True)
    ramp = np.clip((np.arange(len(lg)) - at) / over, 0, 1) * size
    out["price"] = _to_price(lg + ramp)
    return out


def demo_market(seed: int = 7) -> pd.DataFrame:
    """One trading day with a fat-finger, a real jump and a slow drift."""
    df = quiet_market(n=1440, p0=0.38, noise=0.006, seed=seed)
    df = add_fat_finger(df, at=420, size=1.2)
    df = add_jump(df, at=700, size=0.95, over=12)   # ~38% -> ~61%
    df = add_drift(df, at=1000, size=-0.8, over=300)
    return df
