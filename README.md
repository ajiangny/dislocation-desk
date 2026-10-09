# Dislocation Desk

**Which event odds just broke, why, and which names are exposed.**

Hack Knight 2026 · track: *Prediction Markets as a Financial Signal* (Diameter Capital Partners).

A credit analyst can't watch a thousand Polymarket and Kalshi markets. Dislocation Desk watches the
macro ones (Fed, CPI, tariffs, shutdown, recession), flags the moments the odds reprice, explains the
move from the news in that window, and lists the credit ETFs and companies exposed.

> **A spike is a move that is big, backed by real money, and sticks.**

## Quick start

```bash
# backend (Python: ingest, detector, explain, expose, HTTP API)
python -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.txt
cp .env.example .env            # add ANTHROPIC_API_KEY and SEC_USER_AGENT
cd backend && pytest            # detector + API tests on synthetic data
uvicorn dislocation_desk.api:app --reload --port 8000

# frontend (TypeScript: React + Vite), in a second terminal
cd frontend && npm install
npm run dev                     # http://localhost:5173, proxies /api to :8000
```

For a single-process demo, `npm run build` writes `frontend/dist` and the backend serves it at
http://localhost:8000/.

The dashboard lists every market with cached data plus a **synthetic demo market** (a fat-finger
print, a real jump and a slow drift) so it works before any real data is pulled. Press **Play from
start** to replay the day; `?market=<id>` in the URL picks a market.

### First hour with real data

The API endpoints were written from the official docs. Live calls were blocked in the sandbox
this was scaffolded in, so **nothing has been tested against the real APIs yet.** Do this first:

```bash
cd backend
python scripts/smoke_test_apis.py          # hits Polymarket, Kalshi, GDELT, EDGAR once each
python scripts/find_markets.py fed         # Polymarket: copy the YES token_id
python scripts/find_markets.py --kalshi KXFED
# paste IDs into config/markets.yaml, then:
python scripts/pull_data.py --start 2025-12-09 --end 2025-12-11
```

Fix any field names the smoke test complains about in `backend/dislocation_desk/ingest/`. The Kalshi series
tickers in `config/markets.yaml` are guesses too.

## Architecture

```
Polymarket ─┐
            ├─► 1. ingest ─► DuckDB cache ─► 2. detect ─┬─► 3. explain (GDELT + Claude) ─┐
Kalshi ─────┘                                  ▲        └─► 4. expose  (EDGAR + ETF map) ─┴─► 5. api ─► frontend
                                               │
                         replay clock (demo) ──┘   validation harness (proof slide)
```

| # | Component | File | Status |
|---|---|---|---|
| 1 | **Ingest**: price + volume into a local cache | `dislocation_desk/ingest/` | Written, not live-tested. Polymarket volume is a TODO |
| 2 | **Detect**: jump + drift alerts | `dislocation_desk/detect.py` | **Working, tested** |
| 3 | **Explain**: headlines in the window, Claude writes the "why" | `dislocation_desk/explain.py` | Written; falls back to a template without a key |
| 4 | **Expose**: event to ETFs + companies naming the risk in filings | `dislocation_desk/expose.py`, `config/exposure.yaml` | ETF map done; EDGAR search written, not live-tested |
| 5 | **API**: markets, series, alerts, explain, exposure over HTTP | `dislocation_desk/api.py` | **Working, tested** |
| 5 | **Dashboard**: chart, alert markers, alert cards, replay | `frontend/` (React + TypeScript) | **Working** on synthetic and cached data |
| · | Replay clock | `dislocation_desk/replay.py` | Working |
| · | Validation harness | `dislocation_desk/validate.py`, `validation/known_events.yaml` | Working; needs real events + cached data |

### The detector (`detect.py`)

Runs on a 1-minute grid per market.

| Test | How | Why |
|---|---|---|
| **Big?** | Price to log-odds, `logit(p) = ln(p/(1-p))`, smoothed with a 5-bar rolling median. Change over a 15-min window, scored as a **robust z**: `(Δ − rolling median) / (1.4826 × rolling MAD)` over the past 4 h | Log-odds makes 2%→6% count as much as it should. Median/MAD aren't distorted by earlier spikes. The smoothing means a 1-2 bar stray print can't be either end of a move |
| **Real money?** | Window volume ÷ its usual level. No excess volume earns 0, 2× or more earns full credit | Filters a single small trade moving a thin book |
| **Sticks?** | Share of the move still in place 30 min later (0 to 1) | Filters fat-finger prints that revert |

