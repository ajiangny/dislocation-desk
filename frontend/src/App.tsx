import { useEffect, useMemo, useState } from "react";

import { DEFAULT_NEWS_QUERY, fetchAlerts, fetchMarkets, fetchSeries } from "./api";
import AlertCard from "./components/AlertCard";
import MarketChart from "./components/MarketChart";
import ReplayControls from "./components/ReplayControls";
import Sidebar from "./components/Sidebar";
import { alertKey, clamp, fmtClock, visibleAlerts } from "./lib/replay";
import { applyTheme, initialTheme, type Theme } from "./lib/theme";
import type { AlertsResponse, DetectorInputs, Market, Series } from "./types";

const DEFAULT_PARAMS: DetectorInputs = { window: 15, score_threshold: 4, hold: 30, vol_min_ratio: 2 };
const TICK_MS = 150;

/** `?market=<id>` makes a demo day linkable; falls back to the first cached market. */
function marketFromUrl(): string {
  return new URLSearchParams(window.location.search).get("market") ?? "";
}

function syncUrl(marketId: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set("market", marketId);
  window.history.replaceState(null, "", url);
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [marketId, setMarketId] = useState<string>(marketFromUrl);
  const [params, setParams] = useState<DetectorInputs>(DEFAULT_PARAMS);
  const [newsQuery, setNewsQuery] = useState(DEFAULT_NEWS_QUERY);
  const [speed, setSpeed] = useState(15);

  const [series, setSeries] = useState<Series | null>(null);
  const [alertsResp, setAlertsResp] = useState<AlertsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [pos, setPos] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => applyTheme(theme), [theme]);

  // Markets once; real cached markets come first, the synthetic demo last.
  useEffect(() => {
    fetchMarkets()
      .then((ms) => {
        setMarkets(ms);
        setMarketId((cur) => (ms.some((m) => m.id === cur) ? cur : (ms[0]?.id ?? "")));
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  // Series on market change; the clock rewinds to the end (everything visible).
  useEffect(() => {
    if (!marketId) return;
    syncUrl(marketId);
    const ctl = new AbortController();
    setSeries(null);
    setAlertsResp(null);
    setPlaying(false);
    fetchSeries(marketId, ctl.signal)
      .then((s) => {
        setSeries(s);
        setPos(s.ts.length);
        setError(null);
      })
      .catch((e: Error) => e.name !== "AbortError" && setError(e.message));
    return () => ctl.abort();
  }, [marketId]);

  // Alerts whenever the detector sliders move (debounced).
  useEffect(() => {
    if (!marketId) return;
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetchAlerts(marketId, params, ctl.signal)
        .then(setAlertsResp)
        .catch((e: Error) => e.name !== "AbortError" && setError(e.message));
    }, 200);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [marketId, params]);

  // Replay clock.
  const n = series?.ts.length ?? 0;
  useEffect(() => {
    if (!playing || n === 0) return;
    const id = setInterval(() => setPos((p) => Math.min(n, p + speed)), TICK_MS);
    return () => clearInterval(id);
  }, [playing, speed, n]);
  useEffect(() => {
    if (playing && pos >= n) setPlaying(false);
  }, [playing, pos, n]);

  const market = markets.find((m) => m.id === marketId);
  const baseline = alertsResp?.params.baseline ?? 240;
  const minPos = Math.min(baseline, n);
  const now = series?.ts[clamp(pos, 1, n) - 1];
  const alerts = useMemo(() => visibleAlerts(alertsResp?.alerts ?? [], now), [alertsResp, now]);

  return (
    <div className="layout">
      <Sidebar
        markets={markets}
        marketId={marketId}
        onMarket={setMarketId}
        params={params}
        onParams={setParams}
        newsQuery={newsQuery}
        onNewsQuery={setNewsQuery}
        speed={speed}
        onSpeed={setSpeed}
      />
      <main className="main">
        <div className="header">
          <div>
            <h1>Dislocation Desk</h1>
            <p className="subtitle">Which event odds just broke, why, and which names are exposed.</p>
          </div>
          <button className="btn ghost" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
            {theme === "dark" ? "☀ Light" : "☾ Dark"}
          </button>
        </div>

        {error && <div className="panel status error">{error}</div>}
        {!series && !error && <div className="panel status">Loading market…</div>}

        {series && market && (
          <>
            <ReplayControls
              pos={pos}
              min={minPos}
              max={n}
              playing={playing}
              onPlay={() => {
                setPos(minPos);
                setPlaying(true);
              }}
              onStop={() => setPlaying(false)}
              onSeek={(p) => {
                setPlaying(false);
                setPos(p);
              }}
            />
            <MarketChart series={series} pos={pos} alerts={alerts} theme={theme} />
            <div className="caption">
              Replay clock: {now ? fmtClock(now) : "—"} UTC · {alerts.length} alert(s) so far
              {alertsResp === null && " · running detector…"}
            </div>
            <div className="cards">
              {[...alerts].reverse().map((a) => (
                <AlertCard key={alertKey(a)} alert={a} market={market} newsQuery={newsQuery} />
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
