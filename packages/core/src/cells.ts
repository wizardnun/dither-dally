import { createBuffer } from "./color.ts";
import { createColorModel, type ColorSettings } from "./colorspace.ts";
import { darkest, lightest } from "./field.ts";
import { mulberry32 } from "./random.ts";
import type { AlgorithmDefinition, Palette, PixelBuffer, RGB } from "./types.ts";

/**
 * A partition of the image into cells. `cellOf` assigns every pixel a cell
 * index in [0, count). `inside` optionally says whether a pixel belongs to the
 * cell's shape (false = background), for shapes that don't tile.
 */
interface Partition {
  count: number;
  cellOf: Int32Array;
  inside?: Uint8Array;
}

/**
 * Fills each cell with the palette colour nearest to the cell's average
 * colour. Optional outlines draw the darkest palette colour wherever a pixel's
 * right or lower neighbour is in a different cell.
 */
function fillCells(
  input: PixelBuffer,
  palette: Palette,
  color: ColorSettings,
  part: Partition,
  opts: { outlines?: boolean; background?: RGB } = {},
): PixelBuffer {
  const { width: w, height: h, data: src } = input;
  const sums = new Float64Array(part.count * 4);
  for (let p = 0; p < w * h; p++) {
    const c = part.cellOf[p]! * 4;
    const i = p * 4;
    sums[c] = sums[c]! + src[i]!;
    sums[c + 1] = sums[c + 1]! + src[i + 1]!;
    sums[c + 2] = sums[c + 2]! + src[i + 2]!;
    sums[c + 3] = sums[c + 3]! + 1;
  }
  const model = createColorModel(palette, { space: "srgb", metric: color.metric });
  const fill: RGB[] = new Array(part.count);
  for (let c = 0; c < part.count; c++) {
    const n = sums[c * 4 + 3]! || 1;
    fill[c] = palette[model.nearest(sums[c * 4]! / n, sums[c * 4 + 1]! / n, sums[c * 4 + 2]! / n)]!;
  }
  const ink = darkest(palette);
  const out = createBuffer(w, h);
  const dst = out.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const id = part.cellOf[p]!;
      let rgb: RGB;
      if (part.inside && !part.inside[p]) rgb = opts.background ?? ink;
      else if (
        opts.outlines &&
        ((x + 1 < w && part.cellOf[p + 1] !== id) || (y + 1 < h && part.cellOf[p + w] !== id))
      )
        rgb = ink;
      else rgb = fill[id]!;
      const i = p * 4;
      dst[i] = rgb[0];
      dst[i + 1] = rgb[1];
      dst[i + 2] = rgb[2];
      dst[i + 3] = src[i + 3]!;
    }
  }
  return out;
}

/** Square grid cells, numbered row by row. */
function squareGrid(w: number, h: number, size: number): Partition & { cols: number } {
  const cols = Math.ceil(w / size);
  const rows = Math.ceil(h / size);
  const cellOf = new Int32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = Math.floor(y / size) * cols;
    for (let x = 0; x < w; x++) cellOf[y * w + x] = row + Math.floor(x / size);
  }
  return { count: cols * rows, cellOf, cols };
}

/** Renumbers arbitrary integer cell keys into a dense 0..count-1 range. */
function densify(keys: Int32Array | number[], w: number, h: number): Partition {
  const index = new Map<number, number>();
  const cellOf = new Int32Array(w * h);
  for (let p = 0; p < w * h; p++) {
    const k = keys[p]!;
    let id = index.get(k);
    if (id === undefined) {
      id = index.size;
      index.set(k, id);
    }
    cellOf[p] = id;
  }
  return { count: index.size, cellOf };
}

// ---------------------------------------------------------------------------
// Shape grid

export type GridShape = "circle" | "square" | "diamond" | "heart";

