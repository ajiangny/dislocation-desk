"""Load config files and environment settings."""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

import yaml
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
CONFIG_DIR = ROOT / "config"
DATA_DIR = ROOT / "data"

load_dotenv(ROOT / ".env")

CACHE_PATH = Path(os.getenv("DD_CACHE_PATH") or DATA_DIR / "cache.duckdb")
CLAUDE_MODEL = os.getenv("CLAUDE_MODEL") or "claude-opus-5-5"
# SEC asks every client to identify itself: "Name email@example.com"
SEC_USER_AGENT = os.getenv("SEC_USER_AGENT") or ""


@lru_cache
def markets() -> list[dict]:
    return yaml.safe_load((CONFIG_DIR / "markets.yaml").read_text())["markets"]


def market(market_id: str) -> dict:
    for m in markets():
        if m["id"] == market_id:
            return m
    raise KeyError(market_id)


@lru_cache
def exposure() -> dict:
    return yaml.safe_load((CONFIG_DIR / "exposure.yaml").read_text())
