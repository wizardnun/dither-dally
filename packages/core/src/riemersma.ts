import { createBuffer } from "./color.ts";
import { createColorModel } from "./colorspace.ts";
import type { AlgorithmDefinition } from "./types.ts";

/** Converts distance `d` along a Hilbert curve filling an n×n square (n a power of two) to (x, y). */
export function hilbertPoint(n: number, d: number): [x: number, y: number] {
  let x = 0;
  let y = 0;
  let t = d;
  for (let s = 1; s < n; s *= 2) {
    const rx = 1 & (t >> 1);
    const ry = 1 & (t ^ rx);
    if (ry === 0) {
      if (rx === 1) {
        x = s - 1 - x;
        y = s - 1 - y;
      }
      [x, y] = [y, x];
    }
    x += s * rx;
    y += s * ry;
    t >>= 2;
  }
  return [x, y];
}

export const riemersma: AlgorithmDefinition = {
  id: "riemersma",
  name: "Riemersma",
  family: "error-diffusion",
  summary:
    "Walks the image along a space-filling Hilbert curve, carrying a fading memory of recent errors. No row-by-row streaks or directional artefacts.",
  reference: { author: "Thiadmer Riemersma", year: 1998, title: "A balanced dithering technique" },
  controls: [
    {
      kind: "slider",
      id: "history",
      label: "Memory",
      help: "How many recent errors are carried along the curve.",
      min: 4,
      max: 32,
      step: 1,
      default: 16,
    },
    { kind: "slider", id: "strength", label: "Error strength", min: 0, max: 200, step: 5, default: 100, unit: "%" },
  ],
  run: (input, palette, params, ctx) => {
    const { width: w, height: h, data: src } = input;
    const out = createBuffer(w, h);
    const dst = out.data;
    const model = createColorModel(palette, ctx.color);
    const pw = model.paletteWorking;
    const q = Number(params.history ?? 16);
    const strength = Number(params.strength ?? 100) / 100;

    // Weights fall off exponentially: the oldest error counts 1/16 as much as the newest.
    // weights[0] applies to the newest error. Normalised to sum to 1.
    const weights = new Float64Array(q);
    let total = 0;
    for (let i = 0; i < q; i++) {
      weights[i] = Math.pow(1 / 16, q > 1 ? i / (q - 1) : 0);
      total += weights[i]!;
    }
    for (let i = 0; i < q; i++) weights[i] = (weights[i]! / total) * strength;

    // Circular history of recent errors, 3 channels each.
    const hist = new Float64Array(q * 3);
    let head = 0;

    let n = 1;
    while (n < Math.max(w, h)) n *= 2;
    for (let d = 0; d < n * n; d++) {
      const [x, y] = hilbertPoint(n, d);
      if (x >= w || y >= h) continue;
      const i = (y * w + x) * 4;
      let r = model.toWorking(src[i]!);
      let g = model.toWorking(src[i + 1]!);
      let b = model.toWorking(src[i + 2]!);
      for (let k = 0; k < q; k++) {
        const slot = ((head - 1 - k + q * 2) % q) * 3;
        const wk = weights[k]!;
        r += hist[slot]! * wk;
        g += hist[slot + 1]! * wk;
        b += hist[slot + 2]! * wk;
      }
      const idx = model.nearest(r, g, b);
      const c = palette[idx]!;
      dst[i] = c[0];
      dst[i + 1] = c[1];
      dst[i + 2] = c[2];
      dst[i + 3] = src[i + 3]!;
      const slot = head * 3;
      hist[slot] = r - pw[idx * 3]!;
      hist[slot + 1] = g - pw[idx * 3 + 1]!;
      hist[slot + 2] = b - pw[idx * 3 + 2]!;
      head = (head + 1) % q;
    }
    return out;
  },
};
