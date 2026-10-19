import { describe, expect, it } from "vitest";
import { inShape } from "../src/cells.ts";
import { DEFAULT_COLOR } from "../src/colorspace.ts";
import { circleCoverage, screenCoords, spotRank, type DotShape } from "../src/halftone.ts";
import { getPalette } from "../src/palettes.ts";
import { defaultParams, getAlgorithm } from "../src/registry.ts";
import { hilbertPoint } from "../src/riemersma.ts";
import { solid, testImage } from "./fixtures.ts";

const ctx = { seed: 1, color: DEFAULT_COLOR };
const mono = getPalette("mono").colors;

function inkShare(img: { data: Uint8ClampedArray }) {
  let ink = 0;
  for (let i = 0; i < img.data.length; i += 4) if (img.data[i] === 0) ink++;
  return ink / (img.data.length / 4);
}

describe("halftone geometry", () => {
  it("circle coverage hits the known landmarks", () => {
    expect(circleCoverage(0)).toBe(0);
    expect(circleCoverage(0.5)).toBeCloseTo(Math.PI / 4, 10); // inscribed circle
    expect(circleCoverage(Math.SQRT1_2)).toBe(1); // circumscribed circle covers the cell
  });

  it("circle coverage is continuous and increasing", () => {
    let prev = 0;
    for (let r = 0.01; r <= 0.72; r += 0.01) {
      const c = circleCoverage(r);
      expect(c).toBeGreaterThanOrEqual(prev);
      expect(c - prev).toBeLessThan(0.05);
      prev = c;
    }
  });

  // Spot ranks are coverage: sampling a cell finely, the share of points with rank < t is ≈ t.
  it.each(["round", "diamond", "square", "line"] as DotShape[])("%s dot rank is uniform over the cell", (shape) => {
    const n = 200;
    for (const t of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      let below = 0;
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          if (spotRank(shape, (i + 0.5) / n - 0.5, (j + 0.5) / n - 0.5) < t) below++;
        }
      }
      expect(below / (n * n)).toBeCloseTo(t, 1);
    }
  });

  it("screen coordinates stay inside the cell", () => {
    for (const angle of [0, 15, 45, 75]) {
      for (let k = 0; k < 500; k++) {
        const [u, v] = screenCoords(k * 7.3, k * 3.1, 9, angle);
        expect(u).toBeGreaterThanOrEqual(-0.5);
        expect(u).toBeLessThan(0.5);
        expect(v).toBeGreaterThanOrEqual(-0.5);
        expect(v).toBeLessThan(0.5);
      }
    }
  });
});

describe("halftone algorithms", () => {
  it.each([0.2, 0.5, 0.8])("halftone reproduces %s ink coverage", (tone) => {
    const out = getAlgorithm("halftone").run(solid(240, 240, Math.round(255 * (1 - tone))), mono, defaultParams(getAlgorithm("halftone")), ctx);
    expect(inkShare(out)).toBeCloseTo(tone, 1);
  });

  it("CMYK halftone prints pure colours with the matching ink only", () => {
    const algo = getAlgorithm("cmyk-halftone");
    const rgb8 = getPalette("rgb-8").colors;
    const img = solid(64, 64, 0);
    for (let i = 0; i < img.data.length; i += 4) img.data.set([0, 255, 255, 255], i); // pure cyan
    const out = algo.run(img, rgb8, defaultParams(algo), ctx);
    const seen = new Set<string>();
    for (let i = 0; i < out.data.length; i += 4) seen.add(`${out.data[i]},${out.data[i + 1]},${out.data[i + 2]}`);
    expect([...seen]).toEqual(["0,255,255"]);
  });

  it("CMYK halftone with full black replacement prints grey in black ink only", () => {
    const algo = getAlgorithm("cmyk-halftone");
    const out = algo.run(solid(64, 64, 128), getPalette("rgb-8").colors, { ...defaultParams(algo), gcr: 100 }, ctx);
    for (let i = 0; i < out.data.length; i += 4) {
      const px = `${out.data[i]},${out.data[i + 1]},${out.data[i + 2]}`;
      expect(["0,0,0", "255,255,255"]).toContain(px);
    }
  });
});

describe("pattern and polygon algorithms", () => {
  it("crosshatch leaves white paper white and fills black", () => {
    const algo = getAlgorithm("crosshatch");
    expect(inkShare(algo.run(solid(48, 48, 255), mono, defaultParams(algo), ctx))).toBe(0);
    expect(inkShare(algo.run(solid(48, 48, 0), mono, defaultParams(algo), ctx))).toBe(1);
  });

  it("crosshatch gets darker as the input does", () => {
    const algo = getAlgorithm("crosshatch");
    const shares = [220, 160, 100, 40].map((v) => inkShare(algo.run(solid(96, 96, v), mono, defaultParams(algo), ctx)));
    for (let i = 1; i < shares.length; i++) expect(shares[i]!).toBeGreaterThan(shares[i - 1]!);
  });

  it.each(["circle", "square", "diamond", "heart"] as const)("%s shape contains its centre and excludes corners", (shape) => {
    expect(inShape(shape, 0, 0.05, 0.9)).toBe(true);
    expect(inShape(shape, 0.49, 0.49, 0.9)).toBe(false);
  });

  it.each(["voronoi", "hexagons", "triangles"])("%s fills each cell with a single colour", (id) => {
    // Without outlines, a flat colour must come out flat.
    const algo = getAlgorithm(id);
    const out = algo.run(solid(80, 60, 200), getPalette("grey-4").colors, defaultParams(algo), ctx);
    const first = out.data.slice(0, 3).join();
    for (let i = 0; i < out.data.length; i += 4) expect(out.data.slice(i, i + 3).join()).toBe(first);
  });

  it.each(["voronoi", "hexagons", "triangles"])("%s outlines use the darkest palette colour", (id) => {
    const algo = getAlgorithm(id);
    const out = algo.run(solid(80, 60, 255), mono, { ...defaultParams(algo), outlines: true }, ctx);
    const share = inkShare(out);
    expect(share).toBeGreaterThan(0.02);
    expect(share).toBeLessThan(0.5);
  });

  it("voronoi layout changes with the seed", () => {
    const algo = getAlgorithm("voronoi");
    const p = { ...defaultParams(algo), outlines: true };
    const a = algo.run(testImage(), mono, p, { seed: 1, color: DEFAULT_COLOR });
    const b = algo.run(testImage(), mono, p, { seed: 2, color: DEFAULT_COLOR });
    expect(Array.from(a.data)).not.toEqual(Array.from(b.data));
  });
});

describe("hilbertPoint", () => {
  it.each([2, 4, 16, 64])("visits every cell of a %i×%i square once, in unit steps", (n) => {
    const seen = new Set<number>();
    let prev = hilbertPoint(n, 0);
    for (let d = 0; d < n * n; d++) {
      const [x, y] = hilbertPoint(n, d);
      expect(x).toBeLessThan(n);
      expect(y).toBeLessThan(n);
      seen.add(y * n + x);
      if (d > 0) expect(Math.abs(x - prev[0]) + Math.abs(y - prev[1])).toBe(1);
      prev = [x, y];
    }
    expect(seen.size).toBe(n * n);
  });
});
