import { createBuffer } from "./color.ts";
import { createColorModel, type ColorSettings, DEFAULT_COLOR } from "./colorspace.ts";
import type { AlgorithmDefinition, Palette, PixelBuffer, Reference } from "./types.ts";

/** One error-diffusion tap: offset from the current pixel and its share of the error. */
export type Tap = readonly [dx: number, dy: number, weight: number];

export interface Kernel {
  id: string;
  name: string;
  summary: string;
  reference: Reference;
  /** Weights are divided by this. If the weights sum to less, some error is dropped on purpose. */
  divisor: number;
  taps: readonly Tap[];
}

// Taps are written for left-to-right scanning; serpentine mirrors dx on odd rows.
export const KERNELS: readonly Kernel[] = [
  {
    id: "floyd-steinberg",
    name: "Floyd–Steinberg",
    summary: "The classic: error goes to four neighbours. Sharp and well balanced.",
    reference: { author: "Robert W. Floyd, Louis Steinberg", year: 1976, title: "An Adaptive Algorithm for Spatial Greyscale" },
    divisor: 16,
    taps: [[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]],
  },
  {
    id: "atkinson",
    name: "Atkinson",
    summary: "Passes on only three quarters of the error, giving crisp highlights and deep shadows.",
    reference: { author: "Bill Atkinson", year: 1984 },
    divisor: 8,
    taps: [[1, 0, 1], [2, 0, 1], [-1, 1, 1], [0, 1, 1], [1, 1, 1], [0, 2, 1]],
  },
  {
    id: "burkes",
    name: "Burkes",
    summary: "A two-row simplification of Stucki that spreads error widely along the row.",
    reference: { author: "Daniel Burkes", year: 1988 },
    divisor: 32,
    taps: [[1, 0, 8], [2, 0, 4], [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2]],
  },
  {
    id: "jarvis-judice-ninke",
    name: "Jarvis–Judice–Ninke",
    summary: "Spreads error over three rows for smooth gradients, at the cost of some sharpness.",
    reference: { author: "J. F. Jarvis, C. N. Judice, W. H. Ninke", year: 1976, title: "A survey of techniques for the display of continuous tone pictures on bilevel displays" },
    divisor: 48,
    taps: [
      [1, 0, 7], [2, 0, 5],
      [-2, 1, 3], [-1, 1, 5], [0, 1, 7], [1, 1, 5], [2, 1, 3],
      [-2, 2, 1], [-1, 2, 3], [0, 2, 5], [1, 2, 3], [2, 2, 1],
    ],
  },
  {
    id: "stucki",
    name: "Stucki",
    summary: "A sharper variant of Jarvis–Judice–Ninke with powers-of-two weights.",
    reference: { author: "P. Stucki", year: 1981, title: "MECCA — a multiple-error correcting computation algorithm for bilevel image hardcopy reproduction" },
    divisor: 42,
    taps: [
      [1, 0, 8], [2, 0, 4],
      [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2],
      [-2, 2, 1], [-1, 2, 2], [0, 2, 4], [1, 2, 2], [2, 2, 1],
    ],
  },
  {
    id: "sierra",
    name: "Sierra",
    summary: "Three-row kernel close to Jarvis–Judice–Ninke in quality, slightly faster.",
    reference: { author: "Frankie Sierra", year: 1989 },
    divisor: 32,
    taps: [
      [1, 0, 5], [2, 0, 3],
      [-2, 1, 2], [-1, 1, 4], [0, 1, 5], [1, 1, 4], [2, 1, 2],
      [-1, 2, 2], [0, 2, 3], [1, 2, 2],
    ],
  },
  {
    id: "two-row-sierra",
    name: "Two-row Sierra",
    summary: "Sierra trimmed to two rows: a middle ground between speed and smoothness.",
    reference: { author: "Frankie Sierra", year: 1990 },
    divisor: 16,
    taps: [[1, 0, 4], [2, 0, 3], [-2, 1, 1], [-1, 1, 2], [0, 1, 3], [1, 1, 2], [2, 1, 1]],
  },
  {
    id: "sierra-lite",
    name: "Sierra Lite",
    summary: "The smallest Sierra kernel. Very fast, close to Floyd–Steinberg in look.",
    reference: { author: "Frankie Sierra", year: 1990 },
    divisor: 4,
    taps: [[1, 0, 2], [-1, 1, 1], [0, 1, 1]],
  },
  {
    id: "stevenson-arce",
    name: "Stevenson–Arce",
    summary: "A wide kernel designed for hexagonal grids, giving an even, photographic texture.",
    reference: { author: "R. L. Stevenson, G. R. Arce", year: 1985, title: "Binary display of hexagonally sampled continuous-tone images" },
    divisor: 200,
    taps: [
      [2, 0, 32],
      [-3, 1, 12], [-1, 1, 26], [1, 1, 30], [3, 1, 16],
      [-2, 2, 12], [0, 2, 26], [2, 2, 12],
      [-3, 3, 5], [-1, 3, 12], [1, 3, 12], [3, 3, 5],
    ],
  },
];

