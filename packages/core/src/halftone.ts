import { createBuffer } from "./color.ts";
import { createColorModel } from "./colorspace.ts";
import { fieldDither } from "./field.ts";
import type { AlgorithmDefinition } from "./types.ts";

export type DotShape = "round" | "diamond" | "square" | "line";

/**
 * Rank of a point inside one screen cell, for a dot of the given shape that
 * grows from the cell centre. (u, v) are cell coordinates in [-0.5, 0.5).
 *
 * The rank is the share of the cell covered by the dot at the moment it
 * reaches this point, so a cell's ink coverage equals the tone it
 * represents: 30% grey gives a dot covering 30% of the cell.
 */
export function spotRank(shape: DotShape, u: number, v: number): number {
  switch (shape) {
    case "round":
      return circleCoverage(Math.hypot(u, v));
    case "diamond": {
      const d = Math.abs(u) + Math.abs(v); // 0 … 1
      return d <= 0.5 ? 2 * d * d : 1 - 2 * (1 - d) * (1 - d);
    }
    case "square": {
      const m = Math.max(Math.abs(u), Math.abs(v)); // 0 … 0.5
      return 4 * m * m;
    }
    case "line":
      return 2 * Math.abs(v);
  }
}

/** Area of a circle of radius r (centred) clipped to the unit square [-0.5, 0.5]². */
export function circleCoverage(r: number): number {
  if (r <= 0.5) return Math.PI * r * r;
  if (r >= Math.SQRT1_2) return 1;
  // Circle minus the four caps that stick out past the square's edges.
  const cap = r * r * Math.acos(0.5 / r) - 0.5 * Math.sqrt(r * r - 0.25);
  return Math.PI * r * r - 4 * cap;
}

/** Position of pixel (x, y) within a screen of `cell` px rotated by `angle` degrees. */
export function screenCoords(x: number, y: number, cell: number, angle: number): [u: number, v: number] {
  const a = (angle * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const px = x + 0.5;
  const py = y + 0.5;
  const s = (px * cos + py * sin) / cell;
  const t = (-px * sin + py * cos) / cell;
  return [s - Math.floor(s) - 0.5, t - Math.floor(t) - 0.5];
}

const SHAPES = [
  { value: "round", label: "Round" },
  { value: "diamond", label: "Diamond" },
  { value: "square", label: "Square" },
  { value: "line", label: "Line" },
] as const;

export const halftone: AlgorithmDefinition = {
  id: "halftone",
  name: "Halftone",
  family: "halftone",
  summary: "A printer's screen: dots on a rotated grid, each sized by the darkness it stands for.",
  controls: [
    { kind: "slider", id: "cell", label: "Cell size", min: 3, max: 48, step: 1, default: 8, unit: "px" },
    { kind: "slider", id: "angle", label: "Angle", min: 0, max: 90, step: 1, default: 45, unit: "°" },
    { kind: "select", id: "shape", label: "Dot shape", options: SHAPES, default: "round" },
  ],
  run: (input, palette, params, ctx) => {
    const cell = Number(params.cell ?? 8);
    const angle = Number(params.angle ?? 45);
    const shape = String(params.shape ?? "round") as DotShape;
    return fieldDither(input, palette, ctx.color, (x, y) => {
      const [u, v] = screenCoords(x, y, cell, angle);
      return Math.min(0.999999, spotRank(shape, u, v));
    });
  },
};

/** Classic process-colour screen angles, in degrees. */
const CMYK_ANGLES = { c: 15, m: 75, y: 0, k: 45 } as const;

export const cmykHalftone: AlgorithmDefinition = {
  id: "cmyk-halftone",
  name: "CMYK halftone",
  family: "halftone",
  summary:
    "Separates the image into cyan, magenta, yellow and black inks, each on its own angled screen, like a magazine page. Use the RGB cube palette for true ink colours.",
  controls: [
    { kind: "slider", id: "cell", label: "Cell size", min: 3, max: 48, step: 1, default: 8, unit: "px" },
    {
      kind: "slider",
      id: "gcr",
      label: "Black replacement",
      help: "How much of the shared grey in cyan, magenta and yellow is printed with black ink instead (GCR).",
      min: 0,
      max: 100,
      step: 5,
      default: 80,
      unit: "%",
    },
    { kind: "slider", id: "rotate", label: "Rotate screens", min: 0, max: 90, step: 1, default: 0, unit: "°" },
    { kind: "select", id: "shape", label: "Dot shape", options: SHAPES, default: "round" },
  ],
  run: (input, palette, params, ctx) => {
    const cell = Number(params.cell ?? 8);
    const gcr = Number(params.gcr ?? 80) / 100;
    const rotate = Number(params.rotate ?? 0);
    const shape = String(params.shape ?? "round") as DotShape;
    const { width: w, height: h, data: src } = input;
    const out = createBuffer(w, h);
    const dst = out.data;
    const model = createColorModel(palette, { space: "srgb", metric: ctx.color.metric });
    const rank = (x: number, y: number, angle: number) => {
      const [u, v] = screenCoords(x, y, cell, angle + rotate);
      return spotRank(shape, u, v);
    };

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        // RGB → CMY, then move the shared grey into K.
        const c0 = 1 - src[i]! / 255;
        const m0 = 1 - src[i + 1]! / 255;
        const y0 = 1 - src[i + 2]! / 255;
        const k = gcr * Math.min(c0, m0, y0);
        const scale = k < 1 ? 1 / (1 - k) : 0;
        const inkC = (c0 - k) * scale > rank(x, y, CMYK_ANGLES.c);
        const inkM = (m0 - k) * scale > rank(x, y, CMYK_ANGLES.m);
        const inkY = (y0 - k) * scale > rank(x, y, CMYK_ANGLES.y);
        const inkK = k > rank(x, y, CMYK_ANGLES.k);
        // Overprint on white paper: every ink combination is a corner of the RGB cube.
        const r = inkK || inkC ? 0 : 255;
        const g = inkK || inkM ? 0 : 255;
        const b = inkK || inkY ? 0 : 255;
        const p = palette[model.nearest(r, g, b)]!;
        dst[i] = p[0];
        dst[i + 1] = p[1];
        dst[i + 2] = p[2];
        dst[i + 3] = src[i + 3]!;
      }
    }
    return out;
  },
};
