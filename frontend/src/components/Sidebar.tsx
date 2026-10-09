import type { DetectorInputs, Market } from "../types";

interface Props {
  markets: Market[];
  marketId: string;
  onMarket: (id: string) => void;
  params: DetectorInputs;
  onParams: (p: DetectorInputs) => void;
  newsQuery: string;
  onNewsQuery: (q: string) => void;
  speed: number;
  onSpeed: (s: number) => void;
}

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}

function Slider({ label, value, min, max, step = 1, format = String, onChange }: SliderProps) {
  return (
    <label className="field">
      <span>
        {label} <b>{format(value)}</b>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

export default function Sidebar(p: Props) {
  const set = (patch: Partial<DetectorInputs>) => p.onParams({ ...p.params, ...patch });
  return (
    <aside className="sidebar">
      <label className="field">
        <span>Market</span>
        <select value={p.marketId} onChange={(e) => p.onMarket(e.target.value)}>
          {p.markets.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>

      <h2>Detector</h2>
      <Slider label="Jump window (min)" value={p.params.window} min={5} max={60} onChange={(v) => set({ window: v })} />
      <Slider
        label="Alert threshold (score)"
        value={p.params.score_threshold}
        min={2}
        max={10}
        step={0.5}
        format={(v) => v.toFixed(1)}
        onChange={(v) => set({ score_threshold: v })}
      />
      <Slider label="Must hold for (min)" value={p.params.hold} min={5} max={120} onChange={(v) => set({ hold: v })} />
      <Slider
        label="Volume needed (× usual)"
        value={p.params.vol_min_ratio}
        min={1.5}
        max={10}
        step={0.5}
        format={(v) => `${v.toFixed(1)}×`}
        onChange={(v) => set({ vol_min_ratio: v })}
      />

      <h2>Explain</h2>
      <label className="field">
        <span>News query for this market</span>
        <input type="text" value={p.newsQuery} onChange={(e) => p.onNewsQuery(e.target.value)} />
      </label>

      <h2>Replay</h2>
      <Slider label="Speed (bars per tick)" value={p.speed} min={1} max={60} onChange={p.onSpeed} />
    </aside>
  );
}
