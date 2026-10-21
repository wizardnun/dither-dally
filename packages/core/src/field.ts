import { createBuffer, paletteSpread } from "./color.ts";
import { createColorModel, type ColorSettings } from "./colorspace.ts";
import type { Palette, PixelBuffer, RGB } from "./types.ts";

/**
 * Threshold-field dithering: the engine behind ordered, halftone and hatch
 * patterns. `rank(x, y)` returns where a pixel sits in the inking order, in
 * [0, 1): pixels with a low rank turn dark first as the image gets darker.
 *
 * The rank becomes an offset of up to half a palette step in either
 * direction, added in sRGB, and then the pixel snaps to the nearest palette
 * colour. With two colours this is a plain threshold; with more it dithers
 * between neighbouring palette colours.
 */
export function fieldDither(
  input: PixelBuffer,
  palette: Palette,
  color: ColorSettings,
  rank: (x: number, y: number) => number,
): PixelBuffer {
  const { width: w, height: h, data: src } = input;
  const out = createBuffer(w, h);
  const dst = out.data;
  const model = createColorModel(palette, { space: "srgb", metric: color.metric });
  const spread = paletteSpread(palette);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const t = (rank(x, y) - 0.5) * spread;
      const c = palette[model.nearest(src[i]! + t, src[i + 1]! + t, src[i + 2]! + t)]!;
      dst[i] = c[0];
      dst[i + 1] = c[1];
      dst[i + 2] = c[2];
      dst[i + 3] = src[i + 3]!;
    }
  }
  return out;
}

/**
 * Returns `cache[key]`, making it first if needed. Keeps only the last two
 * entries by default (a 4K rank field is ~33 MB); for rank fields that depend on size and settings but not on the
 * image, so video frames and GPU uploads reuse them.
 */
export function cached<T>(cache: Map<string, T>, key: string, make: () => T, limit = 2): T {
  let v = cache.get(key);
  if (v === undefined) {
    v = make();
    if (cache.size >= limit) cache.delete(cache.keys().next().value!);
    cache.set(key, v);
  }
  return v;
}

/**
 * Turns raw field values into ranks spread evenly over [0, 1), keeping their
 * order. Use it for fields whose values bunch up (sums of waves, distances),
 * so that ink coverage still tracks tone. Equal values share a rank.
 */
export function equalize(values: Float32Array, bins = 4096): Float32Array {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const out = new Float32Array(values.length);
  if (!(hi > lo)) return out.fill(0.5);
  const scale = (bins - 1) / (hi - lo);
  const count = new Float64Array(bins);
  for (const v of values) {
    const b = Math.round((v - lo) * scale);
    count[b] = count[b]! + 1;
  }
  // Each bin's rank is the middle of the share of pixels it covers.
  const rank = new Float32Array(bins);
  let below = 0;
  for (let b = 0; b < bins; b++) {
    rank[b] = Math.min(0.999999, (below + count[b]! / 2) / values.length);
    below += count[b]!;
  }
  for (let i = 0; i < values.length; i++) out[i] = rank[Math.round((values[i]! - lo) * scale)]!;
  return out;
}

/** Rec. 709 luma of an sRGB colour, 0–255. Used to find "ink" and "paper" colours. */
export function luma([r, g, b]: RGB): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function darkest(palette: Palette): RGB {
  return palette.reduce((a, b) => (luma(b) < luma(a) ? b : a));
}

export function lightest(palette: Palette): RGB {
  return palette.reduce((a, b) => (luma(b) > luma(a) ? b : a));
}
