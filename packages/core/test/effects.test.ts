import { describe, expect, it } from "vitest";
import { createBuffer } from "../src/color.ts";
import { DEFAULT_COLOR, linearToOklab, srgbToLinear } from "../src/colorspace.ts";
import { EFFECTS, gaussianBlur, getEffect } from "../src/effects.ts";
import { extractPalette } from "../src/extract.ts";
import { getPalette } from "../src/palettes.ts";
import { runPipeline } from "../src/pipeline.ts";
import { ditherLayer, effectLayer } from "../src/preset.ts";
import { defaultParams, getAlgorithm } from "../src/registry.ts";
import { hash, solid, testImage, usesOnlyPalette } from "./fixtures.ts";

const px = (img: { data: Uint8ClampedArray }, i = 0) => Array.from(img.data.slice(i * 4, i * 4 + 3));

describe.each(EFFECTS.map((e) => [e.id, e] as const))("%s", (_id, effect) => {
  it("keeps size and alpha, and is deterministic", () => {
    const input = testImage();
    const a = effect.run(input, defaultParams(effect), { seed: 3 });
    const b = effect.run(input, defaultParams(effect), { seed: 3 });
    expect([a.width, a.height]).toEqual([input.width, input.height]);
    for (let i = 3; i < input.data.length; i += 4) expect(a.data[i]).toBe(input.data[i]);
    expect(hash(a)).toBe(hash(b));
  });

  it("does not modify its input", () => {
    const input = testImage();
    const before = hash(input);
    effect.run(input, defaultParams(effect), { seed: 3 });
    expect(hash(input)).toBe(before);
  });

  it("matches the golden output", () => {
    expect(hash(effect.run(testImage(), defaultParams(effect), { seed: 3 }))).toMatchSnapshot();
  });
});

describe("effect behaviour", () => {
  it("adjust at neutral settings changes nothing", () => {
    const input = testImage();
    expect(hash(getEffect("adjust").run(input, defaultParams(getEffect("adjust")), { seed: 1 }))).toBe(hash(input));
  });

  it("adjust brightness and saturation move values the right way", () => {
    const adjust = getEffect("adjust");
    const base = defaultParams(adjust);
    const grey = solid(2, 2, 100);
    expect(px(adjust.run(grey, { ...base, brightness: 50 }, { seed: 1 }))[0]).toBeGreaterThan(100);
    expect(px(adjust.run(grey, { ...base, brightness: -50 }, { seed: 1 }))[0]).toBeLessThan(100);
    const red = solid(1, 1, 0);
    red.data.set([200, 50, 50, 255]);
    const [r, g, b] = px(adjust.run(red, { ...base, saturation: -100 }, { seed: 1 }));
    expect(r).toBe(g);
    expect(g).toBe(b);
  });

  it("invert twice is the identity", () => {
    const invert = getEffect("invert");
    const input = testImage();
    expect(hash(invert.run(invert.run(input, {}, { seed: 1 }), {}, { seed: 1 }))).toBe(hash(input));
  });

  it("blur preserves a flat colour and averages a step", () => {
    const f = new Float32Array(10 * 3).fill(80);
    expect(Array.from(gaussianBlur(f, 10, 1, 2)).every((v) => Math.abs(v - 80) < 1e-3)).toBe(true);
    const step = new Float32Array(20 * 3);
    for (let x = 10; x < 20; x++) step.fill(200, x * 3, x * 3 + 3);
    const out = gaussianBlur(step, 20, 1, 2);
    expect(out[9 * 3]!).toBeGreaterThan(0);
    expect(out[9 * 3]!).toBeLessThan(200);
  });

  it("tint in normal-ish multiply over white gives the tint colour", () => {
    const tint = getEffect("tint");
    const out = tint.run(solid(2, 2, 255), { color: "#3366cc", mode: "multiply", opacity: 100 }, { seed: 1 });
    expect(px(out)).toEqual([0x33, 0x66, 0xcc]);
  });

  it("tint at zero opacity changes nothing", () => {
    const input = testImage();
    expect(hash(getEffect("tint").run(input, { color: "#ff0000", mode: "screen", opacity: 0 }, { seed: 1 }))).toBe(hash(input));
  });

  it("vignette leaves the centre and darkens the corners", () => {
    const out = getEffect("vignette").run(solid(41, 41, 200), defaultParams(getEffect("vignette")), { seed: 1 });
    expect(px(out, 20 * 41 + 20)[0]).toBe(200);
    expect(px(out, 0)[0]).toBeLessThan(200);
  });

  it("grain changes with the seed", () => {
    const grain = getEffect("grain");
    const a = grain.run(solid(16, 16, 128), defaultParams(grain), { seed: 1 });
    const b = grain.run(solid(16, 16, 128), defaultParams(grain), { seed: 2 });
    expect(hash(a)).not.toBe(hash(b));
  });

  it("chromatic split at zero distance changes nothing", () => {
    const input = testImage();
    expect(hash(getEffect("chromatic-split").run(input, { distance: 0, angle: 0 }, { seed: 1 }))).toBe(hash(input));
  });
});

