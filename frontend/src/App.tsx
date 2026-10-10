import { useEffect, useMemo, useState } from "react";

import { autoNewsQuery, fetchAlerts, fetchMarkets, fetchSeries } from "./api";
import AlertCard from "./components/AlertCard";
import MarketChart from "./components/MarketChart";
import ReplayControls from "./components/ReplayControls";
import Sidebar from "./components/Sidebar";
import { alertKey, clamp, fmtClock, visibleAlerts } from "./lib/replay";
import { useMarketSummaries } from "./lib/summaries";
import { applyTheme, initialTheme, type Theme } from "./lib/theme";
import type { AlertsResponse, DetectorInputs, Market, Series } from "./types";

const DEFAULT_PARAMS: DetectorInputs = {
  window: 15,
  score_threshold: 4,
  hold: 30,
  vol_min_ratio: 2,
};
/** At 1x a full replay lasts this long, whatever the market's length; Nx plays N times faster. */
const REPLAY_MS_AT_1X = 60_000;
const SPEEDS = [1, 2, 5, 10];

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
  const [newsOverride, setNewsOverride] = useState("");
  const [speed, setSpeed] = useState(1);

  const summaries = useMarketSummaries(markets, params);

  const [series, setSeries] = useState<Series | null>(null);
  const [alertsResp, setAlertsResp] = useState<AlertsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [pos, setPos] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [picked, setPicked] = useState<{
    key: string;
    at: { x: number; y: number };
  } | null>(null);

  useEffect(() => applyTheme(theme), [theme]);

  // Markets once; real cached markets come first, the synthetic demo last.
  useEffect(() => {
    fetchMarkets()
      .then((ms) => {
        setMarkets(ms);
        setMarketId((cur) =>
          ms.some((m) => m.id === cur) ? cur : (ms[0]?.id ?? ""),
        );
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
    setPicked(null);
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
  const baseline = alertsResp?.params.baseline ?? 240;
  const minPos = Math.min(baseline, n);
  useEffect(() => {
    if (!playing || n === 0) return;
    let raf = 0;
    let last = performance.now();
    const frame = (t: number) => {
      const dt = t - last;
      last = t;
      setPos((p) =>
        Math.min(n, p + ((n - minPos) / REPLAY_MS_AT_1X) * speed * dt),
      );
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, n, minPos]);
  useEffect(() => {
    if (playing && pos >= n) setPlaying(false);
  }, [playing, pos, n]);

  const market = markets.find((m) => m.id === marketId);
  const autoQuery = autoNewsQuery(market?.event_type);
  const newsQuery = newsOverride.trim() || autoQuery;
  const startReplay = () => {
    setPos(minPos);
    setPlaying(true);
  };
  const now = series?.ts[Math.floor(clamp(pos, 1, n)) - 1];
  const alerts = useMemo(
    () => visibleAlerts(alertsResp?.alerts ?? [], now),
    [alertsResp, now],
  );

  const selected = picked
    ? alerts.find((a) => alertKey(a) === picked.key)
    : undefined;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPicked(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="layout">
      <Sidebar
        markets={markets}
        marketId={marketId}
        onMarket={setMarketId}
        params={params}
        onParams={setParams}
        newsQuery={newsOverride}
        autoQuery={autoQuery}
        onNewsQuery={setNewsOverride}
        summaries={summaries}
      />
      <main className="main">
        <div className="header">
          <span className="header-market">{market?.name ?? ""}</span>
          <div className="header-actions">
            <div className="replay-bar">
              <button
                className="btn primary"
                onClick={startReplay}
                disabled={playing}
              >
                ▶ Play
              </button>
              <button
                className="btn"
                onClick={() => setPlaying(false)}
                disabled={!playing}
              >
                ⏹ Stop
              </button>
              <div
                className="speed-pills"
                role="group"
                aria-label="Replay speed"
              >
                {SPEEDS.map((x) => (
                  <button
                    key={x}
                    className={`pill${speed === x ? " on" : ""}`}
                    onClick={() => setSpeed(x)}
                  >
                    {x}×
                  </button>
                ))}
              </div>
            </div>
            <button
              className="btn ghost"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? "☀ Light" : "☾ Dark"}
            </button>
          </div>
        </div>

        {error && <div className="panel status error">{error}</div>}
        {!series && !error && (
          <div className="panel status">Loading market…</div>
        )}

        {series && market && (
          <>
            <div className="chart-wrap">
              <MarketChart
                series={series}
                pos={pos}
                alerts={alerts}
                theme={theme}
                onAlertClick={(a, at) => setPicked({ key: alertKey(a), at })}
              />
              {selected && picked && (
                <div
                  className="popover"
                  style={{
                    left: `clamp(236px, ${picked.at.x}px, calc(100% - 236px))`,
                    top: picked.at.y,
                  }}
                >
                  <AlertCard
                    alert={selected}
                    market={market}
                    newsQuery={newsQuery}
                    onClose={() => setPicked(null)}
                  />
                </div>
              )}
            </div>
            <ReplayControls
              pos={Math.floor(pos)}
              min={minPos}
              max={n}
              playing={playing}
              onPlay={startReplay}
              onStop={() => setPlaying(false)}
              onSeek={(p) => {
                setPlaying(false);
                setPos(p);
              }}
            />
            <div className="caption">
              Replay clock: {now ? fmtClock(now) : "—"} UTC · {alerts.length}{" "}
              alert(s) so far
              {alertsResp === null && " · running detector…"}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
