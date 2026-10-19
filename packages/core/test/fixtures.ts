import { createHash } from "node:crypto";
import { createBuffer } from "../src/color.ts";
import type { Palette, PixelBuffer } from "../src/types.ts";

/**
 * Deterministic test image: a hue sweep left to right, light to dark top to
 * bottom, with a grey ramp along the bottom and a half-transparent corner.
 */
export function testImage(width = 64, height = 48): PixelBuffer {
  const img = createBuffer(width, height);
  const d = img.data;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (y >= height - 6) {
        const v = Math.round((x / (width - 1)) * 255);
        d[i] = d[i + 1] = d[i + 2] = v;
      } else {
        const hue = (x / width) * 6;
        const light = 1 - y / (height - 6);
        const sector = Math.floor(hue);
        const f = hue - sector;
        const rgb = [
          [1, f, 0], [1 - f, 1, 0], [0, 1, f], [0, 1 - f, 1], [f, 0, 1], [1, 0, 1 - f],
        ][sector % 6]!;
        for (let c = 0; c < 3; c++) d[i + c] = Math.round((rgb[c]! * 0.6 + 0.4 * light) * light * 255);
      }
      d[i + 3] = x < 4 && y < 4 ? 128 : 255;
    }
  }
  return img;
}

export function solid(width: number, height: number, value: number): PixelBuffer {
  const img = createBuffer(width, height);
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = img.data[i + 1] = img.data[i + 2] = value;
    img.data[i + 3] = 255;
  }
  return img;
}

export function hash(img: PixelBuffer): string {
  return createHash("sha256").update(img.data).digest("hex").slice(0, 16);
}

export function usesOnlyPalette(img: PixelBuffer, palette: Palette): boolean {
  const allowed = new Set(palette.map(([r, g, b]) => (r << 16) | (g << 8) | b));
  for (let i = 0; i < img.data.length; i += 4) {
    if (!allowed.has((img.data[i]! << 16) | (img.data[i + 1]! << 8) | img.data[i + 2]!)) return false;
  }
  return true;
}
