import { describe, expect, it } from "vitest";
import {
  decodePreset,
  defaultPreset,
  ditherLayer,
  effectLayer,
  encodePreset,
  getDitherLayer,
  parsePreset,
  PresetError,
  resolvePalette,
  type Preset,
} from "../src/preset.ts";

describe("presets (version 2)", () => {
  it("round-trips through a link, layers and all", () => {
    const preset: Preset = {
      ...defaultPreset("bayer"),
      layers: [
        { ...effectLayer("adjust"), id: "adj", params: { brightness: 10, contrast: 20, midtones: 0, saturation: -30, hue: 0 } },
        { ...ditherLayer("bayer"), id: "dit", params: { size: "8", curve: 0 } },
        { ...effectLayer("tint"), id: "tnt", enabled: false, params: { color: "#00aaff", mode: "screen", opacity: 50 } },
      ],
      palette: { name: "Mine", colors: ["#101010", "#f0e0d0", "#ff0000"] },
      pixelSize: 3,
      seed: 42,
      color: { space: "linear", metric: "oklab" },
    };
    const { preset: back, warnings } = decodePreset(encodePreset(preset));
    expect(back).toEqual(preset);
    expect(warnings).toEqual([]);
  });

  it("produces URL-safe text", () => {
    expect(encodePreset(defaultPreset())).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("rejects things that aren't presets", () => {
    expect(() => parsePreset(null)).toThrow(PresetError);
    expect(() => parsePreset([1, 2])).toThrow(PresetError);
    expect(() => parsePreset({ ...defaultPreset(), version: 99 })).toThrow(/version/);
    expect(() => parsePreset({ ...defaultPreset(), layers: "nope" })).toThrow(/layers/);
    expect(() => decodePreset("%%%not-base64")).toThrow(PresetError);
  });

  it("clamps, snaps and repairs bad values with warnings", () => {
    const { preset, warnings } = parsePreset({
      version: 2,
      layers: [{ id: "d", kind: "dither", enabled: true, algorithm: "floyd-steinberg", params: { strength: 999, serpentine: "yes", extra: 1 } }],
      palette: "made-up",
      pixelSize: 40,
      seed: "x",
      color: { space: "hsv", metric: "oklab" },
    });
    expect(getDitherLayer(preset).params).toEqual({ serpentine: false, strength: 200 });
    expect(preset.palette).toBe("mono");
    expect(preset.pixelSize).toBe(8);
    expect(preset.seed).toBe(1);
    expect(preset.color).toEqual({ space: "srgb", metric: "oklab" });
    // serpentine, unknown key, palette, seed, colour space. Out-of-range numbers are clamped silently.
    expect(warnings).toHaveLength(5);
  });

  it("guarantees exactly one dither layer", () => {
    const none = parsePreset({ ...defaultPreset(), layers: [effectLayer("invert")] });
    expect(none.preset.layers.filter((l) => l.kind === "dither")).toHaveLength(1);
    expect(none.warnings.join()).toMatch(/No dither layer/);

    const two = parsePreset({ ...defaultPreset(), layers: [ditherLayer("bayer"), ditherLayer("atkinson")] });
    expect(two.preset.layers).toHaveLength(1);
    expect(getDitherLayer(two.preset).algorithm).toBe("bayer");
  });

  it("drops unknown effects and repairs duplicate ids", () => {
    const { preset, warnings } = parsePreset({
      ...defaultPreset(),
      layers: [
        { id: "x", kind: "effect", effect: "teleport", params: {} },
        { id: "same", kind: "effect", effect: "invert", params: {} },
        { id: "same", kind: "dither", algorithm: "bayer", params: {} },
      ],
    });
    expect(preset.layers.map((l) => l.kind)).toEqual(["effect", "dither"]);
    expect(new Set(preset.layers.map((l) => l.id)).size).toBe(2);
    expect(warnings.join()).toMatch(/teleport/);
  });

  it("validates colour controls", () => {
    const { preset, warnings } = parsePreset({
      ...defaultPreset(),
      layers: [ditherLayer(), { id: "t", kind: "effect", effect: "tint", params: { color: "red" } }],
    });
    expect(preset.layers[1]!.params.color).toBe("#ff5a36");
    expect(warnings.join()).toMatch(/Invalid colour/);
  });

  it("rejects custom palettes that are too small or malformed", () => {
    for (const palette of [{ colors: ["#000000"] }, { colors: ["#000", "#fff"] }, { colors: "x" }]) {
      const { preset, warnings } = parsePreset({ ...defaultPreset(), palette });
      expect(preset.palette).toBe("mono");
      expect(warnings.join()).toMatch(/custom palette/);
    }
  });

  it("resolves built-in and custom palettes", () => {
    expect(resolvePalette("cga-4")).toHaveLength(4);
    expect(resolvePalette({ name: "x", colors: ["#000000", "#ff8000"] })).toEqual([
      [0, 0, 0],
      [255, 128, 0],
    ]);
  });
});

describe("version 1 migration", () => {
  it("turns the single algorithm into a dither layer, keeping everything else", () => {
    const v1 = {
      version: 1,
      algorithm: "bayer",
      params: { size: "8" },
      palette: "cga-4",
      pixelSize: 3,
      seed: 42,
      color: { space: "linear", metric: "oklab" },
    };
    const { preset, warnings } = parsePreset(v1);
    expect(warnings).toEqual([]);
    expect(preset.version).toBe(2);
    expect(preset.layers).toHaveLength(1);
    expect(getDitherLayer(preset)).toMatchObject({ kind: "dither", enabled: true, algorithm: "bayer", params: { size: "8" } });
    expect(preset).toMatchObject({ palette: "cga-4", pixelSize: 3, seed: 42, color: { space: "linear", metric: "oklab" } });
  });

  it("still opens Phase 1 links", () => {
    // A real link produced by the Phase 1 app.
    const link =
      "eyJ2ZXJzaW9uIjoxLCJhbGdvcml0aG0iOiJibHVlLW5vaXNlIiwicGFyYW1zIjp7InNpemUiOiI2NCJ9LCJwYWxldHRlIjoiZWdhLTE2IiwicGl4ZWxTaXplIjoyLCJzZWVkIjoxLCJjb2xvciI6eyJzcGFjZSI6InNyZ2IiLCJtZXRyaWMiOiJva2xhYiJ9fQ";
    const { preset } = decodePreset(link);
    expect(getDitherLayer(preset).algorithm).toBe("blue-noise");
    expect(preset.palette).toBe("ega-16");
  });

  it("rejects version 1 presets with an unknown algorithm", () => {
    expect(() => parsePreset({ version: 1, algorithm: "nope" })).toThrow(/Unknown algorithm/);
  });
});
