import type { ColorSettings } from "./colorspace.ts";
import { getEffect } from "./effects.ts";
import { getAlgorithm } from "./registry.ts";
import type { SteadyDither } from "./steady.ts";
import type { GlyphRasterizer, Layer, Palette, PixelBuffer } from "./types.ts";

export interface PipelineSettings {
  layers: readonly Layer[];
  palette: Palette;
  seed: number;
  color: ColorSettings;
  /** Real-font character drawing for text styles (see GlyphRasterizer). */
  glyphs?: GlyphRasterizer;
  /** For video: keeps the dither's dots steady between frames (see SteadyDither). */
  steady?: SteadyDither;
}

/** FNV-1a hash of a string, for deriving per-layer seeds. */
function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** The image as it arrives at the dither layer: the input run through every enabled layer above it. */
export function runUntilDither(input: PixelBuffer, s: PipelineSettings): PixelBuffer {
  const at = s.layers.findIndex((l) => l.kind === "dither");
  return runPipeline(input, { ...s, layers: at < 0 ? s.layers : s.layers.slice(0, at) });
}

/**
 * The same layers for an image `factor` times larger in each direction, so a
 * full-size render keeps the look of the preview: every distance setting (a
 * slider with unit "px": cell sizes, line spacing, radii, glitch distances)
 * is multiplied by `factor`. Whole-pixel settings stay whole, and anything
 * above zero stays at least 1. Other settings, and the dither grain itself,
 * are left alone.
 */
export function scaleLayers(layers: readonly Layer[], factor: number): Layer[] {
  if (factor === 1) return [...layers];
  return layers.map((layer) => {
    const def = layer.kind === "dither" ? getAlgorithm(layer.algorithm) : getEffect(layer.effect);
    const params = { ...layer.params };
    for (const c of def.controls) {
      if (c.kind !== "slider" || c.unit !== "px") continue;
      const v = Number(params[c.id] ?? c.default);
      if (!Number.isFinite(v)) continue;
      const scaled = v * factor;
      params[c.id] = Number.isInteger(c.step) ? (v > 0 ? Math.max(1, Math.round(scaled)) : 0) : scaled;
    }
    return { ...layer, params } as Layer;
  });
}

/** The seed an effect layer runs with: the document seed mixed with the layer's own id. */
export function layerSeed(layer: Layer, seed: number): number {
  return (seed ^ hashId(layer.id)) >>> 0;
}

/** One layer on the CPU. */
function runLayer(layer: Layer, input: PixelBuffer, s: PipelineSettings): PixelBuffer {
  if (layer.kind === "dither") {
    return getAlgorithm(layer.algorithm).run(input, s.palette, layer.params, { seed: s.seed, color: s.color, glyphs: s.glyphs });
  }
  return getEffect(layer.effect).run(input, layer.params, { seed: layerSeed(layer, s.seed) });
}

/** Applies steady dots to a dither layer's output, when asked for. */
function steadied(layer: Layer, input: PixelBuffer, output: PixelBuffer, s: PipelineSettings): PixelBuffer {
  if (layer.kind !== "dither" || !s.steady || getAlgorithm(layer.algorithm).keepsColours) return output;
  return s.steady.apply(input, output);
}

/**
 * Runs the layer stack top to bottom; disabled layers are skipped. Effect
 * layers get a seed mixed from the document seed and their own id, so two
 * Grain layers don't produce identical noise and reordering layers doesn't
 * change either one's pattern.
 */
export function runPipeline(input: PixelBuffer, s: PipelineSettings): PixelBuffer {
  let current = input;
  for (const layer of s.layers) {
    if (!layer.enabled) continue;
    current = steadied(layer, current, runLayer(layer, current, s), s);
  }
  return current;
}

/**
 * Runs one layer somewhere faster (a GPU) and resolves with its output, or
 * with null to have the CPU run it instead. It must produce what the CPU
 * would, apart from floating-point ties.
 */
export type LayerAccelerator = (layer: Layer, input: PixelBuffer, s: PipelineSettings) => Promise<PixelBuffer | null>;

/**
 * runPipeline, but each layer is offered to `accelerate` first. Layers it
 * declines run on the CPU; steady dots and every other rule are the same.
 * Resolves with the output and how many layers were accelerated.
 */
export async function runPipelineAsync(
  input: PixelBuffer,
  s: PipelineSettings,
  accelerate: LayerAccelerator,
): Promise<{ output: PixelBuffer; accelerated: number }> {
  let current = input;
  let accelerated = 0;
  for (const layer of s.layers) {
    if (!layer.enabled) continue;
    const fast = await accelerate(layer, current, s);
    if (fast) accelerated++;
    current = steadied(layer, current, fast ?? runLayer(layer, current, s), s);
  }
  return { output: current, accelerated };
}
