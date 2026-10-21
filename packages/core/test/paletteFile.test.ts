import { describe, expect, it } from "vitest";
import { PaletteFileError, parsePaletteFile, toGpl } from "../src/paletteFile.ts";
import { PALETTES } from "../src/palettes.ts";
import { parsePreset, defaultPreset } from "../src/preset.ts";

describe("parsePaletteFile", () => {
  it("reads GIMP palettes, including the Name header", () => {
    const gpl = "GIMP Palette\nName: Dusk\nColumns: 4\n#\n  0   0   0\tBlack\n255 128   0 Orange\n 12  34  56\n";
    const p = parsePaletteFile(gpl, "ignored.gpl");
    expect(p.name).toBe("Dusk");
    expect(p.colors).toEqual([
      [0, 0, 0],
      [255, 128, 0],
      [12, 34, 56],
    ]);
  });

  it("reads JASC palettes, skipping the header lines", () => {
    const p = parsePaletteFile("JASC-PAL\r\n0100\r\n3\r\n10 20 30\r\n40 50 60\r\n70 80 90\r\n", "mine.pal");
    expect(p.name).toBe("mine");
    expect(p.colors).toEqual([
      [10, 20, 30],
      [40, 50, 60],
      [70, 80, 90],
    ]);
  });

  it("reads hex lists with or without #, and Paint.NET AARRGGBB with comments", () => {
    expect(parsePaletteFile("ff0000\n#00FF00\n0000ff\n").colors).toEqual([
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
    ]);
    const pdn = ";paint.net Palette File\n;Colors: 2\nFF112233\nFFAABBCC ; light\n";
    expect(parsePaletteFile(pdn).colors).toEqual([
      [0x11, 0x22, 0x33],
      [0xaa, 0xbb, 0xcc],
    ]);
  });

  it("drops duplicates and says so", () => {
    const p = parsePaletteFile("000000\nffffff\n000000\n");
    expect(p.colors).toHaveLength(2);
    expect(p.warnings).toEqual(["Removed 1 duplicate colour."]);
  });

  it("keeps at most 256 colours", () => {
    const hexes = Array.from({ length: 300 }, (_, i) => (i * 1000).toString(16).padStart(6, "0")).join("\n");
    const p = parsePaletteFile(hexes);
    expect(p.colors).toHaveLength(256);
    expect(p.warnings[0]).toMatch(/first 256 of 300/);
  });

  it("explains files it can't use", () => {
    expect(() => parsePaletteFile("hello\nworld")).toThrow(PaletteFileError);
    expect(() => parsePaletteFile("ff0000")).toThrow(/only one colour/);
    expect(() => parsePaletteFile("GIMP Palette\n300 0 0\n0 0 0")).toThrow(/0–255/);
  });

  it("round-trips through toGpl", () => {
    const pico = PALETTES.find((p) => p.id === "pico-8")!;
    const back = parsePaletteFile(toGpl(pico.name, pico.colors));
    expect(back.name).toBe("PICO-8");
    expect(back.colors).toEqual(pico.colors);
  });
});

describe("built-in palettes", () => {
  it("has the 216 distinct web-safe colours", () => {
    const web = PALETTES.find((p) => p.id === "web-216")!;
    expect(web.colors).toHaveLength(216);
    expect(new Set(web.colors.map((c) => c.join())).size).toBe(216);
    expect(web.colors.flat().every((v) => v % 0x33 === 0)).toBe(true);
  });

  it("presets can carry imported palettes up to 256 colours", () => {
    const colors = Array.from({ length: 256 }, (_, i) => `#${i.toString(16).padStart(2, "0")}0000`);
    const { preset, warnings } = parsePreset({ ...defaultPreset(), palette: { name: "Big", colors } });
    expect(warnings).toEqual([]);
    expect(typeof preset.palette === "string" ? 0 : preset.palette.colors.length).toBe(256);
  });
});
