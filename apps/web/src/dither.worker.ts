import { getAlgorithm, getPalette } from "@dither-dally/core";
import type { DitherRequest, DitherResponse } from "./protocol.ts";

// Typed narrowly so this file doesn't need the WebWorker lib (which clashes with DOM).
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<DitherRequest>) => void) | null;
  postMessage(message: DitherResponse, transfer: Transferable[]): void;
};

scope.onmessage = (e) => {
  const req = e.data;
  try {
    const t0 = performance.now();
    const input = { width: req.width, height: req.height, data: new Uint8ClampedArray(req.buffer) };
    const out = getAlgorithm(req.algorithmId).run(input, getPalette(req.paletteId).colors, req.params, {
      seed: req.seed,
      color: req.color,
    });
    const ms = performance.now() - t0;
    const buffer = out.data.buffer as ArrayBuffer;
    scope.postMessage({ requestId: req.requestId, ok: true, width: out.width, height: out.height, buffer, ms }, [buffer]);
  } catch (err) {
    scope.postMessage(
      { requestId: req.requestId, ok: false, error: err instanceof Error ? err.message : String(err) },
      [],
    );
  }
};
