import { SteadyDither, runPipeline } from "@dither-dally/core";
import { createGlyphRasterizer } from "./glyphRaster.ts";
import type { RenderRequest, RenderResponse } from "./protocol.ts";

// Typed narrowly so this file doesn't need the WebWorker lib (which clashes with DOM).
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<RenderRequest>) => void) | null;
  postMessage(message: RenderResponse, transfer: Transferable[]): void;
};

/** Text styles draw their characters in the system monospace font. */
const glyphs = createGlyphRasterizer();

/**
 * Steady-dots state for consecutive video frames. Any change to the settings
 * (or the frame size) starts it over, so an edit is never hidden behind dots
 * kept from before it.
 */
let steady: { signature: string; state: SteadyDither } | null = null;

function steadyFor(req: RenderRequest): SteadyDither | undefined {
  if (!req.steady) return undefined;
  const signature = JSON.stringify([req.layers, req.palette, req.seed, req.color, req.steady, req.width, req.height]);
  if (steady?.signature !== signature) steady = { signature, state: new SteadyDither(req.steady) };
  return steady.state;
}

scope.onmessage = (e) => {
  const req = e.data;
  try {
    const t0 = performance.now();
    const input = { width: req.width, height: req.height, data: new Uint8ClampedArray(req.buffer) };
    const out = runPipeline(input, { layers: req.layers, palette: req.palette, seed: req.seed, color: req.color, glyphs, steady: steadyFor(req) });
    const ms = performance.now() - t0;
    // The pipeline may return its input unchanged (every layer disabled); copy so we can transfer.
    const data = out.data === input.data ? out.data.slice() : out.data;
    const buffer = data.buffer as ArrayBuffer;
    scope.postMessage({ requestId: req.requestId, ok: true, width: out.width, height: out.height, buffer, ms }, [buffer]);
  } catch (err) {
    scope.postMessage({ requestId: req.requestId, ok: false, error: err instanceof Error ? err.message : String(err) }, []);
  }
};