/** Whether cell-local point (u, v) ∈ [-0.5, 0.5)² is inside the shape at scale k (0–1). */
export function inShape(shape: GridShape, u: number, v: number, k: number): boolean {
  const r = 0.5 * k;
  if (r <= 0) return false;
  switch (shape) {
    case "circle":
      return u * u + v * v <= r * r;
    case "square":
      return Math.max(Math.abs(u), Math.abs(v)) <= r;
    case "diamond":
      return Math.abs(u) + Math.abs(v) <= r;
    case "heart": {
      // Implicit heart curve (x² + y² − 1)³ − x²y³ ≤ 0, scaled to fit the cell.
      const x = (u / r) * 1.15;
      const y = (-v / r) * 1.15 + 0.15;
      const a = x * x + y * y - 1;
      return a * a * a - x * x * y * y * y <= 0;
    }
  }
}

export const shapeGrid: AlgorithmDefinition = {
  id: "shape-grid",
  name: "Shape grid",
  family: "pattern",
  summary: "One flat shape per grid cell, coloured with the nearest palette colour to that patch of the image.",
  controls: [
    { kind: "slider", id: "cell", label: "Cell size", min: 4, max: 64, step: 1, default: 12, unit: "px" },
    {
      kind: "select",
      id: "shape",
      label: "Shape",
      options: [
        { value: "circle", label: "Circle" },
        { value: "square", label: "Square" },
        { value: "diamond", label: "Diamond" },
        { value: "heart", label: "Heart" },
      ],
      default: "circle",
    },
    { kind: "slider", id: "scale", label: "Shape size", min: 20, max: 100, step: 5, default: 85, unit: "%" },
    {
      kind: "select",
      id: "background",
      label: "Background",
      options: [
        { value: "dark", label: "Darkest" },
        { value: "light", label: "Lightest" },
      ],
      default: "dark",
    },
  ],
  run: (input, palette, params, ctx) => {
    const size = Number(params.cell ?? 12);
    const shape = String(params.shape ?? "circle") as GridShape;
    const k = Number(params.scale ?? 85) / 100;
    const { width: w, height: h } = input;
    const grid = squareGrid(w, h, size);
    const inside = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const v = (y % size) / size + 0.5 / size - 0.5;
      for (let x = 0; x < w; x++) {
        const u = (x % size) / size + 0.5 / size - 0.5;
        inside[y * w + x] = inShape(shape, u, v, k) ? 1 : 0;
      }
    }
    const background = params.background === "light" ? lightest(palette) : darkest(palette);
    return fillCells(input, palette, ctx.color, { ...grid, inside }, { background });
  },
};

// ---------------------------------------------------------------------------
// Voronoi cells

export const voronoiCells: AlgorithmDefinition = {
  id: "voronoi",
  name: "Voronoi cells",
  family: "pattern",
  summary: "Irregular cells around scattered points, like cracked glaze or stained glass. Change the seed for a new layout.",
  reference: { author: "Georgy Voronoi", year: 1908 },
  controls: [
    { kind: "slider", id: "cell", label: "Cell size", min: 4, max: 96, step: 1, default: 20, unit: "px" },
    { kind: "slider", id: "jitter", label: "Irregularity", min: 0, max: 100, step: 5, default: 85, unit: "%" },
    { kind: "toggle", id: "outlines", label: "Outlines", default: false },
  ],
  run: (input, palette, params, ctx) => {
    const size = Number(params.cell ?? 20);
    const jitter = Number(params.jitter ?? 85) / 100;
    const { width: w, height: h } = input;
    // One seed point per grid cell, nudged randomly within it.
    const cols = Math.ceil(w / size) + 1;
    const rows = Math.ceil(h / size) + 1;
    const rand = mulberry32(ctx.seed);
    const px = new Float64Array(cols * rows);
    const py = new Float64Array(cols * rows);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        px[j * cols + i] = (i + 0.5 + (rand() - 0.5) * jitter) * size;
        py[j * cols + i] = (j + 0.5 + (rand() - 0.5) * jitter) * size;
      }
    }
    const keys = new Int32Array(w * h);
    for (let y = 0; y < h; y++) {
      const gj = Math.floor(y / size);
      for (let x = 0; x < w; x++) {
        const gi = Math.floor(x / size);
        let best = 0;
        let bestD = Infinity;
        // The nearest seed is always within the 3×3 neighbourhood of grid cells.
        for (let dj = -1; dj <= 1; dj++) {
          const j = gj + dj;
          if (j < 0 || j >= rows) continue;
          for (let di = -1; di <= 1; di++) {
            const i = gi + di;
            if (i < 0 || i >= cols) continue;
            const s = j * cols + i;
            const dx = x + 0.5 - px[s]!;
            const dy = y + 0.5 - py[s]!;
            const d = dx * dx + dy * dy;
            if (d < bestD) {
              bestD = d;
              best = s;
            }
          }
        }
        keys[y * w + x] = best;
      }
    }
    return fillCells(input, palette, ctx.color, densify(keys, w, h), { outlines: Boolean(params.outlines) });
  },
};