`score = |robust z| × volume confirmation × persistence`; alert when `score ≥ 4`, with a 60-min cooldown.

**Drift alerts:** a two-sided **CUSUM** on standardized 15-minute log-odds changes catches slow grinds
that never have one big jump. Its reference mean is zero (a fair market price shouldn't drift), so the
trend isn't absorbed into a rolling baseline.

**No look-ahead in the demo:** the persistence check needs 30 minutes of future data, so every alert
carries `confirmed_at`, and the replay only shows an alert once the clock passes that time.

**Tests** (`backend/tests/`): no alerts on 5 quiet random-walk days, a real jump fires within 30 min of
injection, a fat-finger doesn't fire, a jump without volume scores lower, a slow drift is caught by
CUSUM and not by the jump detector, plus cache and replay checks. A quick run over 30 quiet synthetic
days gave zero false alarms. Real data will be noisier: tune on it.

All parameters live in `DetectorParams` and are exposed as sliders in the dashboard.

## Repo layout

```
backend/
  config/markets.yaml         markets to watch
  config/exposure.yaml        event type → ETFs, EDGAR query, direction note
  dislocation_desk/
    api.py                    FastAPI app the frontend talks to (also serves frontend/dist)
    detect.py                 spike detector (jump + drift)
    ingest/                   polymarket.py, kalshi.py, cache.py (DuckDB)
    explain.py                GDELT headlines + Claude "why"
    expose.py                 ETF map + EDGAR full-text search
    replay.py                 replay clock (the frontend applies the same confirmed_at rule)
    validate.py               hit rate / false-alarm rate on known events
    synthetic.py              synthetic markets for tests and the empty-cache demo
  scripts/                    smoke_test_apis, find_markets, pull_data, seed_demo_data, run_validation
  validation/known_events.yaml  events for the proof slide
  tests/                      detector, cache/replay and API tests
frontend/                     React 19 + TypeScript + Vite
  src/App.tsx                 state: market, detector params, replay clock
  src/api.ts                  typed client for /api; memoises explain + exposure per alert
  src/components/             Sidebar, ReplayControls, MarketChart (Plotly), AlertCard
  src/lib/replay.ts           visibleAlerts (confirmed_at <= now) and formatters, unit-tested
```

## Suggested split (4 people)

1. **Ingest + cache:** smoke test, real market IDs, Polymarket volume via trades, pull the demo days.
2. **Detector + validation:** tune on real data, fill `known_events.yaml` with 5-10 events and quiet days, produce the hit-rate number.
3. **Dashboard (`frontend/`):** polish the alert card and replay; pick the demo day.
4. **Explain + expose + slides:** news query per market, prompt tuning, cache EDGAR results per event type.

## Data sources (docs-verified, not yet live-tested)

- **Polymarket:** Gamma `gamma-api.polymarket.com/markets` to find markets; CLOB
  `clob.polymarket.com/prices-history?market=<token_id>&startTs=&endTs=&fidelity=1`. `market` is the
  **CLOB token ID**, not the market id or slug. No volume in this endpoint.
- **Kalshi:** `api.elections.kalshi.com/trade-api/v2/series/{series}/markets/{ticker}/candlesticks?start_ts=&end_ts=&period_interval=1`.
  Prices in cents, includes volume. No auth for market data.
- **GDELT DOC 2.0:** `api.gdeltproject.org/api/v2/doc/doc?mode=artlist&format=json&startdatetime=&enddatetime=`. No key.
- **SEC EDGAR full-text search:** `efts.sec.gov/LATEST/search-index?q=...&forms=10-K`. Needs a `User-Agent` with a name and email.
- **Claude API:** the explainer defaults to `claude-opus-5-5` at low effort (override with `CLAUDE_MODEL`) and
  opts into server-side refusal fallbacks.
- **yfinance** (for the lead/lag stretch slide): 1-minute bars only cover about the last 7 days.
