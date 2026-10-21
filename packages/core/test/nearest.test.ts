import { describe, expect, it } from "vitest";
import { createColorModel, linearToOklab, srgbToLinear, type ColorSettings } from "../src/colorspace.ts";
import { createNearestSearch } from "../src/nearest.ts";
import { PALETTES } from "../src/palettes.ts";
import type { Palette } from "../src/types.ts";

/** The full scan the grid must agree with: squared distance, lowest index wins ties. */
function scan(targets: Float64Array, n: number, x: number, y: number, z: number): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < n; i++) {
    const d = (x - targets[i * 3]!) ** 2 + (y - targets[i * 3 + 1]!) ** 2 + (z - targets[i * 3 + 2]!) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

const SRGB = { min: [0, 0, 0], max: [255, 255, 255] } as const;

describe("createNearestSearch matches a full scan exactly", () => {
  it.each([9, 16, 40, 216])("random %i-colour palettes, in and out of range", (n) => {
    const rand = rng(n);
    for (let trial = 0; trial < 5; trial++) {
      const targets = Float64Array.from({ length: n * 3 }, () => Math.round(rand() * 255));
      const search = createNearestSearch(targets, n, SRGB);
      for (let k = 0; k < 20000; k++) {
        // Mostly in range, some pushed outside as diffusion error does.
        const q = [0, 1, 2].map(() => rand() * 400 - 70) as [number, number, number];
        expect(search(...q)).toBe(scan(targets, n, ...q));
      }
    }
  });

  it("breaks ties the same way, with duplicates and points on cell edges", () => {
    // Duplicate entries and a regular lattice: many exact ties and boundary hits.
    const lattice: number[] = [];
    for (const r of [0, 85, 170, 255]) for (const g of [0, 128, 255]) lattice.push(r, g, 64);
    lattice.push(0, 0, 64, 255, 255, 64, 85, 128, 64); // repeats of earlier entries
    const n = lattice.length / 3;
    const targets = Float64Array.from(lattice);
    const search = createNearestSearch(targets, n, SRGB);
    for (let x = -16; x <= 272; x += 16) {
      for (let y = 0; y <= 255; y += 15.9375) {
        for (const z of [0, 64, 127.5, 255]) expect(search(x, y, z)).toBe(scan(targets, n, x, y, z));
      }
    }
  });

  it("falls back cleanly for NaN", () => {
    const targets = Float64Array.from({ length: 30 }, (_, i) => i * 8);
    expect(createNearestSearch(targets, 10, SRGB)(NaN, 0, 0)).toBe(scan(targets, 10, NaN, 0, 0));
  });
});

describe("colour models give the same answer as before for every built-in palette", () => {
  const settings: ColorSettings[] = [
    { space: "srgb", metric: "srgb" },
    { space: "srgb", metric: "oklab" },
    { space: "linear", metric: "srgb" },
    { space: "linear", metric: "oklab" },
  ];
  /** The pre-grid behaviour, written out directly. */
  function reference(palette: Palette, s: ColorSettings, r: number, g: number, b: number): number {
    const toLab = (c: readonly number[]) => linearToOklab(srgbToLinear(c[0]!), srgbToLinear(c[1]!), srgbToLinear(c[2]!));
    const targets = Float64Array.from(palette.flatMap((c) => (s.metric === "oklab" ? toLab(c) : [...c])));
    let q: number[] = [r, g, b];
    if (s.space === "linear") {
      // Working values are linear light × 255; convert back the way the model does.
      const toSrgb = (v: number) => {
        const c = Math.min(1, Math.max(0, v / 255));
        return 255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
      };
      q = s.metric === "oklab" ? linearToOklab(...(q.map((v) => Math.min(1, Math.max(0, v / 255))) as [number, number, number])) : q.map(toSrgb);
    } else if (s.metric === "oklab") {
      q = toLab(q);
    }
    return scan(targets, palette.length, q[0]!, q[1]!, q[2]!);
  }

  it.each(PALETTES.map((p) => [p.id, p.colors] as const))("%s", (_id, palette) => {
    const rand = rng(palette.length);
    for (const s of settings) {
      const model = createColorModel(palette, s);
      for (let k = 0; k < 3000; k++) {
        const [r, g, b] = [0, 1, 2].map(() => rand() * 300 - 20) as [number, number, number];
        expect(model.nearest(r, g, b)).toBe(reference(palette, s, r, g, b));
      }
    }
  });
});
