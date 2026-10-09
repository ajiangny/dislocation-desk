interface Props {
  pos: number;
  min: number;
  max: number;
  playing: boolean;
  onPlay: () => void;
  onStop: () => void;
  onSeek: (pos: number) => void;
}

export default function ReplayControls({ pos, min, max, playing, onPlay, onStop, onSeek }: Props) {
  return (
    <div className="controls">
      <button className="btn primary" onClick={onPlay} disabled={playing}>
        ▶ Play from start
      </button>
      <button className="btn" onClick={onStop} disabled={!playing}>
        ⏹ Stop
      </button>
      <input
        type="range"
        aria-label="Replay time"
        min={min}
        max={max}
        value={pos}
        onChange={(e) => onSeek(Number(e.target.value))}
      />
    </div>
  );
}
