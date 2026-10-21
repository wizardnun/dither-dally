import { describe, expect, it } from "vitest";
import { createBuffer } from "../src/color.ts";
import { DEFAULT_COLOR } from "../src/colorspace.ts";
import { gaussianKernel } from "../src/diffusion.ts";
import { equalize } from "../src/field.ts";
import { getPalette } from "../src/palettes.ts";
import { defaultParams, getAlgorithm } from "../src/registry.ts";
import { getEffect } from "../src/effects.ts";
import { hash, solid, testImage } from "./fixtures.ts";

const ctx = { seed: 1, color: DEFAULT_COLOR };
const mono = getPalette("mono").colors;

function inkShare(img: { data: Uint8ClampedArray }) {
  let ink = 0;
  for (let i = 0; i < img.data.length; i += 4) if (img.data[i] === 0) ink++;
  return ink / (img.data.length / 4);
}

describe("equalize", () => {
  it("spreads bunched values evenly and keeps their order", () => {
    const values = Float32Array.from({ length: 1000 }, (_, i) => (i / 1000) ** 4);
    const ranks = equalize(values);
    for (let i = 1; i < ranks.length; i++) expect(ranks[i]!).toBeGreaterThanOrEqual(ranks[i - 1]!);
    expect(ranks[250]!).toBeCloseTo(0.25, 1);
    expect(ranks[750]!).toBeCloseTo(0.75, 1);
  });

  it("gives a flat field the middle rank", () => {
    expect([...equalize(new Float32Array(4).fill(3))]).toEqual([0.5, 0.5, 0.5, 0.5]);
  });
});

describe("gaussian", () => {
  it("only sends error forward", () => {
    for (const sigma of [0.5, 1, 2.5]) {
      const { taps, divisor } = gaussianKernel(sigma);
      for (const [dx, dy] of taps) expect(dy > 0 || dx > 0).toBe(true);
      expect(taps.reduce((s, t) => s + t[2], 0)).toBeCloseTo(divisor, 6);
    }
  });

  it("widens with spread", () => {
    expect(gaussianKernel(3).taps.length).toBeGreaterThan(gaussianKernel(0.5).taps.length);
  });

  it("reproduces a flat grey", () => {
    const algo = getAlgorithm("gaussian");
    for (const tone of [0.25, 0.5, 0.75]) {
      const out = algo.run(solid(96, 96, Math.round(255 * (1 - tone))), mono, defaultParams(algo), ctx);
      expect(inkShare(out)).toBeCloseTo(tone, 1);
    }
  });
});

describe("tone-tracking patterns", () => {
  it.each(["moire", "stipple"])("%s inks ~share of a flat grey", (id) => {
    const algo = getAlgorithm(id);
    for (const tone of [0.25, 0.5, 0.75]) {
      const out = algo.run(solid(160, 160, Math.round(255 * (1 - tone))), mono, defaultParams(algo), ctx);
      expect(inkShare(out)).toBeCloseTo(tone, 1);
    }
  });

  it("stipple dots move with the seed", () => {
    const algo = getAlgorithm("stipple");
    const img = solid(64, 64, 160);
    const a = algo.run(img, mono, defaultParams(algo), { seed: 1, color: DEFAULT_COLOR });
    const b = algo.run(img, mono, defaultParams(algo), { seed: 2, color: DEFAULT_COLOR });
    expect(hash(a)).not.toBe(hash(b));
  });

  it("checker turns mid grey into a 1-pixel checkerboard and keeps near-black solid", () => {
    const algo = getAlgorithm("checker");
    const mid = algo.run(solid(8, 8, 128), mono, defaultParams(algo), ctx);
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) expect(mid.data[(y * 8 + x) * 4]).toBe((x + y) & 1 ? 255 : 0);
    expect(inkShare(algo.run(solid(8, 8, 20), mono, defaultParams(algo), ctx))).toBe(1);
  });
});

describe("edges", () => {
  it("draws nothing on a flat image and a line along a step", () => {
    const algo = getAlgorithm("edges");
    expect(inkShare(algo.run(solid(32, 32, 100), mono, defaultParams(algo), ctx))).toBe(0);
    const step = createBuffer(40, 10);
    for (let p = 0; p < 400; p++) {
      const v = p % 40 < 20 ? 30 : 220;
      step.data.set([v, v, v, 255], p * 4);
    }
    const out = algo.run(step, mono, { ...defaultParams(algo), smoothing: 0 }, ctx);
    const row = Array.from({ length: 40 }, (_, x) => out.data[(5 * 40 + x) * 4] === 0);
    expect(row[19] || row[20]).toBe(true);
    expect(row[5] || row[35]).toBe(false);
  });

  it("swaps ink and paper when inverted", () => {
    const algo = getAlgorithm("edges");
    const out = algo.run(solid(16, 16, 100), mono, { ...defaultParams(algo), invert: true }, ctx);
    expect(inkShare(out)).toBe(1);
  });
});

