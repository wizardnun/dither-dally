import { createBuffer, paletteSpread } from "./color.ts";
import { createColorModel, type ColorSettings, DEFAULT_COLOR } from "./colorspace.ts";
import { mulberry32 } from "./random.ts";
import type { AlgorithmDefinition, Palette, PixelBuffer } from "./types.ts";

/**
 * Bayer index matrix of size n×n (n a power of two), values 0..n²-1.
 * Built recursively: M(2n) = [[4M, 4M+2], [4M+3, 4M+1]].
 */
export function bayerMatrix(n: number): number[][] {
  if (n < 1 || (n & (n - 1)) !== 0) throw new Error(`Bayer size must be a power of two, got ${n}`);
  let m: number[][] = [[0]];
  while (m.length < n) {
    const s = m.length;
    const next: number[][] = Array.from({ length: s * 2 }, () => new Array<number>(s * 2).fill(0));
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const v = 4 * m[y]![x]!;
        next[y]![x] = v;
        next[y]![x + s] = v + 2;
        next[y + s]![x] = v + 3;
        next[y + s]![x + s] = v + 1;
      }
    }
    m = next;
  }
  return m;
}

/**
 * Blue-noise rank texture by void-and-cluster (Ulichney, 1993): an n×n tile
 * whose values 0..n²-1 are spread so every threshold level is as evenly
 * distributed as possible, with no low-frequency clumps. Tiles seamlessly.
 *
 * Energy is a Gaussian (sigma 1.5) summed over a torus. The "largest void" is
 * the empty cell with the least energy; the "tightest cluster" is the filled
 * cell with the most.
 */
export function blueNoiseTexture(n: number, seed: number): Uint32Array {
  const size = n * n;
  const sigma = 1.5;
  const kernel = new Float64Array(size);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = Math.min(x, n - x);
      const dy = Math.min(y, n - y);
      kernel[y * n + x] = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
    }
  }

  const splat = (energy: Float64Array, p: number, sign: number) => {
    const px = p % n;
    const py = (p - px) / n;
    for (let y = 0; y < n; y++) {
      const krow = ((y - py + n) % n) * n;
      const erow = y * n;
      for (let x = 0; x < n; x++) energy[erow + x]! += sign * kernel[krow + ((x - px + n) % n)]!;
    }
  };
  const extreme = (energy: Float64Array, pattern: Uint8Array, want: 0 | 1) => {
    let best = -1;
    let bestE = want === 1 ? -Infinity : Infinity;
    for (let p = 0; p < size; p++) {
      if (pattern[p] !== want) continue;
      const e = energy[p]!;
      if (want === 1 ? e > bestE : e < bestE) {
        bestE = e;
        best = p;
      }
    }
    return best;
  };
  const tightestCluster = (e: Float64Array, pat: Uint8Array) => extreme(e, pat, 1);
  const largestVoid = (e: Float64Array, pat: Uint8Array) => extreme(e, pat, 0);

  // Initial pattern: ~10% of cells, chosen at random, then relaxed until even.
  const rand = mulberry32(seed);
  const order = Array.from({ length: size }, (_, i) => i);
  for (let i = size - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  const ones = Math.max(1, Math.floor(size / 10));
  const pattern = new Uint8Array(size);
  const energy = new Float64Array(size);
  for (let i = 0; i < ones; i++) {
    pattern[order[i]!] = 1;
    splat(energy, order[i]!, 1);
  }
  for (let guard = 0; guard < size * 4; guard++) {
    const c = tightestCluster(energy, pattern);
    pattern[c] = 0;
    splat(energy, c, -1);
    const v = largestVoid(energy, pattern);
    pattern[v] = 1;
    splat(energy, v, 1);
    if (v === c) break; // moving the worst point would put it straight back: stable
  }

  const rank = new Uint32Array(size);

  // Phase 1: peel the initial points off, tightest cluster first, ranking downward.
  {
    const pat = pattern.slice();
    const e = energy.slice();
    for (let r = ones - 1; r >= 0; r--) {
      const c = tightestCluster(e, pat);
      pat[c] = 0;
      splat(e, c, -1);
      rank[c] = r;
    }
  }

  // Phases 2 and 3: fill the largest void, ranking upward. Past half full this is
  // the same as removing the tightest cluster of empty cells, because the two
  // energies sum to a constant.
  {
    const pat = pattern;
    const e = energy;
    for (let r = ones; r < size; r++) {
      const v = largestVoid(e, pat);
      pat[v] = 1;
      splat(e, v, 1);
      rank[v] = r;
    }
  }
  return rank;
}

