import { useEffect, useRef, useState } from "react";
import type { RenderResult } from "./useDither.ts";

/** Renders quicker than this never show "Rendering…", so fast updates don't flicker. */
const BUSY_DELAY = 300;
/** While a video plays, the render time updates at most this often. */
const PLAYING_INTERVAL = 500;

/**
 * Text for the zoom box's status, steady enough to read while a video plays:
 * "Rendering…" only for slow renders, and during playback a smoothed time per
 * frame instead of one that changes every frame. Stills show the exact time.
 */
export function useStatus(result: RenderResult, playing: boolean, previewName: string | null): string {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!result.busy) return setSlow(false);
    const t = setTimeout(() => setSlow(true), BUSY_DELAY);
    return () => clearTimeout(t);
  }, [result.busy]);

  const [ms, setMs] = useState<number | null>(null);
  const average = useRef<number | null>(null);
  const lastShown = useRef(0);
  useEffect(() => {
    if (result.ms === null) return;
    if (!playing) {
      average.current = null;
      setMs(result.ms);
      return;
    }
    average.current = average.current === null ? result.ms : average.current * 0.8 + result.ms * 0.2;
    const wait = lastShown.current + PLAYING_INTERVAL - performance.now();
    const show = () => {
      lastShown.current = performance.now();
      setMs(average.current);
    };
    if (wait <= 0) return show();
    // Trailing update, so the last value still appears when frames stop.
    const t = setTimeout(show, wait);
    return () => clearTimeout(t);
  }, [result.ms, result.image, playing]);

  if (previewName) return `Preview: ${previewName}`;
  if (slow) return "Rendering…";
  if (ms === null) return "";
  return playing ? `${Math.round(ms)} ms/frame` : `${Math.round(ms)} ms`;
}
