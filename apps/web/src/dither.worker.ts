import { runPipeline } from "@dither-dally/core";
import type { RenderRequest, RenderResponse } from "./protocol.ts";

// Typed narrowly so this file doesn't need the WebWorker lib (which clashes with DOM).
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<RenderRequest>) => void) | null;
  postMessage(message: RenderResponse, transfer: Transferable[]): void;
};

scope.onmessage = (e) => {
  const req = e.data;
  try {
    const t0 = performance.now();
    const input = { width: req.width, height: req.height, data: new Uint8ClampedArray(req.buffer) };
    const out = runPipeline(input, { layers: req.layers, palette: req.palette, seed: req.seed, color: req.color });
    const ms = performance.now() - t0;
    // The pipeline may return its input unchanged (every layer disabled); copy so we can transfer.
    const data = out.data === input.data ? out.data.slice() : out.data;
    const buffer = data.buffer as ArrayBuffer;
    scope.postMessage({ requestId: req.requestId, ok: true, width: out.width, height: out.height, buffer, ms }, [buffer]);
  } catch (err) {
    scope.postMessage({ requestId: req.requestId, ok: false, error: err instanceof Error ? err.message : String(err) }, []);
  }
};
