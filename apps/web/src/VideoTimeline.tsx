import type { CSSProperties } from "react";
import { PauseIcon, PlayIcon } from "./icons.tsx";
import { formatTime } from "./time.ts";

interface Props {
  start: number;
  duration: number;
  time: number;
  playing: boolean;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (t: number) => void;
  /** Horizontal space taken by side panels, so the bar spans the visible canvas. */
  insets: { left: number; right: number };
}

/** Play/pause, current time and a scrubber, floating above the zoom control. */
export function VideoTimeline({ start, duration, time, playing, onPlay, onPause, onSeek, insets }: Props) {
  const end = Math.max(start + 0.001, duration);
  const fill = ((time - start) / (end - start)) * 100;
  return (
    <div className="timeline" style={{ left: insets.left + 16, right: insets.right + 16 }} onPointerDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="hud-btn"
        aria-label={playing ? "Pause" : "Play"}
        title={playing ? "Pause (Space)" : "Play (Space)"}
        onClick={playing ? onPause : onPlay}
      >
        {playing ? <PauseIcon size={14} /> : <PlayIcon size={14} />}
      </button>
      <span className="time">{formatTime(time - start)}</span>
      <input
        className="slider scrubber"
        type="range"
        aria-label="Position in video"
        min={start}
        max={end}
        step={0.01}
        value={time}
        style={{ "--fill": `${fill}%` } as CSSProperties}
        onChange={(e) => onSeek(Number(e.target.value))}
      />
      <span className="time">{formatTime(end - start)}</span>
    </div>
  );
}
