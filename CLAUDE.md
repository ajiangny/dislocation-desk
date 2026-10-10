# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Dislocation Desk (Hack Knight 2026, track: *Prediction Markets as a Financial Signal*) watches macro
prediction markets (Fed, CPI, tariffs, shutdown, recession) on Polymarket and Kalshi, flags the moments
the odds reprice, explains the move from news in that window, and lists the credit ETFs and companies
exposed. Two halves: `backend/` (~1200 lines of Python: ingest, detector, explain, expose, FastAPI) and
`frontend/` (React 19 + TypeScript + Vite, Plotly for the chart). `README.md` holds the pitch and the
detector write-up.

## Commands

```bash
# backend — run from backend/ (the .venv lives at the repo root)
python -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.txt
cp .env.example .env                      # GEMINI_API_KEY, SEC_USER_AGENT, optional GEMINI_MODEL / DD_CACHE_PATH
cd backend
pytest                                    # all tests (synthetic data only, no network)
pytest tests/test_detect.py::test_fat_finger_does_not_fire -q   # one test
uvicorn dislocation_desk.api:app --reload --port 8000           # API; serves frontend/dist at / if built

python scripts/smoke_test_apis.py         # hit each external API once, print shapes
python scripts/find_markets.py fed        # Polymarket search -> YES token_id
python scripts/find_markets.py --kalshi KXFED
python scripts/pull_data.py --start 2025-12-09 --end 2025-12-11   # or --days 7
python scripts/seed_demo_data.py          # synthetic market into the cache (replay/validate only; the API builds demo_market() itself and ignores this row)
python scripts/run_validation.py          # hit rate / false-alarm rate on known_events.yaml

# frontend — run from frontend/
npm install
npm run dev                               # http://localhost:5173, proxies /api -> :8000 (vite.config.ts)
npm run typecheck                         # tsc --noEmit (strict, noUncheckedIndexedAccess)
npm test                                  # vitest: src/lib/replay.test.ts
npm run build                             # tsc + vite build -> frontend/dist
```

There is no linter or formatter configured and no CI.

## Architecture

A five-stage pipeline, each stage a module under `backend/dislocation_desk/`, with the browser owning
only the replay clock:

```
Polymarket ─┐
            ├─► ingest/ ─► DuckDB cache ─► detect.py ─┬─► explain.py (GDELT + Gemini) ─┐
Kalshi ─────┘                                 ▲       └─► expose.py  (EDGAR + ETF map) ┴─► api.py ─► frontend/src
                                              │
                              replay.py (demo clock; the frontend inlines
                              the same confirmed_at filter in lib/replay.ts)    validate.py (proof slide)
```

Two contracts hold the pipeline together, and most changes should preserve them:

