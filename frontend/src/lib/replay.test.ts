import { describe, expect, it } from "vitest";

import type { Alert } from "../types";
import { clamp, fmtClock, fmtHM, pct, visibleAlerts } from "./replay";

const alert = (confirmed_at: string, kind: Alert["kind"] = "jump"): Alert => ({
  market_id: "m",
  kind,
  start: "2025-12-10T23:25:00+00:00",
  peak: "2025-12-10T23:40:00+00:00",
  confirmed_at,
  p_before: 0.38,
  p_after: 0.61,
  z: 6.2,
  volume_ratio: 4,
  persistence: 1,
  score: 6.2,
  direction: "up",
  headline: "38% → 61% in 15 min",
});

describe("visibleAlerts", () => {
  const alerts = [alert("2025-12-11T00:10:00+00:00"), alert("2025-12-11T03:00:00+00:00", "drift")];

  it("hides alerts until the clock passes confirmed_at", () => {
    expect(visibleAlerts(alerts, "2025-12-11T00:09:00+00:00")).toEqual([]);
    expect(visibleAlerts(alerts, "2025-12-11T00:10:00+00:00")).toHaveLength(1);
    expect(visibleAlerts(alerts, "2025-12-11T03:00:00+00:00")).toHaveLength(2);
  });

  it("shows nothing with no clock", () => {
    expect(visibleAlerts(alerts, undefined)).toEqual([]);
  });
});

describe("formatting", () => {
  it("prints UTC regardless of host zone", () => {
    expect(fmtHM("2025-12-10T23:40:00+00:00")).toBe("23:40");
    expect(fmtClock("2025-12-10T23:40:00+00:00")).toBe("2025-12-10 23:40");
  });
  it("percent and clamp", () => {
    expect(pct(0.614)).toBe("61%");
    expect(pct(0.614, 1)).toBe("61.4%");
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
  });
});