// ---------------------------------------------------------------------------
// Polygons

export const hexagons: AlgorithmDefinition = {
  id: "hexagons",
  name: "Hexagons",
  family: "polygon",
  summary: "A honeycomb of flat-coloured hexagons.",
  controls: [
    { kind: "slider", id: "cell", label: "Cell size", min: 4, max: 96, step: 1, default: 16, unit: "px" },
    { kind: "toggle", id: "outlines", label: "Outlines", default: false },
  ],
  run: (input, palette, params, ctx) => {
    const size = Number(params.cell ?? 16) / 2; // centre-to-corner radius
    const { width: w, height: h } = input;
    const keys = new Int32Array(w * h);
    const OFFSET = 1 << 14;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        // Pixel → fractional axial coordinates (pointy-top), then cube rounding.
        const fx = x + 0.5;
        const fy = y + 0.5;
        const q = ((Math.sqrt(3) / 3) * fx - fy / 3) / size;
        const r = ((2 / 3) * fy) / size;
        const s = -q - r;
        let rq = Math.round(q);
        let rr = Math.round(r);
        const rs = Math.round(s);
        const dq = Math.abs(rq - q);
        const dr = Math.abs(rr - r);
        const ds = Math.abs(rs - s);
        if (dq > dr && dq > ds) rq = -rr - rs;
        else if (dr > ds) rr = -rq - rs;
        keys[y * w + x] = (rq + OFFSET) * (OFFSET * 2) + (rr + OFFSET);
      }
    }
    return fillCells(input, palette, ctx.color, densify(keys, w, h), { outlines: Boolean(params.outlines) });
  },
};

export const triangles: AlgorithmDefinition = {
  id: "triangles",
  name: "Triangles",
  family: "polygon",
  summary: "Alternating up- and down-pointing triangles tiling the image.",
  controls: [
    { kind: "slider", id: "cell", label: "Cell size", min: 4, max: 96, step: 1, default: 18, unit: "px" },
    { kind: "toggle", id: "outlines", label: "Outlines", default: false },
  ],
  run: (input, palette, params, ctx) => {
    const side = Number(params.cell ?? 18);
    const rowH = (side * Math.sqrt(3)) / 2;
    const { width: w, height: h } = input;
    const keys = new Int32Array(w * h);
    const STRIDE = 1 << 15;
    for (let y = 0; y < h; y++) {
      const row = Math.floor((y + 0.5) / rowH);
      const fy = (y + 0.5) / rowH - row; // 0 at the top of the row, 1 at the bottom
      for (let x = 0; x < w; x++) {
        // Shift odd rows by half a triangle so the tiling lines up.
        const xs = (x + 0.5) / side + (row % 2) * 0.5;
        const j = Math.floor(xs);
        const t = xs - j;
        // Up-pointing triangle: apex at the top-centre, base along the bottom.
        let col: number;
        if (Math.abs(t - 0.5) <= fy / 2) col = 2 * j;
        else col = t < 0.5 ? 2 * j - 1 : 2 * j + 1;
        keys[y * w + x] = row * STRIDE + (col + 2);
      }
    }
    return fillCells(input, palette, ctx.color, densify(keys, w, h), { outlines: Boolean(params.outlines) });
  },
};
