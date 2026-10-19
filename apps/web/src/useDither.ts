import { useEffect, useRef, useState } from "react";
import type { ColorSettings, Params } from "@dither-dally/core";
import type { DitherRequest, DitherResponse } from "./protocol.ts";

export interface DitherJob {
  source: ImageData | null;
  algorithmId: string;
  params: Params;
  paletteId: string;
  seed: number;
  color: ColorSettings;
}

export interface DitherResult {
  image: ImageData | null;
  ms: number | null;
  error: string | null;
  busy: boolean;
}

/**
 * Runs the job in a Web Worker whenever it changes. Only the latest request's
 * result is kept; if a newer request is pending, older results are dropped.
 */
export function useDither(job: DitherJob): DitherResult {
  const workerRef = useRef<Worker | null>(null);
  const latest = useRef(0);
  const [result, setResult] = useState<DitherResult>({ image: null, ms: null, error: null, busy: false });

  useEffect(() => {
    const worker = new Worker(new URL("./dither.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<DitherResponse>) => {
      const res = e.data;
      if (res.requestId !== latest.current) return;
      if (res.ok) {
        const image = new ImageData(new Uint8ClampedArray(res.buffer), res.width, res.height);
        setResult({ image, ms: res.ms, error: null, busy: false });
      } else {
        setResult((r) => ({ ...r, error: res.error, busy: false }));
      }
    };
    workerRef.current = worker;
    return () => worker.terminate();
  }, []);

  const { source, algorithmId, params, paletteId, seed, color } = job;
  useEffect(() => {
    const worker = workerRef.current;
    if (!worker || !source) return;
    const requestId = ++latest.current;
    const buffer = source.data.slice().buffer;
    const req: DitherRequest = {
      requestId,
      width: source.width,
      height: source.height,
      buffer,
      algorithmId,
      params,
      paletteId,
      seed,
      color,
    };
    setResult((r) => ({ ...r, busy: true }));
    worker.postMessage(req, [buffer]);
  }, [source, algorithmId, params, paletteId, seed, color]);

  return result;
}