export interface DiffuseOptions {
  serpentine: boolean;
  /** 1 = standard. 0 disables diffusion; above 1 exaggerates it. */
  strength: number;
  color?: ColorSettings;
}

export function diffuse(input: PixelBuffer, palette: Palette, kernel: Kernel, opts: DiffuseOptions): PixelBuffer {
  const { width: w, height: h, data: src } = input;
  const out = createBuffer(w, h);
  const dst = out.data;
  const model = createColorModel(palette, opts.color ?? DEFAULT_COLOR);
  const pw = model.paletteWorking;
  // Working copy in float so accumulated error isn't clipped.
  const buf = new Float32Array(w * h * 3);
  for (let i = 0, j = 0; i < src.length; i += 4, j += 3) {
    buf[j] = model.toWorking(src[i]!);
    buf[j + 1] = model.toWorking(src[i + 1]!);
    buf[j + 2] = model.toWorking(src[i + 2]!);
  }
  const scale = opts.strength / kernel.divisor;
  const taps = kernel.taps;

  for (let y = 0; y < h; y++) {
    const reverse = opts.serpentine && (y & 1) === 1;
    for (let n = 0; n < w; n++) {
      const x = reverse ? w - 1 - n : n;
      const p = y * w + x;
      const j = p * 3;
      const r = buf[j]!;
      const g = buf[j + 1]!;
      const b = buf[j + 2]!;
      const idx = model.nearest(r, g, b);
      const c = palette[idx]!;
      const o = p * 4;
      dst[o] = c[0];
      dst[o + 1] = c[1];
      dst[o + 2] = c[2];
      dst[o + 3] = src[o + 3]!;

      const q = idx * 3;
      const er = (r - pw[q]!) * scale;
      const eg = (g - pw[q + 1]!) * scale;
      const eb = (b - pw[q + 2]!) * scale;
      for (let t = 0; t < taps.length; t++) {
        const [dx0, dy, weight] = taps[t]!;
        const xx = x + (reverse ? -dx0 : dx0);
        const yy = y + dy;
        if (xx < 0 || xx >= w || yy >= h) continue;
        const k = (yy * w + xx) * 3;
        buf[k] = buf[k]! + er * weight;
        buf[k + 1] = buf[k + 1]! + eg * weight;
        buf[k + 2] = buf[k + 2]! + eb * weight;
      }
    }
  }
  return out;
}

export function diffusionAlgorithm(kernel: Kernel): AlgorithmDefinition {
  return {
    id: kernel.id,
    name: kernel.name,
    family: "error-diffusion",
    summary: kernel.summary,
    reference: kernel.reference,
    controls: [
      {
        kind: "toggle",
        id: "serpentine",
        label: "Serpentine scan",
        help: "Alternate direction on each row to reduce diagonal streaks.",
        default: false,
      },
      {
        kind: "slider",
        id: "strength",
        label: "Error strength",
        min: 0,
        max: 200,
        step: 5,
        default: 100,
        unit: "%",
      },
    ],
    run: (input, palette, params, ctx) =>
      diffuse(input, palette, kernel, {
        serpentine: Boolean(params.serpentine),
        strength: Number(params.strength ?? 100) / 100,
        color: ctx.color,
      }),
  };
}
