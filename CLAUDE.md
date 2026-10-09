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
streamlit run app/streamlit_app.py        # dashboard; synthetic market until real data is cached

python scripts/smoke_test_apis.py         # hit each external API once, print shapes
python scripts/find_markets.py fed        # Polymarket search -> YES token_id
python scripts/find_markets.py --kalshi KXFED
python scripts/pull_data.py --start 2025-12-09 --end 2025-12-11   # or --days 7
python scripts/seed_demo_data.py          # synthetic market into the cache (replay/validate only; the dashboard builds demo_market() itself and ignores this row)
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
                              replay.py (demo clock; the app inlines
                              the same confirmed_at filter itself)    validate.py (proof slide)
```

Two contracts hold the pipeline together, and most changes should preserve them:

1. **The bar frame.** Every venue client in `ingest/` returns a DataFrame indexed by UTC timestamp with
   columns `price` (0..1 probability) and `volume` — or an *empty* frame (plain RangeIndex) when the API
   returns nothing. `ingest.to_grid()` puts it on a 1-minute grid: price is last-in-bucket then
   forward-filled, volume is summed per bucket. An all-NaN volume column survives the grid as all-NaN,
   and that is how `detect.score_series` recognises a volume-free series and treats it as neutral
   (`vol_conf = 1.0`) rather than failing. Only Polymarket is ever volume-free (`prices-history` has
   neither volume nor cents); Kalshi quotes cents and fills a missing candle volume with 0, not NaN.
   `ingest/cache.py` persists the grid as `bars(market_id, ts, price, volume)` with
   `PRIMARY KEY (market_id, ts)` and `INSERT OR REPLACE`, so re-pulling an overlapping window overwrites
   rather than duplicates; `market_id` is the `id` from `markets.yaml` (there is no venue column).
   Nothing downstream of `to_grid` knows which venue the data came from — though Kalshi stamps candles at
   their period *end* (`end_period_ts`) while Polymarket's `t` is used as-is, so the two venues may sit
   one bar apart. Unlike explain/expose, ingest raises on HTTP errors; `pull_data.py` catches per market
   and prints FAILED instead of exiting nonzero.
2. **`Spike` with `confirmed_at`.** `detect.detect()` returns `Spike` objects whose `confirmed_at` is the
   earliest time the alert could honestly have been shown live, because the persistence test looks `hold`
   bars *into the future* (`confirmed_at` = peak + `hold` bars). Both `replay.py` and the dashboard
   filter on `confirmed_at <= now`, which is what keeps the demo free of look-ahead — note the dashboard
   does not import `replay.py`; it re-implements the same filter on its own session-state clock
   (`app/streamlit_app.py:84`). Anything that adds a forward-looking detector input must push
   `confirmed_at` out accordingly. Two known gaps: drift alerts resample to 15-minute bars labelled by
   the *left* edge, so a drift's `confirmed_at` understates by up to ~14 minutes; and `replay()` runs
   `detect()` once on the full series then reveals by time — that this matches a live truncated run is
   unverified (TODO at `replay.py:30`).

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
- **Dead zones at both ends of a series.** The lagged median/MAD needs `baseline/2` (= 120) bars, so the
  first ~135 bars can never fire — which is why the dashboard's "play from start" rewinds to
  `p.baseline` (240), not 0. Persistence is measured at exactly one future bar, `t + hold`, so the last
  `hold` bars can't fire either.
- Cooldown emits one `Spike` per contiguous over-threshold run and restarts from the *end* of the run.
  Drifts have no cooldown — the CUSUM resets to 0 after each alarm, so a long grind can fire repeatedly.
  The jump/drift overlap test drops a drift whose peak falls in
  `[jump.start, jump.confirmed_at + cooldown minutes]`, which assumes the 1-minute grid.
- All tunables live in `DetectorParams`; four of them are sidebar sliders in the dashboard (`window`,
  `score_threshold`, `hold`, `vol_min_ratio`). Tuning belongs in that dataclass, not in call sites.
- `validate.py` counts a hit when any alert's **`peak`** (not `confirmed_at`) lands within
  `tolerance_min` (60) of the event; drift alerts count too, and uncached events get `fired=None`,
  which `summary()` skips.

### External services and their failure mode

Every outward call degrades instead of raising, because the demo must always render: `explain.explain()`
falls back to a headline template without `ANTHROPIC_API_KEY` or on any exception; `explain.headlines()`
and `expose.edgar_companies()` return `[]` on HTTP or JSON errors (EDGAR also needs `SEC_USER_AGENT`).
Keep that property. The Claude call uses `client.beta.messages.create` with
`betas=["server-side-fallback-2026-07-01"]` and checks `stop_reason == "refusal"`; a refusal or empty
response also falls back. The model defaults to `claude-opus-5-5` (override with `CLAUDE_MODEL`).

Two things the dashboard layers on top: the GDELT news query is **not** per-market config — it is a
single sidebar text box defaulting to `'"Federal Reserve" OR Powell'`, so non-Fed markets get Fed
headlines unless the user edits it. And only `load_market` and the explain call are `@st.cache_data`;
`expose.exposed()` hits EDGAR live once per visible alert card per rerun — i.e. every replay tick —
so pre-computing exposure per event type is a standing TODO (`expose.py:9`).

### Config as data

`config/markets.yaml` lists the watched markets; each carries an `event_type` key that indexes
`config/exposure.yaml` (ETFs, EDGAR query, `direction_note` shown on the card and fed to the explainer).
Adding a market or an event type is a YAML edit, not a code change. `dislocation_desk/config.py` is the
only place that reads `.env` or those files. Both YAML loaders are `@lru_cache`'d, so a YAML edit needs a
process (or Streamlit server) restart to show up. Env vars resolve as `os.getenv(x) or default`, so the
empty values in a copied `.env.example` fall through to the defaults (`DD_CACHE_PATH` →
`data/cache.duckdb`, `CLAUDE_MODEL` → `claude-opus-5-5`). Polymarket entries need `token_id` — the YES
outcome's **CLOB token** (Gamma `clobTokenIds[0]`), not the market id or slug; Kalshi entries need both
`series_ticker` and `ticker` because the candlesticks URL uses both.

### Synthetic data is the test substrate

`synthetic.py` builds markets with a real jump, a fat-finger print and a slow drift injected at known
bars; `tests/` asserts the detector fires on the first and third and not the second. Most tests build
their own single-event series (jump at bar 700 with volume ×6, fat-finger at bar 500, drift at bar 600);
only `test_demo_market_end_to_end` uses `demo_market()` (fat-finger at 420, jump at 700, drift from
1000). Tests never touch the network. `demo_market()` is also what the dashboard shows before any real
data is cached — the SYNTHETIC entry is built in-process, not read from the cache, and real cached
markets take the default slot once they exist.

## Current state (as of the initial scaffold commit)

Working and tested: `detect.py`, `replay.py`, `ingest/cache.py`, the dashboard on synthetic data.

**Not yet live-tested against any real API.** `ingest/polymarket.py`, `ingest/kalshi.py`,
`explain.headlines`, `expose.edgar_companies` were written from the official docs in a sandbox with no
network, so field names may be wrong — run `scripts/smoke_test_apis.py` before trusting them. Also
pending: `config/markets.yaml` IDs are `TODO` placeholders (and the Kalshi series tickers are guesses),
`validation/known_events.yaml` holds TODO events, and `polymarket.trades_volume()` raises
`NotImplementedError` (until it lands, Polymarket markets get no volume confirmation).
