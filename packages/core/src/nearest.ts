/**
 * Fast nearest-palette-colour search that returns exactly what a full scan
 * would, including ties (the lowest index wins).
 *
 * The query space is split into a grid of cells. For each cell we keep only
 * the palette entries that could be nearest to some point inside it: an
 * entry is dropped when even its closest possible distance to the cell is
 * larger than another entry's farthest possible distance. A query then
 * scans its cell's short list instead of the whole palette. Lists are built
 * the first time a cell is used, so small images pay almost nothing.
 *
 * Distances are plain squared Euclidean distances in whatever space the
 * coordinates are in (sRGB values or OKLab), so this works for both metrics.
 */

/** Below this many colours a straight scan is as fast as the grid. */
export const GRID_MIN_COLORS = 9;
const CELLS = 16;

export interface Domain {
  min: readonly [number, number, number];
  max: readonly [number, number, number];
}

/**
 * Builds a search over `n` targets (3 floats each). Queries inside `domain`
 * (widened to cover every target) use the grid; anything outside, such as
 * a value pushed past the edge by diffusion error, falls back to a full scan.
 */
export function createNearestSearch(targets: Float64Array, n: number, domain: Domain): (x: number, y: number, z: number) => number {
  const scan = (x: number, y: number, z: number): number => {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0, j = 0; i < n; i++, j += 3) {
      const dx = x - targets[j]!;
      const dy = y - targets[j + 1]!;
      const dz = z - targets[j + 2]!;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  };
  if (n < GRID_MIN_COLORS) return scan;

  const lo = [...domain.min];
  const hi = [...domain.max];
  for (let i = 0; i < n * 3; i++) {
    lo[i % 3] = Math.min(lo[i % 3]!, targets[i]!);
    hi[i % 3] = Math.max(hi[i % 3]!, targets[i]!);
  }
  const size = [0, 1, 2].map((c) => (hi[c]! - lo[c]!) / CELLS || 1);
  const [x0, y0, z0] = lo as [number, number, number];
  const [sx, sy, sz] = size as [number, number, number];
  const [ix, iy, iz] = [1 / sx, 1 / sy, 1 / sz];
  const cells: (Int32Array | undefined)[] = new Array(CELLS ** 3);

  /** Entries that can be nearest somewhere in the cell, in palette order. */
  function candidates(cx: number, cy: number, cz: number): Int32Array {
    const box = [
      [x0 + cx * sx, x0 + (cx + 1) * sx],
      [y0 + cy * sy, y0 + (cy + 1) * sy],
      [z0 + cz * sz, z0 + (cz + 1) * sz],
    ] as const;
    const minD = new Float64Array(n);
    let bound = Infinity;
    for (let i = 0; i < n; i++) {
      let near = 0;
      let far = 0;
      for (let c = 0; c < 3; c++) {
        const t = targets[i * 3 + c]!;
        const [a, b] = box[c]!;
        const dn = t < a ? a - t : t > b ? t - b : 0;
        const df = Math.max(Math.abs(t - a), Math.abs(t - b));
        near += dn * dn;
        far += df * df;
      }
      minD[i] = near;
      if (far < bound) bound = far;
    }
    // A small slack so floating-point rounding can never drop a true winner.
    const limit = bound * (1 + 1e-9) + 1e-9;
    const keep: number[] = [];
    for (let i = 0; i < n; i++) if (minD[i]! <= limit) keep.push(i);
    return Int32Array.from(keep);
  }

  return (x, y, z) => {
    const cx = Math.floor((x - x0) * ix);
    const cy = Math.floor((y - y0) * iy);
    const cz = Math.floor((z - z0) * iz);
    // Outside the grid (or NaN): fall back to the full scan.
    if (!(cx >= 0 && cx < CELLS && cy >= 0 && cy < CELLS && cz >= 0 && cz < CELLS)) return scan(x, y, z);
    const key = (cx * CELLS + cy) * CELLS + cz;
    const list = (cells[key] ??= candidates(cx, cy, cz));
    let best = list[0]!;
    let bestDist = Infinity;
    for (let k = 0; k < list.length; k++) {
      const j = list[k]! * 3;
      const dx = x - targets[j]!;
      const dy = y - targets[j + 1]!;
      const dz = z - targets[j + 2]!;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestDist) {
        bestDist = d;
        best = list[k]!;
      }
    }
    return best;
  };
}
