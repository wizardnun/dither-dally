import type { Palette } from "./types.ts";

/** Which values error diffusion adds and subtracts. */
export type DiffusionSpace = "srgb" | "linear";
/** How "closest palette colour" is measured. */
export type MatchMetric = "srgb" | "oklab";

export interface ColorSettings {
  space: DiffusionSpace;
  metric: MatchMetric;
}

/** The classic behaviour: diffuse and match in plain sRGB values. */
export const DEFAULT_COLOR: ColorSettings = { space: "srgb", metric: "srgb" };

/** sRGB byte value (0–255) to linear light (0–1). */
export function srgbToLinear(v: number): number {
  const c = Math.min(1, Math.max(0, v / 255));
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Linear light (0–1) to sRGB value (0–255, unrounded). */
export function linearToSrgb(l: number): number {
  const c = Math.min(1, Math.max(0, l));
  return 255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
}

const SRGB_BYTE_TO_LINEAR = Float64Array.from({ length: 256 }, (_, i) => srgbToLinear(i));

/** Linear-light RGB (0–1) to OKLab (Björn Ottosson, 2020). */
export function linearToOklab(r: number, g: number, b: number): [L: number, a: number, b: number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/**
 * Converts pixels into a working space, measures distances in the chosen
 * metric, and hands back palette colours in that same working space.
 *
 * Working values are on a 0–255 scale in both spaces (linear light is
 * multiplied by 255), so error magnitudes and strength settings stay
 * comparable. Values may drift outside 0–255 while error accumulates.
 */
export interface ColorModel {
  /** sRGB byte (0–255) → working value. */
  toWorking(byte: number): number;
  /** Palette colours in working space, 3 floats per entry. */
  readonly paletteWorking: Float64Array;
  /** Index of the nearest palette entry to a working-space colour. */
  nearest(r: number, g: number, b: number): number;
}

export function createColorModel(palette: Palette, settings: ColorSettings): ColorModel {
  const n = palette.length;
  const linear = settings.space === "linear";
  const toWorking = linear ? (byte: number) => SRGB_BYTE_TO_LINEAR[byte | 0]! * 255 : (byte: number) => byte;

  const paletteWorking = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const p = palette[i]!;
    for (let c = 0; c < 3; c++) paletteWorking[i * 3 + c] = toWorking(p[c]!);
  }

  // Palette coordinates in the metric's space.
  const target = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const [r, g, b] = palette[i]!;
    const v =
      settings.metric === "oklab"
        ? linearToOklab(SRGB_BYTE_TO_LINEAR[r]!, SRGB_BYTE_TO_LINEAR[g]!, SRGB_BYTE_TO_LINEAR[b]!)
        : [r, g, b];
    target.set(v, i * 3);
  }

  const closest = (x: number, y: number, z: number): number => {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0, j = 0; i < n; i++, j += 3) {
      const dx = x - target[j]!;
      const dy = y - target[j + 1]!;
      const dz = z - target[j + 2]!;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  };

  let nearest: ColorModel["nearest"];
  if (settings.metric === "srgb") {
    nearest = linear
      ? (r, g, b) => closest(linearToSrgb(r / 255), linearToSrgb(g / 255), linearToSrgb(b / 255))
      : closest; // classic path: no clamping, identical to Phase 0 output
  } else {
    nearest = linear
      ? (r, g, b) => {
          const [L, A, B] = linearToOklab(clamp01(r / 255), clamp01(g / 255), clamp01(b / 255));
          return closest(L, A, B);
        }
      : (r, g, b) => {
          const [L, A, B] = linearToOklab(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b));
          return closest(L, A, B);
        };
  }

  return { toWorking, paletteWorking, nearest };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
