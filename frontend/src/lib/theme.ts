/** Theme = CSS custom properties on <html>; the chart reads them so both renderers agree. */

export type Theme = "light" | "dark";

const KEY = "dd-theme";

export function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* storage unavailable */
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(t: Theme): void {
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* ignore */
  }
}

/** Resolve a `--token` to its computed value (hex/rgba string). */
export function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export interface ChartColors {
  surface: string;
  ink: string;
  muted: string;
  grid: string;
  axis: string;
  series: string;
  volume: string;
  jump: string;
  drift: string;
  jumpWash: string;
  driftWash: string;
}

export function chartColors(): ChartColors {
  return {
    surface: token("--surface"),
    ink: token("--ink"),
    muted: token("--muted"),
    grid: token("--grid"),
    axis: token("--axis"),
    series: token("--series-1"),
    volume: token("--muted"),
    jump: token("--status-critical"),
    drift: token("--status-warning"),
    jumpWash: token("--wash-jump"),
    driftWash: token("--wash-drift"),
  };
}
