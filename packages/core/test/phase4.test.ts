import { describe, expect, it } from "vitest";
import { createBuffer } from "../src/color.ts";
import { DEFAULT_COLOR } from "../src/colorspace.ts";
import { getPalette } from "../src/palettes.ts";
import { defaultParams, getAlgorithm } from "../src/registry.ts";
import { hash, solid, testImage } from "./fixtures.ts";

const ctx = { seed: 1, color: DEFAULT_COLOR };
const mono = getPalette("mono").colors;

function inkShare(img: { data: Uint8ClampedArray }) {
  let ink = 0;
  for (let i = 0; i < img.data.length; i += 4) if (img.data[i] === 0) ink++;
  return ink / (img.data.length / 4);
}

describe("line screens reproduce tone", () => {
  it.each(["wave-lines", "rings", "spiral"])("%s inks ~share of a flat grey", (id) => {
    const algo = getAlgorithm(id);
    for (const tone of [0.25, 0.5, 0.75]) {
      const out = algo.run(solid(160, 160, Math.round(255 * (1 - tone))), mono, defaultParams(algo), ctx);
      expect(inkShare(out)).toBeCloseTo(tone, 1);
    }
  });

  it("engraving gets darker as the input does", () => {
    const algo = getAlgorithm("engraving");
    const shares = [210, 150, 90, 30].map((v) => inkShare(algo.run(solid(96, 96, v), mono, defaultParams(algo), ctx)));
    for (let i = 1; i < shares.length; i++) expect(shares[i]!).toBeGreaterThan(shares[i - 1]!);
  });

  it("engraving with no bend is the same line screen as unwaved wave lines", () => {
    const img = testImage();
    const engraved = getAlgorithm("engraving").run(img, mono, { spacing: 6, angle: 30, bend: 0, smoothness: 6 }, ctx);
    const straight = getAlgorithm("wave-lines").run(img, mono, { spacing: 6, angle: 30, amplitude: 0, wavelength: 80 }, ctx);
    expect(hash(engraved)).toBe(hash(straight));
  });

  it("engraving bends lines where brightness changes", () => {
    // A vertical step from dark to light: horizontal lines (angle 0) must jump at the step.
    const img = createBuffer(80, 40);
    for (let p = 0; p < 3200; p++) {
      const v = p % 80 < 40 ? 40 : 215;
      img.data.set([v, v, v, 255], p * 4);
    }
    const out = getAlgorithm("engraving").run(img, mono, { spacing: 8, angle: 0, bend: 50, smoothness: 0 }, ctx);
    const column = (x: number) => Array.from({ length: 40 }, (_, y) => out.data[(y * 80 + x) * 4]).join();
    expect(column(10)).not.toBe(column(70)); // lines sit at different heights either side
  });
});

describe("contours", () => {
  it("draws nothing on a flat image and a line at each level crossing on a ramp", () => {
    const algo = getAlgorithm("contours");
    expect(inkShare(algo.run(solid(40, 40, 128), mono, defaultParams(algo), ctx))).toBe(0);
    const ramp = createBuffer(256, 4);
    for (let p = 0; p < 1024; p++) {
      const v = p % 256;
      ramp.data.set([v, v, v, 255], p * 4);
    }
    const out = algo.run(ramp, mono, { levels: 8, width: 1, smoothing: 0, fill: false }, ctx);
    let lines = 0;
    for (let x = 0; x < 256; x++) if (out.data[(256 + x) * 4] === 0) lines++;
    expect(lines).toBe(7); // 8 levels → 7 boundaries
  });
});

describe("glitch styles", () => {
  it("streak with no carry is plain nearest colour", () => {
    const streak = getAlgorithm("streak");
    const nearest = getAlgorithm("nearest");
    const img = testImage();
    expect(hash(streak.run(img, mono, { direction: "rows", carry: 0, breaks: 0 }, ctx))).toBe(hash(nearest.run(img, mono, {}, ctx)));
  });

  it("streak keeps rows independent", () => {
    // Changing one row must not affect any other row.
    const streak = getAlgorithm("streak");
    const a = testImage();
    const b = testImage();
    for (let x = 0; x < b.width; x++) b.data.set([255, 0, 0, 255], (10 * b.width + x) * 4);
    const oa = streak.run(a, mono, defaultParams(streak), ctx);
    const ob = streak.run(b, mono, defaultParams(streak), ctx);
    for (let y = 0; y < a.height; y++) {
      if (y === 10) continue;
      const row = (o: { data: Uint8ClampedArray }) => o.data.slice(y * a.width * 4, (y + 1) * a.width * 4).join();
      expect(row(oa)).toBe(row(ob));
    }
  });

  it("slip with zero density is exactly Floyd–Steinberg", () => {
    const slip = getAlgorithm("slip");
    const fs = getAlgorithm("floyd-steinberg");
    const img = testImage();
    expect(hash(slip.run(img, mono, { band: 6, distance: 12, density: 0 }, ctx))).toBe(
      hash(fs.run(img, mono, defaultParams(fs), ctx)),
    );
  });

  it("slip tears change with the seed", () => {
    const slip = getAlgorithm("slip");
    const a = slip.run(testImage(), mono, defaultParams(slip), { seed: 1, color: DEFAULT_COLOR });
    const b = slip.run(testImage(), mono, defaultParams(slip), { seed: 2, color: DEFAULT_COLOR });
    expect(hash(a)).not.toBe(hash(b));
  });
});
