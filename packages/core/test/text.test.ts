import { describe, expect, it } from "vitest";
import { createBuffer } from "../src/color.ts";
import { DEFAULT_COLOR } from "../src/colorspace.ts";
import { CELL_H, CELL_W, FONT_CHARS, GLYPH_SOURCE, coverage, glyph } from "../src/font.ts";
import { getPalette } from "../src/palettes.ts";
import { runUntilDither } from "../src/pipeline.ts";
import { ditherLayer, effectLayer, parsePreset, defaultPreset } from "../src/preset.ts";
import { CHARSETS, CHAR_ASPECT, makeAsciiArt, makeBrailleArt, renderTextArt, toHtml, toPlainText, usableChars } from "../src/text.ts";
import { solid } from "./fixtures.ts";

const mono = getPalette("mono").colors;
const ascii = (img: Parameters<typeof makeAsciiArt>[0], opts: Partial<Parameters<typeof makeAsciiArt>[3]> = {}) =>
  makeAsciiArt(img, mono, DEFAULT_COLOR, { cols: 10, chars: CHARSETS.classic!.chars, match: "shape", mode: "dark-on-light", ...opts });

/** A white image with black pixels wherever `ink(x, y)` is true. */
function draw(w: number, h: number, ink: (x: number, y: number) => boolean) {
  const img = createBuffer(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = ink(x, y) ? 0 : 255;
    img.data.set([v, v, v, 255], (y * w + x) * 4);
  }
  return img;
}

