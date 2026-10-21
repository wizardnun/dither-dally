import { useEffect, useRef, useState } from "react";
import type { ColorSettings, Layer, RGB, SteadyOptions } from "@dither-dally/core";
import type { RenderRequest, RenderResponse } from "./protocol.ts";

export interface RenderJob {
  source: ImageData | null;
  layers: Layer[];
  palette: RGB[];
  seed: number;
  color: ColorSettings;
  /** Video frames only: keep dots steady from one frame to the next. */
  steady?: SteadyOptions;
  /** Run what can on the GPU, where available. */
  gpu?: boolean;
}

export interface RenderResult {
  image: ImageData | null;
  ms: number | null;
  /** Whether the GPU did any of the work. */
  gpu: boolean;
  error: string | null;
  busy: boolean;
}

export function createRenderWorker(): Worker {
  return new Worker(new URL("./dither.worker.ts", import.meta.url), { type: "module" });
}

/** Renders one job in a worker and resolves with the result. For one-off work like batch export. */
export function renderOnce(worker: Worker, job: Omit<RenderJob, "source"> & { source: ImageData }): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const requestId = Math.floor(Math.random() * 1e9);
    const onMessage = (e: MessageEvent<RenderResponse>) => {
      if (e.data.requestId !== requestId) return;
      worker.removeEventListener("message", onMessage);
      const res = e.data;
      if (res.ok) resolve(new ImageData(new Uint8ClampedArray(res.buffer), res.width, res.height));
      else reject(new Error(res.error));
    };
    worker.addEventListener("message", onMessage);
    const buffer = job.source.data.slice().buffer;
    const req: RenderRequest = {
      requestId,
      width: job.source.width,
      height: job.source.height,
      buffer,
      layers: job.layers,
      palette: job.palette,
      seed: job.seed,
      color: job.color,
      steady: job.steady,
      gpu: job.gpu,
    };
    worker.postMessage(req, [buffer]);
  });
}

/**
 * Renders the layer stack in a Web Worker whenever the job changes. Only the
 * latest request's result is kept; if a newer request is pending, older
 * results are dropped.
 */
export function useRender(job: RenderJob): RenderResult {
  const workerRef = useRef<Worker | null>(null);
  const latest = useRef(0);
  const [result, setResult] = useState<RenderResult>({ image: null, ms: null, gpu: false, error: null, busy: false });

  useEffect(() => {
    const worker = createRenderWorker();
    worker.onmessage = (e: MessageEvent<RenderResponse>) => {
      const res = e.data;
      if (res.requestId !== latest.current) return;
      if (res.ok) {
        const image = new ImageData(new Uint8ClampedArray(res.buffer), res.width, res.height);
        setResult({ image, ms: res.ms, gpu: res.gpu, error: null, busy: false });
      } else {
        setResult((r) => ({ ...r, error: res.error, busy: false }));
      }
    };
    workerRef.current = worker;
    return () => worker.terminate();
  }, []);

  const { source, layers, palette, seed, color, steady, gpu } = job;
  useEffect(() => {
    const worker = workerRef.current;
    if (!worker || !source) return;
    const requestId = ++latest.current;
    const buffer = source.data.slice().buffer;
    const req: RenderRequest = { requestId, width: source.width, height: source.height, buffer, layers, palette, seed, color, steady, gpu };
    setResult((r) => ({ ...r, busy: true }));
    worker.postMessage(req, [buffer]);
  }, [source, layers, palette, seed, color, steady, gpu]);

  return result;
}
