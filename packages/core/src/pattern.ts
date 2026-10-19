import { fieldDither } from "./field.ts";
import type { AlgorithmDefinition } from "./types.ts";

/** Hatch layers in the order they appear as the image darkens. */
const HATCH_ANGLES = [45, -45, 0, 90];
/** A hatch line is at most this share of the line spacing wide. */
const MAX_LINE = 0.45;

export const crosshatch: AlgorithmDefinition = {
  id: "crosshatch",
  name: "Crosshatch",
  family: "pattern",
  summary: "Pen-and-ink shading: diagonal lines in the light tones, then crossing layers as it gets darker.",
  controls: [
    { kind: "slider", id: "spacing", label: "Line spacing", min: 3, max: 32, step: 1, default: 6, unit: "px" },
    { kind: "slider", id: "layers", label: "Layers", min: 1, max: 4, step: 1, default: 4 },
  ],
  run: (input, palette, params, ctx) => {
    const spacing = Number(params.spacing ?? 6);
    const layers = Number(params.layers ?? 4);
    const dirs = HATCH_ANGLES.slice(0, layers).map((deg) => {
      const a = (deg * Math.PI) / 180;
      return [Math.cos(a), Math.sin(a)] as const;
    });
    return fieldDither(input, palette, ctx.color, (x, y) => {
      // A pixel on layer k's line inks between k/L and (k+1)/L, centre of the line first.
      // Pixels on no line only ink in the very darkest tones.
      let rank = 0.999999;
      for (let k = 0; k < dirs.length; k++) {
        const [cx, cy] = dirs[k]!;
        const d = ((x + 0.5) * cx + (y + 0.5) * cy) / spacing;
        const dist = Math.abs(d - Math.floor(d) - 0.5) * 2; // 0 at line centre, 1 midway between lines
        if (dist < MAX_LINE) rank = Math.min(rank, (k + dist / MAX_LINE) / dirs.length);
      }
      return rank;
    });
  },
};