describe("ripple", () => {
  it("with no depth and no bleed is Streak at full carry", () => {
    const img = testImage();
    for (const direction of ["rows", "columns"]) {
      const ripple = getAlgorithm("ripple").run(img, mono, { direction, period: 32, depth: 0, bleed: 0 }, ctx);
      const streak = getAlgorithm("streak").run(img, mono, { direction, carry: 100, breaks: 0 }, ctx);
      expect(hash(ripple)).toBe(hash(streak));
    }
  });

  it("depth and bleed both change the result", () => {
    const algo = getAlgorithm("ripple");
    const img = testImage();
    const base = hash(algo.run(img, mono, { direction: "rows", period: 16, depth: 0, bleed: 0 }, ctx));
    expect(hash(algo.run(img, mono, { direction: "rows", period: 16, depth: 100, bleed: 0 }, ctx))).not.toBe(base);
    expect(hash(algo.run(img, mono, { direction: "rows", period: 16, depth: 0, bleed: 50 }, ctx))).not.toBe(base);
  });
});

describe("whirl", () => {
  it("reproduces a flat grey at any twist", () => {
    const algo = getAlgorithm("whirl");
    for (const twist of [-100, 0, 60]) {
      for (const tone of [0.25, 0.5, 0.75]) {
        const out = algo.run(solid(120, 90, Math.round(255 * (1 - tone))), mono, { ...defaultParams(algo), twist }, ctx);
        expect(inkShare(out)).toBeCloseTo(tone, 1);
      }
    }
  });

  it("twist changes the grain", () => {
    const algo = getAlgorithm("whirl");
    const img = testImage();
    expect(hash(algo.run(img, mono, { ...defaultParams(algo), twist: 0 }, ctx))).not.toBe(hash(algo.run(img, mono, defaultParams(algo), ctx)));
  });
});

describe("pentagons", () => {
  /** Areas of the outlined regions that don't touch the border (4-connected flood fill of paper pixels). */
  function tileAreas(out: { width: number; height: number; data: Uint8ClampedArray }) {
    const { width: w, height: h, data } = out;
    const seen = new Uint8Array(w * h);
    const areas: number[] = [];
    for (let start = 0; start < w * h; start++) {
      if (seen[start] || data[start * 4] === 0) continue;
      let area = 0;
      let border = false;
      const stack = [start];
      seen[start] = 1;
      while (stack.length) {
        const p = stack.pop()!;
        area++;
        const x = p % w;
        const y = (p - x) / w;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
        for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
          if (q >= 0 && !seen[q] && data[q * 4] !== 0) {
            seen[q] = 1;
            stack.push(q);
          }
        }
      }
      if (!border) areas.push(area);
    }
    return areas;
  }

  it("tiles the plane with equal-sized tiles at any angle", () => {
    const algo = getAlgorithm("pentagons");
    for (const angle of [0, 33]) {
      const areas = tileAreas(algo.run(solid(300, 300, 255), mono, { cell: 30, angle, outlines: true }, ctx));
      expect(areas.length).toBeGreaterThan(60);
      const mean = areas.reduce((a, b) => a + b, 0) / areas.length;
      for (const a of areas) expect(Math.abs(a - mean) / mean).toBeLessThan(0.12);
    }
  });
});

describe("curvature", () => {
  it.each(["bayer", "blue-noise"])("%s bends the pattern but keeps the tone", (id) => {
    const algo = getAlgorithm(id);
    const img = solid(160, 120, 128);
    const flat = algo.run(img, mono, { ...defaultParams(algo), curve: 0 }, ctx);
    const bent = algo.run(img, mono, { ...defaultParams(algo), curve: 100 }, ctx);
    expect(hash(bent)).not.toBe(hash(flat));
    expect(inkShare(bent)).toBeCloseTo(inkShare(flat), 1);
  });
});