describe("font", () => {
  it.each(Object.entries(GLYPH_SOURCE))("%j is a well-formed 5×7 glyph", (_ch, src) => {
    const rows = src.split("|");
    expect(rows).toHaveLength(7);
    for (const r of rows) expect(r).toMatch(/^[#.]{5}$/);
  });

  it("has the block shades, from empty to full", () => {
    expect(coverage(glyph(" ")!)).toBe(0);
    expect(coverage(glyph("░")!)).toBeCloseTo(0.25);
    expect(coverage(glyph("▒")!)).toBeCloseTo(0.5);
    expect(coverage(glyph("▓")!)).toBeCloseTo(0.75);
    expect(coverage(glyph("█")!)).toBe(1);
    expect(glyph("█")!.length).toBe(CELL_W * CELL_H);
  });

  it.each(Object.entries(CHARSETS))("the %s set is fully drawable", (_id, set) => {
    expect(usableChars(set.chars)).toHaveLength([...new Set(set.chars)].length);
  });

  it("usableChars drops unknown and repeated characters", () => {
    expect(usableChars("aa€ c")).toEqual(["a", " ", "c"]);
    expect(FONT_CHARS.length).toBeGreaterThan(55);
  });
});

describe("ASCII", () => {
  it("lays out cells for monospace proportions", () => {
    const art = ascii(solid(200, 300, 255), { cols: 20 });
    expect(art.cols).toBe(20);
    expect(art.rows).toBe(Math.floor(300 / (200 / 20 / CHAR_ASPECT)));
    expect(art.lines.every((l) => [...l].length === 20)).toBe(true);
  });

  it("white paper is blank and black is the densest character", () => {
    expect(new Set(ascii(solid(60, 60, 255)).lines.join(""))).toEqual(new Set([" "]));
    const densest = [...CHARSETS.classic!.chars].reduce((a, b) => (coverage(glyph(b)!) > coverage(glyph(a)!) ? b : a));
    expect(new Set(ascii(solid(60, 60, 0)).lines.join(""))).toEqual(new Set([densest]));
  });

  it("light-on-dark inverts the mapping", () => {
    expect(new Set(ascii(solid(60, 60, 0), { mode: "light-on-dark" }).lines.join(""))).toEqual(new Set([" "]));
  });

  it("gets denser as the image darkens (tone matching)", () => {
    const ramp = createBuffer(240, 30);
    for (let y = 0; y < 30; y++) for (let x = 0; x < 240; x++) {
      const v = Math.round(255 - (x / 239) * 255);
      ramp.data.set([v, v, v, 255], (y * 240 + x) * 4);
    }
    const line = ascii(ramp, { cols: 24, match: "tone" }).lines[0]!;
    const cov = [...line].map((c) => coverage(glyph(c)!));
    for (let i = 1; i < cov.length; i++) expect(cov[i]!).toBeGreaterThanOrEqual(cov[i - 1]!);
    expect(cov[0]).toBe(0);
  });

  // One cell, 12 × 20 px, Detailed set: the chosen glyph should follow the stroke.
  const detailed = { cols: 1, chars: CHARSETS.detailed!.chars };
  it("matches a vertical stroke with a vertical character", () => {
    const ch = ascii(draw(12, 20, (x) => x >= 4 && x <= 5), detailed).lines[0]!;
    expect("|!lI1i").toContain(ch);
  });

  it("matches a horizontal stroke with a horizontal character", () => {
    const ch = ascii(draw(12, 20, (_x, y) => y >= 9 && y <= 10), detailed).lines[0]!;
    expect("-_=~").toContain(ch);
  });

  it("matches a rising diagonal with /", () => {
    // Glyphs occupy the top-left 5×7 of the 6×8 cell, so draw the stroke where "/" sits:
    // from sample (4.5, 0.5) to (0.5, 6.5). One sample = 2 × 2.5 px in this 12 × 20 cell.
    const ch = ascii(
      draw(12, 20, (x, y) => {
        const sx = x / 2 + 0.25;
        const sy = y / 2.5 + 0.25;
        return sy < 7 && Math.abs(sx - (4.5 - ((sy - 0.5) * 4) / 6)) < 0.6;
      }),
      detailed,
    ).lines[0]!;
    expect(ch).toBe("/");
  });

  it("falls back to Classic when a custom set has fewer than two drawable characters", () => {
    const a = ascii(solid(60, 60, 0), { chars: "€€" });
    expect(new Set(a.lines.join(""))).toEqual(new Set(["@"]));
  });

  it("colour mode gives each cell a palette colour", () => {
    const img = createBuffer(60, 40);
    for (let p = 0; p < 2400; p++) img.data.set(p % 60 < 30 ? [255, 0, 0, 255] : [0, 0, 255, 255], p * 4);
    const art = makeAsciiArt(img, getPalette("rgb-8").colors, DEFAULT_COLOR, { cols: 2, chars: " #", match: "tone", mode: "colour" });
    expect(art.colors!.slice(0, 2)).toEqual([
      [255, 0, 0],
      [0, 0, 255],
    ]);
  });
});

describe("Braille", () => {
  const br = (img: Parameters<typeof makeBrailleArt>[0], mode: "dark-on-light" | "light-on-dark" = "dark-on-light") =>
    makeBrailleArt(img, mono, DEFAULT_COLOR, { cols: 10, dither: "diffusion", mode });

  it("black is all dots and white is blank", () => {
    expect(new Set(br(solid(60, 60, 0)).lines.join(""))).toEqual(new Set(["⣿"]));
    expect(new Set(br(solid(60, 60, 255)).lines.join(""))).toEqual(new Set(["⠀"]));
  });

  it("uses Unicode dot numbering: the left column is dots 1, 2, 3, 7", () => {
    const art = makeBrailleArt(draw(20, 33, (x) => x < 10), mono, DEFAULT_COLOR, { cols: 1, dither: "threshold", mode: "dark-on-light" });
    expect(art.lines[0]).toBe(String.fromCharCode(0x2800 + 0x01 + 0x02 + 0x04 + 0x40));
  });

  it("diffuses a mid grey to about half the dots", () => {
    const art = br(solid(200, 200, 128));
    let on = 0;
    for (const d of art.dots!) for (let b = 0; b < 8; b++) on += (d >> b) & 1;
    expect(on / (art.dots!.length * 8)).toBeCloseTo(0.5, 1);
  });
});

describe("transparency", () => {
  /** A transparent image (stored as transparent *black*, like most PNGs) with an opaque mid-grey square. */
  const cutout = () => {
    const img = createBuffer(120, 120);
    for (let y = 0; y < 120; y++) for (let x = 0; x < 120; x++) {
      const inside = x >= 40 && x < 80 && y >= 40 && y < 80;
      img.data.set(inside ? [90, 90, 90, 255] : [0, 0, 0, 0], (y * 120 + x) * 4);
    }
    return img;
  };

  it.each(["dark-on-light", "light-on-dark"] as const)("transparent areas are blank in %s ASCII", (mode) => {
    const art = ascii(cutout(), { cols: 12, mode });
    expect(art.lines[0]).toBe(" ".repeat(12));
    expect(art.lines.at(-1)).toBe(" ".repeat(12));
    expect(art.lines.join("").trim().length).toBeGreaterThan(0); // the square still draws
  });

  it("transparent areas are blank in Braille", () => {
    const art = makeBrailleArt(cutout(), mono, DEFAULT_COLOR, { cols: 12, dither: "diffusion", mode: "dark-on-light" });
    expect(art.lines[0]).toBe("⠀".repeat(12));
  });

  it("the picture shows ink only where the text has characters", () => {
    // The rendered view and the copied text must agree: no ink in blank cells, ink in drawn cells.
    const input = cutout();
    const art = ascii(input, { cols: 12 });
    const out = renderTextArt(art, 120, 120);
    const cellW = 120 / 12;
    const cellH = cellW / CHAR_ASPECT;
    for (let cy = 0; cy < art.rows; cy++) {
      for (let cx = 0; cx < art.cols; cx++) {
        let ink = 0;
        for (let y = Math.ceil(cy * cellH); y < (cy + 1) * cellH; y++) {
          for (let x = cx * cellW; x < (cx + 1) * cellW; x++) if (out.data[(y * 120 + x) * 4] === 0) ink++;
        }
        expect(ink > 0).toBe(art.lines[cy]![cx] !== " ");
      }
    }
  });

  it("draws an opaque page: transparent input comes out as solid paper", () => {
    const out = renderTextArt(ascii(cutout(), { cols: 12 }), 120, 120);
    for (let i = 3; i < out.data.length; i += 4) expect(out.data[i]).toBe(255);
    expect(Array.from(out.data.slice(0, 3))).toEqual([255, 255, 255]); // paper in the transparent corner
  });

  it("uses a host font rasterizer at the exact cell size, falling back to the pixel font", () => {
    const art = ascii(cutout(), { cols: 12 });
    const calls: string[] = [];
    // A fake "font" that inks the whole cell for "*" and declines everything else.
    const fake = (ch: string, w: number, h: number) => {
      calls.push(`${ch}:${w}x${h}`);
      return ch === "*" ? new Uint8Array(w * h).fill(1) : null;
    };
    const out = renderTextArt(art, 120, 120, fake);
    const cellW = 120 / 12;
    expect(calls.every((c) => c.endsWith(`:${Math.ceil(cellW)}x${Math.ceil(cellW / CHAR_ASPECT)}`))).toBe(true);
    expect(new Set(calls).size).toBe(calls.length); // one call per character, cached
    // A "*" cell is now solid ink; other characters still use the built-in glyphs.
    const star = art.lines.flatMap((l, cy) => [...l].map((c, cx) => [c, cx, cy] as const)).find(([c]) => c === "*");
    if (star) {
      const [, cx, cy] = star;
      const x = Math.floor(cx * cellW + cellW / 2);
      const y = Math.floor(cy * (cellW / CHAR_ASPECT) + 2);
      expect(out.data[(y * 120 + x) * 4]).toBe(0);
    }
  });

  it("digits are in the font", () => {
    expect(usableChars("0123456789")).toHaveLength(10);
  });
});

describe("golden text art (readable snapshots)", () => {
  // A dark disc with a soft edge on white, plus a vertical bar: shapes worth recognising.
  const scene = () => {
    const w = 144;
    const h = 120;
    const img = createBuffer(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - 60, y - 60) / 40;
      let v = d < 1 ? 40 + 120 * d * d : 255;
      if (x >= 118 && x < 126 && y > 15 && y < 105) v = 0;
      img.data.set([v, v, v, 255], (y * w + x) * 4);
    }
    return img;
  };

  it("ASCII, shape matching", () => {
    expect("\n" + toPlainText(ascii(scene(), { cols: 24, chars: CHARSETS.detailed!.chars }))).toMatchSnapshot();
  });

  it("Braille, diffused", () => {
    expect("\n" + toPlainText(makeBrailleArt(scene(), mono, DEFAULT_COLOR, { cols: 24, dither: "diffusion", mode: "dark-on-light" }))).toMatchSnapshot();
  });
});

describe("text export", () => {
  it("plain text trims trailing spaces and ends with a newline", () => {
    const art = { cols: 3, rows: 2, lines: ["ab ", "  c"], colors: null, ink: [0, 0, 0] as const, paper: [255, 255, 255] as const, dots: null };
    expect(toPlainText(art)).toBe("ab\n  c\n");
  });

  it("HTML escapes markup and merges colour runs", () => {
    const art = {
      cols: 3,
      rows: 1,
      lines: ["<&>"],
      colors: [[255, 0, 0], [255, 0, 0], [0, 0, 255]] as [number, number, number][],
      ink: [255, 255, 255] as const,
      paper: [0, 0, 0] as const,
      dots: null,
    };
    const html = toHtml(art, "a < b");
    expect(html).toContain('<span style="color:#ff0000">&lt;&amp;</span><span style="color:#0000ff">&gt;</span>');
    expect(html).toContain("<title>a &lt; b</title>");
  });
});

describe("text plumbing", () => {
  it("runUntilDither applies only the layers above the dither", () => {
    const invert = { ...effectLayer("invert"), id: "i" };
    const after = { ...effectLayer("invert"), id: "j" };
    const out = runUntilDither(solid(4, 4, 0), { layers: [invert, { ...ditherLayer(), id: "d" }, after], palette: mono, seed: 1, color: DEFAULT_COLOR });
    expect(out.data[0]).toBe(255);
  });

  it("presets validate and shorten text controls", () => {
    const { preset, warnings } = parsePreset({
      ...defaultPreset("ascii"),
      layers: [{ id: "d", kind: "dither", algorithm: "ascii", params: { custom: "x".repeat(100), charset: "custom" } }],
    });
    expect([...String(preset.layers[0]!.params.custom)]).toHaveLength(64);
    expect(warnings.join()).toMatch(/too long/);
  });
});
