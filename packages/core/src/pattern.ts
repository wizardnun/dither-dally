import { cached, equalize, fieldDither } from "./field.ts";
import { mulberry32 } from "./random.ts";
import type { AlgorithmDefinition, Params } from "./types.ts";

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

export const stipple: AlgorithmDefinition = {
  id: "stipple",
  name: "Stipple",
  family: "pattern",
  summary: "Hand-stippled shading: round dots of one size scattered loosely, more of them where the image is darker. Follows the seed.",
  controls: [
    { kind: "slider", id: "dot", label: "Dot size", min: 1, max: 16, step: 0.5, default: 2.5, unit: "px" },
    { kind: "slider", id: "jitter", label: "Scatter", help: "0 lines the dots up on a grid.", min: 0, max: 100, step: 1, default: 80, unit: "%" },
  ],
  run: (input, palette, p, ctx) => {
    const rank = stippleRanks(input.width, input.height, p, ctx.seed);
    return fieldDither(input, palette, ctx.color, (x, y) => rank[y * input.width + x]!);
  },
};

const stippleCache = new Map<string, Float32Array>();

/** Stipple's rank per pixel. It depends on size, settings and seed only, so it is cached and shared with the GPU. */
export function stippleRanks(w: number, h: number, p: Params, seed: number): Float32Array {
  const r = Math.max(0.5, Number(p.dot ?? 2.5));
  const jitter = Number(p.jitter ?? 80) / 100;
  return cached(stippleCache, `${w}:${h}:${r}:${jitter}:${seed}`, () => {
    // One dot per cell; this spacing makes the dots' total area about equal to the image's.
    const cell = r * Math.sqrt(Math.PI);
    const cols = Math.ceil(w / cell) + 1;
    const rows = Math.ceil(h / cell) + 1;
    const rand = mulberry32(seed ^ 0x5717);
    const px = new Float32Array(cols * rows);
    const py = new Float32Array(cols * rows);
    const order = new Float32Array(cols * rows);
    for (let c = 0; c < cols * rows; c++) {
      px[c] = ((c % cols) + 0.5 + (rand() - 0.5) * jitter) * cell;
      py[c] = (Math.floor(c / cols) + 0.5 + (rand() - 0.5) * jitter) * cell;
      order[c] = rand();
    }
    // Inside a dot the raw rank is the dot's turn (dots switch on whole, in random order);
    // between dots it is 1 + the distance to the nearest dot, so gaps close last, from the dots outward.
    const raw = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const gy = Math.floor((y + 0.5) / cell);
      for (let x = 0; x < w; x++) {
        const gx = Math.floor((x + 0.5) / cell);
        let best = Infinity;
        let gap = Infinity;
        for (let j = Math.max(0, gy - 1); j <= Math.min(rows - 1, gy + 1); j++) {
          for (let i = Math.max(0, gx - 1); i <= Math.min(cols - 1, gx + 1); i++) {
            const c = j * cols + i;
            const d = Math.hypot(x + 0.5 - px[c]!, y + 0.5 - py[c]!) - r;
            if (d <= 0) best = Math.min(best, order[c]!);
            else gap = Math.min(gap, d);
          }
        }
        raw[y * w + x] = best <= 1 ? best : 1 + gap / cell;
      }
    }
    return equalize(raw);
  });
}

export const checker: AlgorithmDefinition = {
  id: "checker",
  name: "Checker",
  family: "pattern",
  summary: "Tones between two palette colours become a checkerboard of both, giving one in-between shade per step, like early 8-bit art.",
  controls: [{ kind: "slider", id: "size", label: "Square size", min: 1, max: 16, step: 1, default: 1, unit: "px" }],
  run: (input, palette, p, ctx) => {
    const size = Math.max(1, Math.round(Number(p.size ?? 1)));
    // Two ranks only: close to a palette colour stays solid, halfway between two becomes a checker.
    return fieldDither(input, palette, ctx.color, (x, y) => ((Math.floor(x / size) + Math.floor(y / size)) & 1 ? 0.75 : 0.25));
  },
};
