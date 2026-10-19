import { linearToOklab, linearToSrgb, oklabToLinear, srgbToLinear } from "./colorspace.ts";
import { mulberry32 } from "./random.ts";
import type { Palette, PixelBuffer, RGB } from "./types.ts";

/** At most this many pixels are clustered; larger images are sampled evenly. */
const MAX_SAMPLES = 40_000;
const ITERATIONS = 16;

/**
 * Picks `k` colours that represent the image, by k-means clustering in OKLab
 * (so clusters match what the eye groups together). Seeded k-means++ start,
 * so the same image, k and seed always give the same palette. Fully
 * transparent pixels are ignored. Returns colours sorted dark to light.
 */
export function extractPalette(input: PixelBuffer, k: number, seed = 1): Palette {
  const { width: w, height: h, data } = input;
  const total = w * h;
  const stride = Math.max(1, Math.floor(total / MAX_SAMPLES));
  const pts: number[] = [];
  for (let p = 0; p < total; p += stride) {
    const i = p * 4;
    if (data[i + 3] === 0) continue;
    pts.push(...linearToOklab(srgbToLinear(data[i]!), srgbToLinear(data[i + 1]!), srgbToLinear(data[i + 2]!)));
  }
  const n = pts.length / 3;
  if (n === 0) return [[0, 0, 0]];
  const kk = Math.max(1, Math.min(k, n));
  const rand = mulberry32(seed);
  const dist2 = (a: number, cx: number, cy: number, cz: number) => {
    const dx = pts[a * 3]! - cx;
    const dy = pts[a * 3 + 1]! - cy;
    const dz = pts[a * 3 + 2]! - cz;
    return dx * dx + dy * dy + dz * dz;
  };

  // k-means++: each new centre is chosen with probability ∝ squared distance to the nearest existing one.
  const centres = new Float64Array(kk * 3);
  const first = Math.floor(rand() * n);
  centres.set(pts.slice(first * 3, first * 3 + 3), 0);
  const nearest = new Float64Array(n).fill(Infinity);
  for (let c = 1; c < kk; c++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const d = dist2(i, centres[(c - 1) * 3]!, centres[(c - 1) * 3 + 1]!, centres[(c - 1) * 3 + 2]!);
      if (d < nearest[i]!) nearest[i] = d;
      sum += nearest[i]!;
    }
    let target = rand() * sum;
    let pick = n - 1;
    for (let i = 0; i < n; i++) {
      target -= nearest[i]!;
      if (target <= 0) {
        pick = i;
        break;
      }
    }
    centres.set(pts.slice(pick * 3, pick * 3 + 3), c * 3);
  }

  const assign = new Int32Array(n);
  for (let iter = 0; iter < ITERATIONS; iter++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < kk; c++) {
        const d = dist2(i, centres[c * 3]!, centres[c * 3 + 1]!, centres[c * 3 + 2]!);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (assign[i] !== best) moved = true;
      assign[i] = best;
    }
    const sums = new Float64Array(kk * 4);
    for (let i = 0; i < n; i++) {
      const c = assign[i]!;
      sums[c * 4] = sums[c * 4]! + pts[i * 3]!;
      sums[c * 4 + 1] = sums[c * 4 + 1]! + pts[i * 3 + 1]!;
      sums[c * 4 + 2] = sums[c * 4 + 2]! + pts[i * 3 + 2]!;
      sums[c * 4 + 3] = sums[c * 4 + 3]! + 1;
    }
    for (let c = 0; c < kk; c++) {
      const m = sums[c * 4 + 3]!;
      if (m > 0) centres.set([sums[c * 4]! / m, sums[c * 4 + 1]! / m, sums[c * 4 + 2]! / m], c * 3);
    }
    if (!moved && iter > 0) break;
  }

  const colors: RGB[] = [];
  const seen = new Set<string>();
  const order = Array.from({ length: kk }, (_, c) => c).sort((a, b) => centres[a * 3]! - centres[b * 3]!);
  for (const c of order) {
    const [r, g, b] = oklabToLinear(centres[c * 3]!, centres[c * 3 + 1]!, centres[c * 3 + 2]!);
    const rgb: RGB = [Math.round(linearToSrgb(r)), Math.round(linearToSrgb(g)), Math.round(linearToSrgb(b))];
    const key = rgb.join();
    if (!seen.has(key)) {
      seen.add(key);
      colors.push(rgb);
    }
  }
  return colors;
}
