import type { ColorSettings } from "./colorspace.ts";
import { getEffect } from "./effects.ts";
import { getAlgorithm } from "./registry.ts";
import type { Layer, Palette, PixelBuffer } from "./types.ts";

export interface PipelineSettings {
  layers: readonly Layer[];
  palette: Palette;
  seed: number;
  color: ColorSettings;
}

/** FNV-1a hash of a string, for deriving per-layer seeds. */
function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  return h >>> 0;
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
    if (layer.kind === "dither") {
      current = getAlgorithm(layer.algorithm).run(current, s.palette, layer.params, { seed: s.seed, color: s.color });
    } else {
      current = getEffect(layer.effect).run(current, layer.params, { seed: (s.seed ^ hashId(layer.id)) >>> 0 });
    }
  }
  return current;
}