1. **The bar frame.** Every venue client in `ingest/` returns a DataFrame indexed by UTC timestamp with
   columns `price` (0..1 probability) and `volume` — or an *empty* frame (plain RangeIndex) when the API
   returns nothing. `ingest.to_grid()` puts it on a 1-minute grid: price is last-in-bucket then
   forward-filled, volume is summed per bucket. An all-NaN volume column survives the grid as all-NaN,
   and that is how `detect.score_series` recognises a volume-free series and treats it as neutral
   (`vol_conf = 1.0`) rather than failing. No live venue is volume-free any more; the neutral path remains
   for old cached rows and hand-built frames. Kalshi quotes dollar strings and fills a missing candle
   volume with 0, not NaN. Polymarket's `prices-history` has no volume, so `polymarket.history()` merges in
   the Data API `/trades` feed (keyed by the market's `conditionId`, looked up from the token via Gamma):
   price rows carry volume 0 and trade rows carry NaN price, and `to_grid` resolves both (`last()` skips
   the NaN prices). Volume is shares traded on *both* outcomes, the same unit as Kalshi contracts. The
   trades feed is paged backwards by `end` because offsets past ~10k return nothing, and 429s are retried.
   `ingest/cache.py` persists the grid as `bars(market_id, ts, price, volume)` with
   `PRIMARY KEY (market_id, ts)` and `INSERT OR REPLACE`, so re-pulling an overlapping window overwrites
   rather than duplicates; `market_id` is the `id` from `markets.yaml` (there is no venue column).
   Nothing downstream of `to_grid` knows which venue the data came from — though Kalshi stamps candles at
   their period *end* (`end_period_ts`) while Polymarket's `t` is used as-is, so the two venues may sit
   one bar apart. Unlike explain/expose, ingest raises on HTTP errors; `pull_data.py` catches per market
   and prints FAILED instead of exiting nonzero. Over the wire (`/api/markets/{id}/series`) the frame is
   three parallel arrays `ts` (ISO UTC), `price`, `volume`, with `volume: null` for a volume-free series
   and NaN sent as `null` (JSON has no NaN; see `api._num`).
2. **`Spike` with `confirmed_at`.** `detect.detect()` returns `Spike` objects whose `confirmed_at` is the
   earliest time the alert could honestly have been shown live, because the persistence test looks `hold`
   bars *into the future* (`confirmed_at` = peak + `hold` bars). `/api/markets/{id}/alerts` returns *all*
   spikes for the series; `replay.py` and the frontend both filter on `confirmed_at <= now`, which is what
   keeps the demo free of look-ahead. The frontend does not call `replay.py`; `visibleAlerts()` in
   `frontend/src/lib/replay.ts` re-implements the same filter on a client-side clock (`pos` bars revealed,
   advanced by a `setInterval` in `App.tsx`). Anything that adds a forward-looking detector input must push
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
- Drifts check volume differently from jumps. A jump needs a *surge* (`vol_min_ratio`× usual for full
  credit); a drift needs only its *usual* volume over its span (ratio ≥ 1 → full credit), because a grind
  trades at a normal pace — `add_drift` in `synthetic.py` keeps volume normal on purpose. Both floor
  "usual" at `min_volume` per `window`. A drift fires when CUSUM level × credit ≥ `cusum_h`, so an
  under-traded grind fires later rather than never, and a volume-free series keeps credit 1.
- **Dead zones at both ends of a series.** The lagged median/MAD needs `baseline/2` (= 120) bars, so the
  first ~135 bars can never fire — which is why the frontend's "Play from start" rewinds to
  `params.baseline` (240, taken from the alerts response), not 0. Persistence is measured at exactly one
  future bar, `t + hold`, so the last `hold` bars can't fire either.
- Cooldown emits one `Spike` per contiguous over-threshold run and restarts from the *end* of the run.
  Drifts have no cooldown — the CUSUM resets to 0 after each alarm, so a long grind can fire repeatedly.
  The jump/drift overlap test drops a drift whose peak falls in
  `[jump.start, jump.confirmed_at + cooldown minutes]`, which assumes the 1-minute grid.
- All tunables live in `DetectorParams`; four of them are query params on the alerts endpoint and
  sidebar sliders in the frontend (`window`, `score_threshold`, `hold`, `vol_min_ratio`). Tuning belongs
  in that dataclass, not in call sites; the frontend's `DEFAULT_PARAMS` in `App.tsx` mirrors the
  dataclass defaults and should move with them.
- `validate.py` counts a hit when any alert's **`peak`** (not `confirmed_at`) lands within
  `tolerance_min` (60) of the event; drift alerts count too, and uncached events get `fired=None`,
  which `summary()` skips.

### API (`api.py`) and frontend

`api.py` is a thin FastAPI layer; it owns no logic beyond JSON shaping and caching. Routes:
`GET /api/markets` (cached markets from `markets.yaml` plus the synthetic demo, always last),
`GET /api/markets/{id}/series`, `GET /api/markets/{id}/alerts?window&score_threshold&hold&vol_min_ratio`,
`POST /api/explain {market_id, spike, query}`, `GET /api/exposure/{event_type}`. Series, explanations
and exposure are `lru_cache`'d per process, so a cache re-pull (`pull_data.py`) needs a server restart to
show up, and EDGAR is hit once per event type instead of once per card per tick. The frontend memoises
explain/exposure again per alert key in `api.ts`, so replay ticks never refetch. `Spike` round-trips
through `spike_to_json`/`spike_from_json`; the explain endpoint takes the alert JSON back verbatim.
If `frontend/dist` exists at import time the API mounts it at `/`, so one process serves the demo.

Frontend state lives in `App.tsx` (market, detector inputs, news query, replay `pos`/`playing`/`speed`,
theme); `?market=<id>` in the URL selects a market and is kept in sync. Components are function
components with hooks: `Sidebar`, `ReplayControls`, `MarketChart` (imperative `Plotly.react` inside a
`useEffect`; colors are read from CSS custom properties so the chart follows the light/dark tokens in
`styles.css`), `AlertCard` (fetches its own explanation and exposure once). Pure helpers and their
tests are in `src/lib/replay.ts`.

### External services and their failure mode

Every outward call degrades instead of raising, because the demo must always render: `explain.explain()`
falls back to a headline template without `GEMINI_API_KEY` or on any exception; `explain.headlines()`
and `expose.edgar_companies()` return `[]` on HTTP or JSON errors (EDGAR also needs `SEC_USER_AGENT`).
Keep that property. The LLM is Google Gemini (free tier) via the `google-genai` SDK:
`genai.Client(api_key=...).models.generate_content(model, contents=prompt)`; a blocked or empty response
(`resp.text` is `None`) also falls back. The model defaults to `gemini-flash-lite-latest` (override with
`GEMINI_MODEL`); free-tier quotas are a few requests per minute, which the per-alert caching keeps well under.
GDELT rate-limits to one request per 5 seconds and answers a plain-text scolding (not JSON) when
exceeded, which `headlines()` turns into `[]` — so bursts of alert cards can all show "Cause unclear".

The GDELT news query is **not** per-market config — it is a single sidebar text box defaulting to
`'"Federal Reserve" OR Powell'` (`DEFAULT_NEWS_QUERY` in both `api.py` and `api.ts`), so non-Fed
markets get Fed headlines unless the user edits it.

### Config as data

`backend/config/markets.yaml` lists the watched markets; each carries an `event_type` key that indexes
`backend/config/exposure.yaml` (ETFs, EDGAR query, `direction_note` shown on the card and fed to the
explainer). Adding a market or an event type is a YAML edit, not a code change.
`backend/dislocation_desk/config.py` is the only place that reads `.env` or those files. `.env` is
read from the repo root first, then `backend/`. Both YAML loaders are `@lru_cache`'d, so a YAML edit
needs a process restart to show up. Env vars resolve as `os.getenv(x) or default`, so the empty values
in a copied `.env.example` fall through to the defaults (`DD_CACHE_PATH` → `backend/data/cache.duckdb`,
`GEMINI_MODEL` → `gemini-flash-lite-latest`). Polymarket entries need `token_id` — the YES outcome's **CLOB
token** (Gamma `clobTokenIds[0]`), not the market id or slug; Kalshi entries need both `series_ticker`
and `ticker` because the candlesticks URL uses both.

### Synthetic data is the test substrate

`synthetic.py` builds markets with a real jump, a fat-finger print and a slow drift injected at known
bars; `backend/tests/` asserts the detector fires on the first and third and not the second. Most tests
build their own single-event series (jump at bar 700 with volume ×6, fat-finger at bar 500, drift at
bar 600); only `test_demo_market_end_to_end` and `tests/test_api.py` use `demo_market()` (fat-finger at
420, jump at 700, drift from 1000). Tests never touch the network: `test_api.py` points the cache at a
temp DuckDB and stubs `headlines` and `edgar_companies`. `demo_market()` is also what the API serves as
`synthetic-demo` before any real data is cached — built in-process, not read from the cache — and real
cached markets are listed first so they take the default slot once they exist.

## Current state

Working and tested: `detect.py`, `replay.py`, `ingest/cache.py`, `api.py`, the frontend on synthetic and
cached data. Kalshi ingest is live-tested (dollar-string prices, `volume_fp`). Five markets are cached
locally as of 2026-10-09 (`backend/data/cache.duckdb` is gitignored; re-pull with `pull_data.py`).

Not yet live-verified: `explain.headlines` returned no articles in a manual probe (GDELT rate limit or
query shape, unclear), `expose.edgar_companies` has returned `[]` so far, `validation/known_events.yaml`
holds TODO events. Polymarket volume (`trades_volume`) is live-tested as of 2026-10-09. Trading is
bursty: on every live market the *median* 15-minute window has zero volume, so `DetectorParams.min_volume`
(100 shares/contracts) floors the "usual" level; without it any single trade earned full `vol_conf`.
On a thin market like `tariffs` (391 shares in a week) neither jumps nor drifts fire any more.
Known cosmetic issue: `Spike.headline()` formats
prices with `.0%`, so a sub-1% market reads "1% → 0%".
