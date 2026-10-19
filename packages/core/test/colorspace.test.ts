import { describe, expect, it } from "vitest";
import { createColorModel, linearToOklab, linearToSrgb, srgbToLinear } from "../src/colorspace.ts";
import { blueNoiseTexture } from "../src/ordered.ts";
import { getPalette } from "../src/palettes.ts";

describe("sRGB transfer", () => {
  it("round-trips every byte", () => {
    for (let v = 0; v <= 255; v++) expect(Math.round(linearToSrgb(srgbToLinear(v)))).toBe(v);
  });

  it("matches known values", () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(255)).toBe(1);
    expect(srgbToLinear(128)).toBeCloseTo(0.2158605, 6);
  });

  it("clamps out-of-range input", () => {
    expect(srgbToLinear(-40)).toBe(0);
    expect(srgbToLinear(300)).toBe(1);
    expect(linearToSrgb(-0.5)).toBe(0);
    expect(linearToSrgb(2)).toBeCloseTo(255, 9);
  });
});

describe("OKLab", () => {
  it("puts white at L=1 and black at L=0 with no chroma", () => {
    const [L1, a1, b1] = linearToOklab(1, 1, 1);
    expect(L1).toBeCloseTo(1, 4);
    expect(a1).toBeCloseTo(0, 4);
    expect(b1).toBeCloseTo(0, 4);
    expect(linearToOklab(0, 0, 0)[0]).toBeCloseTo(0, 6);
  });

  it("matches the reference value for sRGB red", () => {
    // Published reference: OKLab of #ff0000 ≈ (0.62796, 0.22486, 0.12585)
    const [L, a, b] = linearToOklab(1, 0, 0);
    expect(L).toBeCloseTo(0.62796, 4);
    expect(a).toBeCloseTo(0.22486, 4);
    expect(b).toBeCloseTo(0.12585, 4);
  });
});

describe("colour model", () => {
  const mono = getPalette("mono").colors;

  it("keeps sRGB working values as bytes", () => {
    const m = createColorModel(mono, { space: "srgb", metric: "srgb" });
    expect(m.toWorking(128)).toBe(128);
    expect(Array.from(m.paletteWorking)).toEqual([0, 0, 0, 255, 255, 255]);
  });

  it("scales linear working values to 0–255", () => {
    const m = createColorModel(mono, { space: "linear", metric: "srgb" });
    expect(m.toWorking(255)).toBeCloseTo(255);
    expect(m.toWorking(128)).toBeCloseTo(0.2158605 * 255, 3);
  });

  it.each([
    ["srgb", "srgb"],
    ["srgb", "oklab"],
    ["linear", "srgb"],
    ["linear", "oklab"],
  ] as const)("in %s/%s maps extremes to black and white, even past the range", (space, metric) => {
    const m = createColorModel(mono, { space, metric });
    expect(m.nearest(-50, -50, -50)).toBe(0);
    expect(m.nearest(400, 400, 400)).toBe(1);
  });
});

describe("blueNoiseTexture", () => {
  it.each([16, 32])("%i×%i is a permutation of 0..n²-1", (n) => {
    const sorted = Array.from(blueNoiseTexture(n, 7)).sort((a, b) => a - b);
    expect(sorted).toEqual(Array.from({ length: n * n }, (_, i) => i));
  });

  it("is deterministic for a seed", () => {
    expect(Array.from(blueNoiseTexture(16, 3))).toEqual(Array.from(blueNoiseTexture(16, 3)));
  });

  it.each([1, 2, 3])("clumps far less than random noise (seed %i)", (seed) => {
    // Count touching pairs (8-neighbourhood) among the lowest 10% of thresholds.
    // Random points at this density touch ~40 times; blue noise should almost never.
    const n = 32;
    const limit = Math.floor((n * n) / 10);
    const touching = (rank: ArrayLike<number>) => {
      let pairs = 0;
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          if (rank[y * n + x]! >= limit) continue;
          for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [-1, 1]] as const) {
            if (rank[((y + dy + n) % n) * n + ((x + dx + n) % n)]! < limit) pairs++;
          }
        }
      }
      return pairs;
    };
    const random = Array.from({ length: n * n }, (_, i) => i);
    let s = seed;
    for (let i = random.length - 1; i > 0; i--) {
      s = (s * 1103515245 + 12345) >>> 0;
      const j = s % (i + 1);
      [random[i], random[j]] = [random[j]!, random[i]!];
    }
    const blue = touching(blueNoiseTexture(n, seed));
    expect(touching(random)).toBeGreaterThan(20);
    expect(blue).toBeLessThanOrEqual(2);
  });
});
