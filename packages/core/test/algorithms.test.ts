import { describe, expect, it } from "vitest";
import { DEFAULT_COLOR, type ColorSettings } from "../src/colorspace.ts";
import { ALGORITHMS, TONAL_FAMILIES, defaultParams, getAlgorithm } from "../src/registry.ts";
import { getPalette, PALETTES } from "../src/palettes.ts";
import { hash, solid, testImage, usesOnlyPalette } from "./fixtures.ts";

const ctx = { seed: 1, color: DEFAULT_COLOR };
const COLOR_MODES: ColorSettings[] = [
  { space: "srgb", metric: "srgb" },
  { space: "srgb", metric: "oklab" },
  { space: "linear", metric: "srgb" },
  { space: "linear", metric: "oklab" },
];

describe.each(ALGORITHMS.map((a) => [a.id, a] as const))("%s", (_id, algo) => {
  const params = defaultParams(algo);

  if (algo.keepsColours) {
    it("passes the image through unchanged, as a copy", () => {
      const input = testImage();
      const out = algo.run(input, getPalette("mono").colors, params, ctx);
      expect(hash(out)).toBe(hash(input));
      expect(out.data).not.toBe(input.data);
    });
  } else {
    it.each(PALETTES.map((p) => [p.id, p] as const))("emits only colours from %s", (_pid, palette) => {
      const out = algo.run(testImage(), palette.colors, params, ctx);
      expect(usesOnlyPalette(out, palette.colors)).toBe(true);
    });
  }

  it("keeps size and alpha (text styles draw an opaque page)", () => {
    const input = testImage();
    const out = algo.run(input, getPalette("mono").colors, params, ctx);
    expect([out.width, out.height]).toEqual([input.width, input.height]);
    const opaque = algo.family === "text";
    for (let i = 3; i < input.data.length; i += 4) expect(out.data[i]).toBe(opaque ? 255 : input.data[i]);
  });

  it("is deterministic", () => {
    const a = algo.run(testImage(), getPalette("cga-4").colors, params, ctx);
    const b = algo.run(testImage(), getPalette("cga-4").colors, params, ctx);
    expect(hash(a)).toBe(hash(b));
  });

  it("matches the golden output", () => {
    const out = algo.run(testImage(), getPalette("grey-4").colors, params, ctx);
    expect(hash(out)).toMatchSnapshot();
  });

  it.skipIf(algo.keepsColours).each(COLOR_MODES.map((c) => [`${c.space}/${c.metric}`, c] as const))(
    "emits only palette colours in %s mode",
    (_label, color) => {
      const palette = getPalette("ega-16").colors;
      const out = algo.run(testImage(), palette, params, { seed: 1, color });
      expect(usesOnlyPalette(out, palette)).toBe(true);
    },
  );
});

describe("colour modes", () => {
  it.each(COLOR_MODES.map((c) => [`${c.space}/${c.metric}`, c] as const))(
    "floyd-steinberg golden output in %s mode",
    (_label, color) => {
      const algo = getAlgorithm("floyd-steinberg");
      const out = algo.run(testImage(), getPalette("cga-4").colors, defaultParams(algo), { seed: 1, color });
      expect(hash(out)).toMatchSnapshot();
    },
  );

  it("linear-light diffusion renders 50% sRGB grey darker than sRGB diffusion", () => {
    // sRGB 128 is ~21.6% of linear light, so physically correct dithering uses fewer white pixels.
    const algo = getAlgorithm("floyd-steinberg");
    const mono = getPalette("mono").colors;
    const whiteShare = (color: ColorSettings) => {
      const out = algo.run(solid(128, 128, 128), mono, defaultParams(algo), { seed: 1, color });
      let white = 0;
      for (let i = 0; i < out.data.length; i += 4) if (out.data[i] === 255) white++;
      return white / (128 * 128);
    };
    expect(whiteShare({ space: "srgb", metric: "srgb" })).toBeCloseTo(0.5, 1);
    expect(whiteShare({ space: "linear", metric: "srgb" })).toBeCloseTo(0.216, 1);
  });

  it("OKLab matching can choose a different colour than sRGB distance", () => {
    // A dusky blue: sRGB distance picks dark grey, OKLab picks EGA blue.
    const algo = getAlgorithm("nearest");
    const palette = getPalette("ega-16").colors;
    const img = solid(1, 1, 0);
    img.data.set([40, 40, 120, 255]);
    const srgb = algo.run(img, palette, {}, { seed: 1, color: { space: "srgb", metric: "srgb" } });
    const oklab = algo.run(img, palette, {}, { seed: 1, color: { space: "srgb", metric: "oklab" } });
    expect(Array.from(srgb.data.slice(0, 3))).toEqual([85, 85, 85]);
    expect(Array.from(oklab.data.slice(0, 3))).toEqual([0, 0, 170]);
  });
});

describe("tone reproduction", () => {
  // A flat 50% grey should come out close to half white on a 1-bit palette.
  // Atkinson deliberately drops a quarter of the error, so it isn't tone-accurate.
  // CMYK halftone needs ink colours: on a 1-bit palette a lone cyan, magenta or
  // yellow dot snaps to white (its own tests use the RGB cube palette).
  const notOnMono = new Set(["atkinson", "cmyk-halftone"]);
  const tonal = ALGORITHMS.filter((a) => TONAL_FAMILIES.has(a.family) && !notOnMono.has(a.id));
  it.each(tonal.map((a) => [a.id, a] as const))("%s renders 50%% grey as ~50%% white", (_id, algo) => {
    const out = algo.run(solid(128, 128, 128), getPalette("mono").colors, defaultParams(algo), ctx);
    let white = 0;
    for (let i = 0; i < out.data.length; i += 4) if (out.data[i] === 255) white++;
    expect(white / (128 * 128)).toBeGreaterThan(0.45);
    expect(white / (128 * 128)).toBeLessThan(0.55);
  });

  it("threshold level moves the cut-off", () => {
    const algo = getAlgorithm("threshold");
    const mono = getPalette("mono").colors;
    const grey = solid(4, 4, 100);
    expect(algo.run(grey, mono, { level: 128 }, ctx).data[0]).toBe(0);
    expect(algo.run(grey, mono, { level: 90 }, ctx).data[0]).toBe(255);
  });

  it.each(["white-noise", "blue-noise"])("%s changes with the seed", (id) => {
    const algo = getAlgorithm(id);
    const mono = getPalette("mono").colors;
    const a = algo.run(testImage(), mono, defaultParams(algo), { seed: 1, color: DEFAULT_COLOR });
    const b = algo.run(testImage(), mono, defaultParams(algo), { seed: 2, color: DEFAULT_COLOR });
    expect(hash(a)).not.toBe(hash(b));
  });
});
