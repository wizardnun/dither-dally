import { describe, expect, it } from "vitest";
import { decodePreset, defaultPreset, encodePreset, parsePreset, PresetError } from "../src/preset.ts";

describe("presets", () => {
  it("round-trips through a link", () => {
    const preset = {
      ...defaultPreset("bayer"),
      params: { size: "8" },
      palette: "cga-4",
      pixelSize: 3,
      seed: 42,
      color: { space: "linear", metric: "oklab" },
    } as const;
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
    expect(() => parsePreset({ ...defaultPreset(), algorithm: "nope" })).toThrow(/Unknown algorithm/);
    expect(() => decodePreset("%%%not-base64")).toThrow(PresetError);
  });

  it("clamps, snaps and repairs bad values with warnings", () => {
    const { preset, warnings } = parsePreset({
      version: 1,
      algorithm: "floyd-steinberg",
      params: { strength: 999, serpentine: "yes", extra: 1 },
      palette: "made-up",
      pixelSize: 40,
      seed: "x",
      color: { space: "hsv", metric: "oklab" },
    });
    expect(preset.params).toEqual({ serpentine: false, strength: 200 });
    expect(preset.palette).toBe("mono");
    expect(preset.pixelSize).toBe(8);
    expect(preset.seed).toBe(1);
    expect(preset.color).toEqual({ space: "srgb", metric: "oklab" });
    expect(warnings).toHaveLength(5);
  });

  it("snaps sliders to their step", () => {
    const { preset } = parsePreset({ ...defaultPreset(), params: { strength: 103 } });
    expect(preset.params.strength).toBe(105);
  });

  it("fills missing params with defaults", () => {
    const { preset, warnings } = parsePreset({ ...defaultPreset("bayer"), params: undefined });
    expect(preset.params).toEqual({ size: "4" });
    expect(warnings).toEqual([]);
  });
});
