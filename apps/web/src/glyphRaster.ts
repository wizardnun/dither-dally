import type { GlyphRasterizer } from "@dither-dally/core";

/** The platform's monospace fonts, so drawn text looks like it does when pasted. */
const FONT_STACK = 'ui-monospace, "SF Mono", Menlo, "Cascadia Mono", Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace';

/** Anti-aliased coverage at or above this counts as ink (a little under half keeps thin strokes). */
const INK_ALPHA = 96;

/** Narrowest cell, in pixels, drawn with the real font. */
const MIN_FONT_CELL = 6;

/**
 * Draws characters with the system monospace font, for text styles. Works in
 * a worker via OffscreenCanvas; returns undefined where that isn't available,
 * and the core then uses its built-in pixel font.
 */
export function createGlyphRasterizer(): GlyphRasterizer | undefined {
  if (typeof OffscreenCanvas === "undefined") return undefined;
  const probe = new OffscreenCanvas(1, 1).getContext("2d");
  if (!probe) return undefined;
  probe.font = `100px ${FONT_STACK}`;
  const advance = probe.measureText("M").width || 60; // width of one character at 100px

  const cache = new Map<string, Uint8Array | null>();
  return (ch, width, height) => {
    // Below ~6 px a real font's strokes are too thin to survive as ink (thumbnails, tiny cells);
    // decline so the core's pixel font is used, which still shows the right texture.
    if (width < MIN_FONT_CELL) return null;
    const key = `${width}x${height}:${ch}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const canvas = new OffscreenCanvas(width, height);
    const g = canvas.getContext("2d", { willReadFrequently: true });
    if (!g) return null;
    // Size the font so one character's advance fills the cell width, without overflowing its height.
    const size = Math.min((100 * width) / advance, height / 1.15);
    g.font = `${size}px ${FONT_STACK}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "#000";
    g.fillText(ch, width / 2, height / 2);
    const alpha = g.getImageData(0, 0, width, height).data;
    const mask = new Uint8Array(width * height);
    for (let i = 0; i < mask.length; i++) mask[i] = alpha[i * 4 + 3]! >= INK_ALPHA ? 1 : 0;
    cache.set(key, mask);
    return mask;
  };
}
