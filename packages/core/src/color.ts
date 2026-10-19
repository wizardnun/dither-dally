import type { Palette, PixelBuffer, RGB } from "./types.ts";

export function parseHex(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Not a 6-digit hex colour: "${hex}"`);
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex([r, g, b]: RGB): string {
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

export function paletteFromHex(hexes: readonly string[]): Palette {
  return hexes.map(parseHex);
}

/** Index of the palette entry closest to (r, g, b) by squared sRGB distance. */
export function nearestIndex(palette: Palette, r: number, g: number, b: number): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const p = palette[i]!;
    const dr = r - p[0];
    const dg = g - p[1];
    const db = b - p[2];
    const d = dr * dr + dg * dg + db * db;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/**
 * Typical gap between neighbouring palette colours, in 0–255 units.
 * Threshold-based methods use it to size their offsets so they produce
 * one palette step of variation regardless of palette size.
 */
export function paletteSpread(palette: Palette): number {
  if (palette.length < 2) return 255;
  let total = 0;
  for (let i = 0; i < palette.length; i++) {
    const a = palette[i]!;
    let nearest = Infinity;
    for (let j = 0; j < palette.length; j++) {
      if (i === j) continue;
      const b = palette[j]!;
      const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / Math.sqrt(3);
      if (d < nearest) nearest = d;
    }
    total += nearest;
  }
  return Math.max(1, total / palette.length);
}

export function createBuffer(width: number, height: number): PixelBuffer {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}