const blueNoiseCache = new Map<string, Uint32Array>();
function cachedBlueNoise(n: number, seed: number): Uint32Array {
  const key = `${n}:${seed}`;
  let tex = blueNoiseCache.get(key);
  if (!tex) {
    tex = blueNoiseTexture(n, seed);
    if (blueNoiseCache.size >= 8) blueNoiseCache.delete(blueNoiseCache.keys().next().value!);
    blueNoiseCache.set(key, tex);
  }
  return tex;
}

/**
 * Adds a per-pixel threshold offset (in units of one palette step, centred on 0)
 * to each channel, then snaps to the nearest palette colour. Offsets are applied
 * in sRGB because that is where palette steps look even; only the matching
 * metric from `color` applies.
 */
function thresholdDither(
  input: PixelBuffer,
  palette: Palette,
  color: ColorSettings,
  offsetAt: (x: number, y: number) => number,
): PixelBuffer {
  const { width: w, height: h, data: src } = input;
  const out = createBuffer(w, h);
  const dst = out.data;
  const model = createColorModel(palette, { space: "srgb", metric: color.metric });
  const spread = paletteSpread(palette);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const t = offsetAt(x, y) * spread;
      const c = palette[model.nearest(src[i]! + t, src[i + 1]! + t, src[i + 2]! + t)]!;
      dst[i] = c[0];
      dst[i + 1] = c[1];
      dst[i + 2] = c[2];
      dst[i + 3] = src[i + 3]!;
    }
  }
  return out;
}

export const bayer: AlgorithmDefinition = {
  id: "bayer",
  name: "Bayer",
  family: "ordered",
  summary: "Compares each pixel against a repeating threshold grid, giving the familiar cross-hatched pattern.",
  reference: { author: "B. E. Bayer", year: 1973, title: "An optimum method for two-level rendition of continuous-tone pictures" },
  controls: [
    {
      kind: "select",
      id: "size",
      label: "Matrix size",
      options: [
        { value: "2", label: "2×2" },
        { value: "4", label: "4×4" },
        { value: "8", label: "8×8" },
        { value: "16", label: "16×16" },
      ],
      default: "4",
    },
  ],
  run: (input, palette, params, ctx) => {
    const n = Number(params.size ?? 4);
    const m = bayerMatrix(n);
    const cells = n * n;
    return thresholdDither(input, palette, ctx.color ?? DEFAULT_COLOR, (x, y) => (m[y % n]![x % n]! + 0.5) / cells - 0.5);
  },
};

export const blueNoise: AlgorithmDefinition = {
  id: "blue-noise",
  name: "Blue noise",
  family: "ordered",
  summary:
    "Thresholds against a tile of evenly scattered noise: grain without visible pattern, and every pixel is independent. Change the seed for a different tile.",
  reference: { author: "Robert Ulichney", year: 1993, title: "The void-and-cluster method for dither array generation" },
  controls: [
    {
      kind: "select",
      id: "size",
      label: "Tile size",
      help: "Larger tiles repeat less visibly but take longer to generate the first time.",
      options: [
        { value: "32", label: "32×32" },
        { value: "64", label: "64×64" },
      ],
      default: "64",
    },
  ],
  run: (input, palette, params, ctx) => {
    const n = Number(params.size ?? 64);
    const tex = cachedBlueNoise(n, ctx.seed);
    const cells = n * n;
    return thresholdDither(input, palette, ctx.color ?? DEFAULT_COLOR, (x, y) => (tex[(y % n) * n + (x % n)]! + 0.5) / cells - 0.5);
  },
};

export const whiteNoise: AlgorithmDefinition = {
  id: "white-noise",
  name: "White noise",
  family: "ordered",
  summary: "A random threshold per pixel. Grainy, like film. Change the seed for a different grain.",
  controls: [],
  run: (input, palette, _params, ctx) => {
    const rand = mulberry32(ctx.seed);
    return thresholdDither(input, palette, ctx.color ?? DEFAULT_COLOR, () => rand() - 0.5);
  },
};
