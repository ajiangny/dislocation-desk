/** Wire types for the backend API (backend/dislocation_desk/api.py). */

export interface Market {
  id: string;
  name: string;
  venue: "polymarket" | "kalshi" | "synthetic";
  event_type: string;
}

export interface Series {
  market_id: string;
  /** ISO-8601 UTC timestamps on a 1-minute grid. */
  ts: string[];
  /** Probability in [0, 1]. */
  price: number[];
  /** Per-bar volume; null when the venue reports none (Polymarket). */
  volume: (number | null)[] | null;
}

/** The four detector tunables exposed in the sidebar. */
export interface DetectorInputs {
  window: number;
  score_threshold: number;
  hold: number;
  vol_min_ratio: number;
}

/** Full DetectorParams dataclass as the backend resolved it. */
export interface DetectorParams extends DetectorInputs {
  baseline: number;
  min_scale: number;
  cooldown: number;
  smooth: number;
  drift_bar: number;
  drift_baseline: number;
  cusum_k: number;
  cusum_h: number;
  eps: number;
}

export type AlertKind = "jump" | "drift";

/** Mirrors detect.Spike plus `direction` and `headline`. */
export interface Alert {
  market_id: string;
  kind: AlertKind;
  start: string;
  peak: string;
  /** Earliest time the alert could honestly be shown live; the replay filters on this. */
  confirmed_at: string;
  p_before: number;
  p_after: number;
  z: number;
  volume_ratio: number | null;
  persistence: number;
  score: number;
  direction: "up" | "down";
  headline: string;
}

export interface AlertsResponse {
  market_id: string;
  params: DetectorParams;
  alerts: Alert[];
}

export interface Headline {
  title: string;
  url: string;
  domain: string;
  seendate: string;
}

export interface Explanation {
  why: string;
  headlines: Headline[];
}

export interface Exposure {
  label: string;
  etfs: string[];
  companies: { company: string; filings: number }[];
  note: string;
}
