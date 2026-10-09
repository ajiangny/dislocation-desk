"""Explain: why did it move? Headlines from the spike window plus a two-sentence Claude summary.

News: GDELT DOC 2.0 API (free, no key; at most one request per 5 s, else HTTP 429).
  https://api.gdeltproject.org/api/v2/doc/doc?query=...&mode=artlist&format=json
      &startdatetime=YYYYMMDDHHMMSS&enddatetime=YYYYMMDDHHMMSS&maxrecords=25

If ANTHROPIC_API_KEY is not set (or the call fails) we fall back to a plain
template, so the dashboard always renders.
"""

from __future__ import annotations

import os
import time

import httpx
import pandas as pd

from .config import CLAUDE_MODEL
from .detect import Spike

GDELT = "https://api.gdeltproject.org/api/v2/doc/doc"
GDELT_MIN_INTERVAL = 5.5  # GDELT answers 429 to more than one request per 5 s
_gdelt_last_call = 0.0


def _gdelt_get(params: dict) -> httpx.Response:
    """GET GDELT no faster than its rate limit allows, retrying once on a 429."""
    global _gdelt_last_call
    for attempt in range(2):
        wait = _gdelt_last_call + GDELT_MIN_INTERVAL - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        r = httpx.get(GDELT, params=params, timeout=20)
        _gdelt_last_call = time.monotonic()
        if r.status_code != 429:
            break
    return r


def headlines(query: str, start: pd.Timestamp, end: pd.Timestamp, limit: int = 15) -> list[dict]:
    """Articles matching `query` published in [start, end]. Returns [{title, url, domain, seendate}]."""
    fmt = "%Y%m%d%H%M%S"
    params = {
        "query": query, "mode": "artlist", "format": "json", "sort": "datedesc",
        "startdatetime": start.strftime(fmt), "enddatetime": end.strftime(fmt), "maxrecords": limit,
    }
    try:
        r = _gdelt_get(params)
        r.raise_for_status()
        arts = r.json().get("articles", [])
    except (httpx.HTTPError, ValueError):
        return []
    return [{k: a.get(k) for k in ("title", "url", "domain", "seendate")} for a in arts]


def news_window(spike: Spike, before_min: int = 60, after_min: int = 30) -> tuple[pd.Timestamp, pd.Timestamp]:
    return spike.start - pd.Timedelta(minutes=before_min), spike.peak + pd.Timedelta(minutes=after_min)


PROMPT = """You are writing one line on an alert card for a credit analyst.

A prediction market just moved:
  Market: {market_name}
  Move: {headline} ({kind}, direction {direction})
  Window: {start} to {peak} UTC
  Context for this event type: {direction_note}

Headlines published around that window (may be empty or noisy):
{headlines}

In at most two sentences, say the most likely reason the odds moved, citing a headline if one fits.
If none of the headlines plausibly explain it, say the cause is unclear from news so far. Do not invent facts."""


def explain(spike: Spike, market_name: str, heads: list[dict], direction_note: str = "") -> str:
    """Two-sentence 'why it moved'. Uses Claude if a key is configured, else a template."""
    if not os.getenv("ANTHROPIC_API_KEY"):
        return _fallback(heads)
    try:
        import anthropic

        client = anthropic.Anthropic()
        lines = "\n".join(f"- [{h.get('seendate')}] {h.get('title')} ({h.get('domain')})" for h in heads) or "(none found)"
        prompt = PROMPT.format(
            market_name=market_name, headline=spike.headline(), kind=spike.kind, direction=spike.direction,
            start=spike.start, peak=spike.peak, direction_note=direction_note, headlines=lines,
        )
        resp = client.beta.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=1024,
            output_config={"effort": "low"},
            # On a policy decline, the API re-runs the request on a fallback model in the same call.
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            messages=[{"role": "user", "content": prompt}],
        )
        if resp.stop_reason == "refusal":
            return _fallback(heads)
        text = "".join(b.text for b in resp.content if b.type == "text").strip()
        return text or _fallback(heads)
    except Exception as e:  # keep the demo alive whatever happens
        return _fallback(heads, note=f"(explainer error: {type(e).__name__})")


def _fallback(heads: list[dict], note: str = "") -> str:
    if heads:
        return f"Likely related: \"{heads[0]['title']}\" ({heads[0].get('domain')}). {note}".strip()
    return f"Cause unclear from news so far. {note}".strip()