describe("runPipeline", () => {
  const mono = getPalette("mono").colors;
  const settings = (layers: Parameters<typeof runPipeline>[1]["layers"]) => ({ layers, palette: mono, seed: 1, color: DEFAULT_COLOR });

  it("with only a dither layer, matches running the algorithm directly", () => {
    const d = { ...ditherLayer("atkinson"), id: "d" };
    const direct = getAlgorithm("atkinson").run(testImage(), mono, d.params, { seed: 1, color: DEFAULT_COLOR });
    expect(hash(runPipeline(testImage(), settings([d])))).toBe(hash(direct));
  });

  it("skips disabled layers", () => {
    const d = { ...ditherLayer(), id: "d" };
    const off = { ...effectLayer("invert"), id: "i", enabled: false };
    expect(hash(runPipeline(testImage(), settings([off, d])))).toBe(hash(runPipeline(testImage(), settings([d]))));
  });

  it("order matters: an effect after the dither can add colours", () => {
    const d = { ...ditherLayer(), id: "d" };
    const t = { ...effectLayer("tint"), id: "t", params: { color: "#ff8800", mode: "multiply", opacity: 100 } };
    expect(usesOnlyPalette(runPipeline(testImage(), settings([t, d])), mono)).toBe(true);
    expect(usesOnlyPalette(runPipeline(testImage(), settings([d, t])), mono)).toBe(false);
  });

  it("gives two grain layers different noise, and keeps it when reordered", () => {
    const g1 = { ...effectLayer("grain"), id: "g1" };
    const g2 = { ...effectLayer("grain"), id: "g2" };
    const one = runPipeline(solid(16, 16, 128), settings([g1]));
    const two = runPipeline(solid(16, 16, 128), settings([g2]));
    expect(hash(one)).not.toBe(hash(two));
    const ab = runPipeline(solid(16, 16, 128), settings([g1, g2]));
    const ba = runPipeline(solid(16, 16, 128), settings([g2, g1]));
    // Additive noise with clamping is order-independent except at the clamps; mid-grey stays clear of them.
    expect(hash(ab)).toBe(hash(ba));
  });
});

describe("extractPalette", () => {
  function threeColourImage() {
    const img = createBuffer(30, 10);
    const cols = [
      [200, 30, 30],
      [30, 160, 60],
      [20, 40, 220],
    ];
    for (let p = 0; p < 300; p++) img.data.set([...cols[Math.floor((p % 30) / 10)]!, 255], p * 4);
    return img;
  }

  it("finds the exact colours of a 3-colour image", () => {
    const pal = extractPalette(threeColourImage(), 3).map((c) => c.join());
    expect(pal.sort()).toEqual(["20,40,220", "200,30,30", "30,160,60"].sort());
  });

  it("is deterministic for a seed and returns at most k colours, dark to light", () => {
    const a = extractPalette(testImage(), 6, 7);
    expect(a).toEqual(extractPalette(testImage(), 6, 7));
    expect(a.length).toBeLessThanOrEqual(6);
    // Ordered by perceived lightness (OKLab L), allowing for rounding to 8-bit.
    const L = a.map(([r, g, b]) => linearToOklab(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b))[0]);
    for (let i = 1; i < L.length; i++) expect(L[i]!).toBeGreaterThanOrEqual(L[i - 1]! - 0.005);
  });

  it("never returns more colours than the image has", () => {
    expect(extractPalette(threeColourImage(), 8).length).toBe(3);
  });

  it("ignores fully transparent pixels", () => {
    const img = threeColourImage();
    for (let p = 0; p < 300; p++) if (p % 30 >= 10) img.data[p * 4 + 3] = 0;
    expect(extractPalette(img, 4).map((c) => c.join())).toEqual(["200,30,30"]);
  });
});
