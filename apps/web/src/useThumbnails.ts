import { useEffect, useRef, useState } from "react";
import { ALGORITHMS, defaultParams, type ColorSettings, type Layer, type RGB } from "@dither-dally/core";
import type { RenderRequest, RenderResponse } from "./protocol.ts";
import { createRenderWorker } from "./useDither.ts";

/**
 * Renders every style on a small crop of the current image, through the
 * document's own layer stack (with the dither layer swapped for that style),
 * so thumbnails show what you'd actually get. Runs in its own worker; stale
 * batches are discarded.
 */
export function useThumbnails(
  source: ImageData | null,
  layers: Layer[],
  palette: RGB[],
  seed: number,
  color: ColorSettings,
): Record<string, ImageData> {
  const [thumbs, setThumbs] = useState<Record<string, ImageData>>({});
  const workerRef = useRef<Worker | null>(null);
  const batch = useRef(0);

  useEffect(() => {
    const worker = createRenderWorker();
    workerRef.current = worker;
    return () => worker.terminate();
  }, []);

  useEffect(() => {
    const worker = workerRef.current;
    if (!worker || !source) return;
    // Wait for a pause (e.g. the end of a slider drag) so the worker doesn't queue up stale batches.
    const timer = setTimeout(() => render(worker, source), batch.current === 0 ? 0 : 300);
    return () => clearTimeout(timer);
  }, [source, layers, palette, seed, color]);

  function render(worker: Worker, source: ImageData) {
    const thisBatch = ++batch.current;
    // Request ids encode batch and style index.
    const base = thisBatch * 1000;
    worker.onmessage = (e: MessageEvent<RenderResponse>) => {
      const res = e.data;
      if (Math.floor(res.requestId / 1000) !== batch.current || !res.ok) return;
      const algo = ALGORITHMS[res.requestId - base];
      if (!algo) return;
      const image = new ImageData(new Uint8ClampedArray(res.buffer), res.width, res.height);
      setThumbs((t) => ({ ...t, [algo.id]: image }));
    };
    ALGORITHMS.forEach((algo, i) => {
      const buffer = source.data.slice().buffer;
      const swapped = layers.map((l) =>
        l.kind === "dither" ? { ...l, enabled: true, algorithm: algo.id, params: defaultParams(algo) } : l,
      );
      const req: RenderRequest = {
        requestId: base + i,
        width: source.width,
        height: source.height,
        buffer,
        layers: swapped,
        palette,
        seed,
        color,
      };
      worker.postMessage(req, [buffer]);
    });
  }

  return thumbs;
}
