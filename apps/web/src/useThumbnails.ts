import { useEffect, useRef, useState } from "react";
import { ALGORITHMS, defaultParams, type ColorSettings } from "@dither-dally/core";
import type { DitherRequest, DitherResponse } from "./protocol.ts";

/**
 * Renders every algorithm, at default settings, on a small crop of the
 * current image, in a worker of its own so the main preview never waits.
 * Stale batches are discarded.
 */
export function useThumbnails(
  source: ImageData | null,
  paletteId: string,
  seed: number,
  color: ColorSettings,
): Record<string, ImageData> {
  const [thumbs, setThumbs] = useState<Record<string, ImageData>>({});
  const workerRef = useRef<Worker | null>(null);
  const batch = useRef(0);

  useEffect(() => {
    const worker = new Worker(new URL("./dither.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    return () => worker.terminate();
  }, []);

  useEffect(() => {
    const worker = workerRef.current;
    if (!worker || !source) return;
    const thisBatch = ++batch.current;
    // Request ids encode batch and algorithm index.
    const base = thisBatch * 1000;
    worker.onmessage = (e: MessageEvent<DitherResponse>) => {
      const res = e.data;
      if (Math.floor(res.requestId / 1000) !== batch.current || !res.ok) return;
      const algo = ALGORITHMS[res.requestId - base];
      if (!algo) return;
      const image = new ImageData(new Uint8ClampedArray(res.buffer), res.width, res.height);
      setThumbs((t) => ({ ...t, [algo.id]: image }));
    };
    ALGORITHMS.forEach((algo, i) => {
      const buffer = source.data.slice().buffer;
      const req: DitherRequest = {
        requestId: base + i,
        width: source.width,
        height: source.height,
        buffer,
        algorithmId: algo.id,
        params: defaultParams(algo),
        paletteId,
        seed,
        color,
      };
      worker.postMessage(req, [buffer]);
    });
  }, [source, paletteId, seed, color]);

  return thumbs;
}
