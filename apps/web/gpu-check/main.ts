/**
 * Compares the GPU layers with the CPU reference in core. Not part of the
 * app: run it with `npm run gpu-check -w @dither-dally/web` in a browser
 * with WebGPU. Dither layers may differ only at floating-point ties;
 * effects by at most 1 per channel.
 */
import {
  DEFAULT_COLOR,
  ditherLayer,
  effectLayer,
  getPalette,
  runPipeline,
  type Layer,
  type PipelineSettings,
  type PixelBuffer,
} from "@dither-dally/core";
import { GpuAccelerator } from "../src/gpu.ts";

/** Dither layers may differ in at most this share of pixels (exact ties); effects in at most 1% of pixels, by ±1. */
const MAX_DITHER_DIFF = 0.001;
const MAX_EFFECT_SHARE = 0.01;

/** A photo-like test image: gradients, a disc, fine stripes and noise. */
function photo(w: number, h: number): PixelBuffer {
  const data = new Uint8ClampedArray(w * h * 4);
  let s = 12345;
  const rand = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 2 ** 32);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const disc = Math.hypot(x - w * 0.6, y - h * 0.45) < h * 0.25 ? 60 : 0;
      const stripes = (x >> 3) % 2 ? 12 : 0;
      data[i] = (x / w) * 230 + disc + rand() * 10;
      data[i + 1] = (y / h) * 230 + stripes + rand() * 10;
      data[i + 2] = ((x + y) / (w + h)) * 255 - disc / 2 + rand() * 10;
      data[i + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

const withParams = (layer: Layer, params: Record<string, string | number | boolean>): Layer => ({ ...layer, params: { ...layer.params, ...params } }) as Layer;

const CASES: { label: string; layer: Layer }[] = [
  { label: "Bayer 8×8", layer: withParams(ditherLayer("bayer"), { size: "8" }) },
  { label: "Bayer curved", layer: withParams(ditherLayer("bayer"), { size: "4", curve: 70 }) },
  { label: "Blue noise curved", layer: withParams(ditherLayer("blue-noise"), { curve: 100 }) },
  { label: "Blue noise 64", layer: ditherLayer("blue-noise") },
  { label: "White noise", layer: ditherLayer("white-noise") },
  ...["round", "diamond", "square", "line"].map((shape) => ({ label: `Halftone ${shape}`, layer: withParams(ditherLayer("halftone"), { shape, angle: 30 }) })),
  { label: "Wave lines", layer: withParams(ditherLayer("wave-lines"), { angle: 20, amplitude: 9 }) },
  { label: "Rings", layer: withParams(ditherLayer("rings"), { cx: 30 }) },
  { label: "Spiral ×3 ccw", layer: withParams(ditherLayer("spiral"), { arms: 3, turn: "ccw" }) },
  { label: "Crosshatch", layer: ditherLayer("crosshatch") },
  { label: "Checker 3px", layer: withParams(ditherLayer("checker"), { size: 3 }) },
  { label: "Moiré", layer: ditherLayer("moire") },
  { label: "Stipple", layer: ditherLayer("stipple") },
  { label: "Edges", layer: ditherLayer("edges") },
  { label: "Echoes", layer: ditherLayer("echoes") },
  { label: "Edges fill r0", layer: withParams(ditherLayer("edges"), { fill: true, smoothing: 0, invert: true }) },
  { label: "Blur r6", layer: withParams(effectLayer("blur"), { radius: 6 }) },
  { label: "Sharpen", layer: effectLayer("sharpen") },
  { label: "Bloom", layer: withParams(effectLayer("bloom"), { threshold: 120 }) },
  { label: "Subpixels", layer: effectLayer("subpixels") },
  { label: "Subpixels LED", layer: withParams(effectLayer("subpixels"), { layout: "led", sample: "centre", cell: 9, focus: 0 }) },
  { label: "Glow orbs", layer: withParams(effectLayer("orbs"), { count: 12, color: "#ffcc88" }) },
];
const PALETTES = ["mono", "ega-16", "web-216"];

function compare(a: PixelBuffer, b: PixelBuffer) {
  let differ = 0;
  let maxDelta = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const d = Math.max(Math.abs(a.data[i]! - b.data[i]!), Math.abs(a.data[i + 1]! - b.data[i + 1]!), Math.abs(a.data[i + 2]! - b.data[i + 2]!), Math.abs(a.data[i + 3]! - b.data[i + 3]!));
    if (d) differ++;
    maxDelta = Math.max(maxDelta, d);
  }
  return { share: differ / (a.width * a.height), maxDelta };
}

async function main() {
  const out = document.getElementById("out")!;
  const gpu = await GpuAccelerator.create();
  if (!gpu) {
    out.textContent = "WebGPU isn't available in this browser.";
    (window as unknown as { gpuCheck: unknown }).gpuCheck = { available: false };
    return;
  }
  const rows: string[] = [];
  const results: { label: string; palette: string; size: string; share: number; maxDelta: number; cpuMs: number; gpuMs: number; pass: boolean }[] = [];
  for (const [w, h] of [[800, 450], [3840, 2160]] as const) {
    const input = photo(w, h);
    for (const { label, layer } of CASES) {
      for (const pid of layer.kind === "dither" ? PALETTES : ["mono"]) {
        const s: PipelineSettings = { layers: [layer], palette: getPalette(pid).colors, seed: 7, color: DEFAULT_COLOR };
        let t = performance.now();
        const cpu = runPipeline(input, s);
        const cpuMs = performance.now() - t;
        await gpu.accelerate(layer, input, s); // warm-up
        t = performance.now();
        const fast = await gpu.accelerate(layer, input, s);
        const gpuMs = performance.now() - t;
        if (!fast) {
          rows.push(`FAIL ${label}: the GPU declined it`);
          continue;
        }
        const { share, maxDelta } = compare(cpu, fast);
        const pass = layer.kind === "dither" ? share <= MAX_DITHER_DIFF : maxDelta <= 1 && share <= MAX_EFFECT_SHARE;
        results.push({ label, palette: pid, size: `${w}×${h}`, share, maxDelta, cpuMs, gpuMs, pass });
        rows.push(
          `${pass ? "ok  " : "FAIL"} ${`${w}×${h}`.padEnd(10)} ${label.padEnd(16)} ${pid.padEnd(8)} cpu ${cpuMs.toFixed(0).padStart(5)} ms  gpu ${gpuMs.toFixed(1).padStart(6)} ms  ×${(cpuMs / gpuMs).toFixed(1).padStart(5)}  differ ${(share * 100).toFixed(3)}%${maxDelta ? ` (max ±${maxDelta})` : ""}`,
        );
        out.textContent = rows.join("\n");
      }
    }
  }
  // Declines what it can't match: OKLab matching and styles outside its set.
  const oklab = await gpu.accelerate(ditherLayer("bayer"), photo(64, 64), { layers: [], palette: getPalette("ega-16").colors, seed: 1, color: { space: "srgb", metric: "oklab" } });
  const diffusion = await gpu.accelerate(ditherLayer("floyd-steinberg"), photo(64, 64), { layers: [], palette: getPalette("mono").colors, seed: 1, color: DEFAULT_COLOR });
  rows.push(`${oklab === null && diffusion === null ? "ok  " : "FAIL"} declines OKLab matching and error diffusion`);
  out.textContent = rows.join("\n");
  (window as unknown as { gpuCheck: unknown }).gpuCheck = { available: true, results, passed: results.every((r) => r.pass) && oklab === null && diffusion === null };
}

void main();
