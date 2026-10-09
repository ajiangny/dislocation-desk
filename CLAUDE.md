# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Dislocation Desk (Hack Knight 2026, track: *Prediction Markets as a Financial Signal*) watches macro
prediction markets (Fed, CPI, tariffs, shutdown, recession) on Polymarket and Kalshi, flags the moments
the odds reprice, explains the move from news in that window, and lists the credit ETFs and companies
exposed. ~1100 lines of Python; `README.md` holds the pitch and the detector write-up.

## Commands

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env                      # ANTHROPIC_API_KEY, SEC_USER_AGENT, optional CLAUDE_MODEL / DD_CACHE_PATH

pytest                                    # all tests (synthetic data only, no network)
pytest tests/test_detect.py::test_fat_finger_does_not_fire -q   # one test
streamlit run app/streamlit_app.py        # dashboard; opens on the synthetic market

python scripts/smoke_test_apis.py         # hit each external API once, print shapes
python scripts/find_markets.py fed        # Polymarket search -> YES token_id
python scripts/find_markets.py --kalshi KXFED
python scripts/pull_data.py --start 2025-12-09 --end 2025-12-11   # or --days 7
python scripts/seed_demo_data.py          # synthetic market into the DuckDB cache
python scripts/run_validation.py          # hit rate / false-alarm rate on known_events.yaml
```

There is no linter or formatter configured and no CI.

## Architecture

A five-stage pipeline, each stage a module under `dislocation_desk/`:

```
Polymarket ─┐
            ├─► ingest/ ─► DuckDB cache ─► detect.py ─┬─► explain.py (GDELT + Claude) ─┐
Kalshi ─────┘                                 ▲       └─► expose.py  (EDGAR + ETF map) ┴─► app/streamlit_app.py
                                              │
                                      replay.py (demo clock)        validate.py (proof slide)
```

Two contracts hold the pipeline together, and most changes should preserve them:

1. **The bar frame.** Every venue client in `ingest/` returns a DataFrame indexed by UTC timestamp with
   columns `price` (0..1 probability) and `volume` (may be all-NaN). `ingest.to_grid()` puts it on a
   1-minute grid; `ingest/cache.py` persists it as `bars(market_id, ts, price, volume)`. Nothing
   downstream of `to_grid` knows which venue the data came from. Kalshi quotes cents and carries volume;
   Polymarket's `prices-history` has neither volume nor cents, so `detect.score_series` treats a
   volume-free series as neutral (`vol_conf = 1.0`) rather than failing.
2. **`Spike` with `confirmed_at`.** `detect.detect()` returns `Spike` objects whose `confirmed_at` is the
   earliest time the alert could honestly have been shown live, because the persistence test looks `hold`
   bars *into the future*. Both `replay.py` and the dashboard filter on `confirmed_at <= now`, which is
   what keeps the demo free of look-ahead. Anything that adds a forward-looking detector input must push
   `confirmed_at` out accordingly.

### Detector (`detect.py`)

The thesis is one sentence: *a spike is a move that is big, backed by real money, and sticks.*
`score = |robust z| × vol_conf × persistence`, alert at `score >= 4` with a 60-bar cooldown. Things worth
knowing before editing it:

- Everything works in **log-odds** (`logit`), so 2%→6% counts like 40%→60% should.
- "Big" is a **robust z** — `(Δ − rolling median) / (1.4826 × rolling MAD)` — with the baseline lagged by
  `window` so the move being scored never sits inside its own baseline. Median/MAD rather than
  mean/std so an earlier spike doesn't blind the detector later (`test_robust_z_ignores_earlier_outlier`).
- The series is pre-smoothed with a 5-bar rolling median (`level`), which is why a 1–2 bar fat-finger
  print can't be either end of a "move".
- `detect_drifts` is a separate two-sided **CUSUM** over 15-minute bars, for grinds with no single big
  bar. Its reference mean is **zero on purpose** — a rolling baseline would absorb the very trend it is
  meant to catch. `detect()` drops drift alerts that overlap a jump alert.
- All tunables live in `DetectorParams`; four of them are sidebar sliders in the dashboard. Tuning
  belongs in that dataclass, not in call sites.

### External services and their failure mode

Every outward call degrades instead of raising, because the demo must always render: `explain.explain()`
falls back to a headline template without `ANTHROPIC_API_KEY` or on any exception; `explain.headlines()`
and `expose.edgar_companies()` return `[]` on HTTP or JSON errors (EDGAR also needs `SEC_USER_AGENT`).
Keep that property. The Claude call uses `client.beta.messages.create` with
`betas=["server-side-fallback-2026-07-01"]` and checks `stop_reason == "refusal"`.

### Config as data

`config/markets.yaml` lists the watched markets; each carries an `event_type` key that indexes
`config/exposure.yaml` (ETFs, EDGAR query, `direction_note` shown on the card and fed to the explainer).
Adding a market or an event type is a YAML edit, not a code change. `dislocation_desk/config.py` is the
only place that reads `.env` or those files.

### Synthetic data is the test substrate

`synthetic.py` builds markets with a real jump, a fat-finger print and a slow drift injected at known
bars; `tests/` asserts the detector fires on the first and third and not the second. Tests never touch
the network. `demo_market()` is also what the dashboard shows before any real data is cached.

## Current state (as of the initial scaffold commit)

Working and tested: `detect.py`, `replay.py`, `ingest/cache.py`, the dashboard on synthetic data.

**Not yet live-tested against any real API.** `ingest/polymarket.py`, `ingest/kalshi.py`,
`explain.headlines`, `expose.edgar_companies` were written from the official docs in a sandbox with no
network, so field names may be wrong — run `scripts/smoke_test_apis.py` before trusting them. Also
pending: `config/markets.yaml` IDs are `TODO` placeholders (and the Kalshi series tickers are guesses),
`validation/known_events.yaml` holds TODO events, and `polymarket.trades_volume()` raises
`NotImplementedError` (until it lands, Polymarket markets get no volume confirmation).
