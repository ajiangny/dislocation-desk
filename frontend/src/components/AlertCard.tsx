import { useEffect, useState } from "react";

import { fetchExplanation, fetchExposure } from "../api";
import { fmtHM, pct } from "../lib/replay";
import type { Alert, Explanation, Exposure, Market } from "../types";

interface Props {
  alert: Alert;
  market: Market;
  newsQuery: string;
  /** When set, the card is shown as a popover on the chart: adds a close button and opens the news. */
  onClose?: () => void;
}

export default function AlertCard({ alert, market, newsQuery, onClose }: Props) {
  const [why, setWhy] = useState<Explanation | null>(null);
  const [exposure, setExposure] = useState<Exposure | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setWhy(null);
    fetchExplanation(market.id, alert, newsQuery)
      .then((r) => live && setWhy(r))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [market.id, alert, newsQuery]);

  useEffect(() => {
    let live = true;
    fetchExposure(market.event_type)
      .then((r) => live && setExposure(r))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [market.event_type]);

  const names = exposure
    ? [...exposure.etfs, ...exposure.companies.slice(0, 5).map((c) => c.company)]
    : [];

  return (
    <article className="panel card">
      {onClose && (
        <button className="close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      )}
      <div className="title">
        <span className={`tag ${alert.kind}`}>{alert.kind.toUpperCase()}</span>
        <strong>{market.name}</strong> — {alert.headline}
      </div>
      <div>
        <strong>Why:</strong>{" "}
        {why ? why.why : <span className="pending">Explaining the move…</span>}
      </div>
      <div>
        <strong>Exposed{exposure ? ` (${exposure.label})` : ""}:</strong>{" "}
        {exposure ? (
          <span className="chips">
            {names.map((n) => (
              <span className="chip" key={n}>
                {n}
              </span>
            ))}
          </span>
        ) : (
          <span className="pending">Looking up exposure…</span>
        )}
      </div>
      {exposure?.note && <div className="meta">{exposure.note}</div>}
      <div className="meta">
        Move {fmtHM(alert.start)}–{fmtHM(alert.peak)}, confirmed {fmtHM(alert.confirmed_at)} UTC · score{" "}
        {alert.score.toFixed(1)} · held {pct(alert.persistence)}
      </div>
      {why && why.headlines.length > 0 && (
        <details open={Boolean(onClose)}>
          <summary>{why.headlines.length} headlines in window</summary>
          <ul>
            {why.headlines.map((h) => (
              <li key={h.url}>
                <a href={h.url} target="_blank" rel="noreferrer">
                  {h.title}
                </a>{" "}
                · {h.domain}
              </li>
            ))}
          </ul>
        </details>
      )}
      {error && <div className="meta error">{error}</div>}
    </article>
  );
}
