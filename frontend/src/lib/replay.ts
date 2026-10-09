/** Pure helpers for the replay clock. Kept free of React so they can be unit-tested. */

import type { Alert } from "../types";

/** Alerts the desk could honestly have shown at `now` (same rule as backend replay.py). */
export function visibleAlerts(alerts: Alert[], now: string | undefined): Alert[] {
  if (!now) return [];
  const nowMs = Date.parse(now);
  return alerts.filter((a) => Date.parse(a.confirmed_at) <= nowMs);
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** Stable identity for an alert across refetches with the same params. */
export function alertKey(a: Alert): string {
  return `${a.kind}@${a.peak}`;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "HH:MM" in UTC. */
export function fmtHM(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** "YYYY-MM-DD HH:MM" in UTC. */
export function fmtClock(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${fmtHM(iso)}`;
}

export function pct(x: number, digits = 0): string {
  return `${(x * 100).toFixed(digits)}%`;
}
