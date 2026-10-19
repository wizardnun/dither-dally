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