describe("echoes", () => {
  it("centres rings on the brightest spots", async () => {
    const { brightPeaks } = await import("../src/lines.ts");
    const img = solid(200, 120, 20);
    for (const [cx, cy] of [[50, 40], [150, 80]] as const)
      for (let y = 0; y < 120; y++)
        for (let x = 0; x < 200; x++) if (Math.hypot(x - cx, y - cy) < 10) img.data.set([255, 255, 255, 255], (y * 200 + x) * 4);
    const peaks = brightPeaks(img, 4, 40);
    expect(peaks.length).toBeGreaterThanOrEqual(2);
    for (const [cx, cy] of [[50, 40], [150, 80]]) expect(peaks.some((p) => Math.hypot(p.x - cx!, p.y - cy!) < 10)).toBe(true);
  });

  it("inks ~share of a flat grey", () => {
    const algo = getAlgorithm("echoes");
    for (const tone of [0.25, 0.5, 0.75]) {
      const out = algo.run(solid(160, 160, Math.round(255 * (1 - tone))), mono, defaultParams(algo), ctx);
      expect(inkShare(out)).toBeCloseTo(tone, 1);
    }
  });
});

describe("glow orbs", () => {
  const orbs = getEffect("orbs");
  it("only brightens, most at the orb centres, and follows the seed", () => {
    const img = solid(120, 80, 60);
    const p = { count: 3, size: 40, variation: 0, intensity: 100, color: "#ffffff" };
    const out = orbs.run(img, p, { seed: 5 });
    let brighter = 0;
    for (let i = 0; i < out.data.length; i += 4) {
      expect(out.data[i]!).toBeGreaterThanOrEqual(60);
      if (out.data[i]! > 60) brighter++;
    }
    expect(brighter).toBeGreaterThan(0);
    expect(hash(orbs.run(img, p, { seed: 6 }))).not.toBe(hash(out));
  });

  it("does nothing at zero intensity", () => {
    const img = testImage();
    expect(hash(orbs.run(img, { count: 6, size: 80, variation: 50, intensity: 0, color: "#ffffff" }, { seed: 1 }))).toBe(hash(img));
  });
});

describe("subpixels", () => {
  const fx = getEffect("subpixels");
  const plain = { cell: 12, layout: "stripes", sample: "average", gap: 25, focus: 0, brightness: 100, glow: 0, haze: 0, tint: "#6a5cff" };

  it("lights each stripe only with its own channel", () => {
    const out = fx.run(solid(36, 12, 200), plain, { seed: 1 });
    // Middle row of the first cell: red third, green third, blue third.
    const at = (x: number) => Array.from(out.data.subarray((6 * 36 + x) * 4, (6 * 36 + x) * 4 + 3));
    expect(at(2)).toEqual([200, 0, 0]);
    expect(at(6)).toEqual([0, 200, 0]);
    expect(at(10)).toEqual([0, 0, 200]);
  });

  it("leaves dark gaps between rows and stays black where the image is", () => {
    const out = fx.run(solid(24, 24, 255), plain, { seed: 1 });
    for (let x = 0; x < 24; x++) expect(out.data[(0 * 24 + x) * 4]! + out.data[(0 * 24 + x) * 4 + 1]! + out.data[(0 * 24 + x) * 4 + 2]!).toBe(0);
    const dark = fx.run(solid(24, 24, 0), { ...plain, glow: 100, haze: 100, focus: 50 }, { seed: 1 });
    expect(Math.max(...Array.from(dark.data).filter((_, i) => i % 4 !== 3))).toBe(0);
  });

  it("spills overexposed light into the other channels", () => {
    const red = createBuffer(12, 12);
    for (let i = 0; i < red.data.length; i += 4) red.data.set([255, 0, 0, 255], i);
    const out = fx.run(red, { ...plain, brightness: 400 }, { seed: 1 });
    const core = (6 * 12 + 2) * 4;
    expect(out.data[core]).toBe(255);
    expect(out.data[core + 1]!).toBeGreaterThan(200); // red pushed past white goes pale
  });

  it("centre sampling keeps a cell fully on or off", () => {
    const img = createBuffer(24, 12);
    for (let p = 0; p < 24 * 12; p++) img.data.set(p % 24 === 6 ? [255, 255, 255, 255] : [0, 0, 0, 255], p * 4);
    const avg = fx.run(img, { ...plain, layout: "led" }, { seed: 1 });
    const ctr = fx.run(img, { ...plain, layout: "led", sample: "centre" }, { seed: 1 });
    const mid = (6 * 24 + 6) * 4;
    expect(avg.data[mid]!).toBeLessThan(60);
    expect(ctr.data[mid]).toBe(255);
  });
});
