import { createBuffer, toHex } from "./color.ts";
import { createColorModel, type ColorSettings } from "./colorspace.ts";
import { darkest, lightest } from "./field.ts";
import { CELL_H, CELL_W, FONT_CHARS, coverage, glyph, type Glyph } from "./font.ts";
import type { AlgorithmDefinition, GlyphRasterizer, Palette, Params, PixelBuffer, RGB } from "./types.ts";

/**
 * Width / height of one character cell. Typical monospace fonts are about
 * 0.6 as wide as they are tall, so art sampled at this ratio keeps its
 * proportions when the text is pasted into an editor or terminal.
 */
export const CHAR_ASPECT = 0.6;

export type TextColorMode = "dark-on-light" | "light-on-dark" | "colour";

/** The result of turning an image into characters, before it's drawn. */
export interface TextArt {
  cols: number;
  rows: number;
  /** One string per row, `cols` characters long. */
  lines: string[];
  /** Per-cell character colour (row-major), or null when every character uses `ink`. */
  colors: RGB[] | null;
  ink: RGB;
  paper: RGB;
  /** For Braille: the 8 dot bits per cell (row-major), used to draw dots instead of glyphs. */
  dots: Uint8Array | null;
}

export const CHARSETS: Record<string, { label: string; chars: string }> = {
  classic: { label: "Classic", chars: " .:-=+*#%@" },
  detailed: { label: "Detailed", chars: FONT_CHARS.filter((c) => !"░▒▓█".includes(c)).join("") },
  simple: { label: "Simple", chars: " .oO@" },
  blocks: { label: "Blocks", chars: " ░▒▓█" },
  binary: { label: "Binary", chars: "01" },
};

/** Characters from `chars` the font can draw, deduplicated, in order. */
export function usableChars(chars: string): string[] {
  return [...new Set([...chars])].filter((c) => glyph(c) !== undefined);
}

interface Grid {
  cols: number;
  rows: number;
  cellW: number;
  cellH: number;
}

function grid(width: number, height: number, cols: number): Grid {
  const c = Math.max(1, Math.min(Math.round(cols), width));
  const cellW = width / c;
  const cellH = cellW / CHAR_ASPECT;
  return { cols: c, rows: Math.max(1, Math.floor(height / cellH)), cellW, cellH };
}

/**
 * Averages the image into a fine grid of `sx × sy` samples per character cell.
 * Returns per-sample brightness (0–1) and per-cell mean colour.
 *
 * Pixels are first composited over `paper` by their alpha, so transparent
 * areas read as blank paper. (A transparent pixel still stores an RGB value,
 * usually black, which would otherwise come out as the densest character.)
 */
function sample(input: PixelBuffer, g: Grid, sx: number, sy: number, paper: RGB) {
  const { width: w, height: h, data } = input;
  const gw = g.cols * sx;
  const gh = g.rows * sy;
  const lum = new Float64Array(gw * gh);
  const count = new Float64Array(gw * gh);
  const rgb = new Float64Array(g.cols * g.rows * 4);
  const usedH = Math.min(h, Math.floor(g.rows * g.cellH));
  for (let y = 0; y < usedH; y++) {
    const fy = y / g.cellH;
    const cy = Math.min(g.rows - 1, Math.floor(fy));
    const sy_ = Math.min(gh - 1, Math.floor(fy * sy));
    for (let x = 0; x < w; x++) {
      const fx = x / g.cellW;
      const cx = Math.min(g.cols - 1, Math.floor(fx));
      const sx_ = Math.min(gw - 1, Math.floor(fx * sx));
      const i = (y * w + x) * 4;
      const a = data[i + 3]! / 255;
      const r = data[i]! * a + paper[0] * (1 - a);
      const gg = data[i + 1]! * a + paper[1] * (1 - a);
      const b = data[i + 2]! * a + paper[2] * (1 - a);
      const s = sy_ * gw + sx_;
      lum[s] = lum[s]! + (0.2126 * r + 0.7152 * gg + 0.0722 * b) / 255;
      count[s] = count[s]! + 1;
      const c = (cy * g.cols + cx) * 4;
      rgb[c] = rgb[c]! + r;
      rgb[c + 1] = rgb[c + 1]! + gg;
      rgb[c + 2] = rgb[c + 2]! + b;
      rgb[c + 3] = rgb[c + 3]! + 1;
    }
  }
  for (let i = 0; i < lum.length; i++) lum[i] = count[i]! ? lum[i]! / count[i]! : 1;
  return { lum, gw, rgb };
}

function cellColors(rgb: Float64Array, palette: Palette, color: ColorSettings, cells: number): RGB[] {
  const model = createColorModel(palette, { space: "srgb", metric: color.metric });
  const out: RGB[] = new Array(cells);
  for (let c = 0; c < cells; c++) {
    const n = rgb[c * 4 + 3]! || 1;
    out[c] = palette[model.nearest(rgb[c * 4]! / n, rgb[c * 4 + 1]! / n, rgb[c * 4 + 2]! / n)]!;
  }
  return out;
}

function inkAndPaper(palette: Palette, mode: TextColorMode): { ink: RGB; paper: RGB } {
  return mode === "dark-on-light" ? { ink: darkest(palette), paper: lightest(palette) } : { ink: lightest(palette), paper: darkest(palette) };
}

export interface AsciiOptions {
  cols: number;
  chars: string;
  match: "shape" | "tone";
  mode: TextColorMode;
}

/**
 * Shape matching scores each glyph as
 *   TONE_WEIGHT × (coverage − target)²  −  2 × mean(cellPattern × glyphPattern)
 * where both patterns have their mean removed. The second term is a
 * correlation: zero on a flat cell (so tone alone decides, with no bias
 * toward any glyph), and most negative for the glyph whose strokes line up
 * with the cell's light and dark. (A plain squared difference would instead
 * penalise every glyph by its own variance, skewing flat areas.)
 */
const TONE_WEIGHT = 4;

export function makeAsciiArt(input: PixelBuffer, palette: Palette, color: ColorSettings, opts: AsciiOptions): TextArt {
  let chars = usableChars(opts.chars);
  if (chars.length < 2) chars = usableChars(CHARSETS.classic!.chars);
  const glyphs = chars.map((c) => glyph(c)!);
  const cov = glyphs.map(coverage);
  const cmin = Math.min(...cov);
  const cmax = Math.max(...cov);
  // Zero-mean ink pattern per glyph (Float64Array: a Uint8Array map would truncate the negatives).
  const means = glyphs.map((g, k) => Float64Array.from(g, (v) => v - cov[k]!));

  const g = grid(input.width, input.height, opts.cols);
  const { ink, paper } = inkAndPaper(palette, opts.mode);
  const { lum, gw, rgb } = sample(input, g, CELL_W, CELL_H, paper);
  const light = opts.mode !== "dark-on-light"; // ink represents light instead of dark
  const n = CELL_W * CELL_H;
  const d = new Float64Array(n);
  const lines: string[] = [];
  for (let cy = 0; cy < g.rows; cy++) {
    let line = "";
    for (let cx = 0; cx < g.cols; cx++) {
      let mean = 0;
      for (let y = 0; y < CELL_H; y++) {
        for (let x = 0; x < CELL_W; x++) {
          const v = lum[(cy * CELL_H + y) * gw + cx * CELL_W + x]!;
          const ink = light ? v : 1 - v;
          d[y * CELL_W + x] = ink;
          mean += ink;
        }
      }
      mean /= n;
      const target = cmin + mean * (cmax - cmin);
      let best = 0;
      let bestScore = Infinity;
      for (let k = 0; k < glyphs.length; k++) {
        const tone = (cov[k]! - target) ** 2;
        let score = TONE_WEIGHT * tone;
        if (opts.match === "shape") {
          const m = means[k]!;
          let corr = 0;
          for (let i = 0; i < n; i++) corr += (d[i]! - mean) * m[i]!;
          score -= (2 * corr) / n;
        }
        if (score < bestScore) {
          bestScore = score;
          best = k;
        }
      }
      line += chars[best];
    }
    lines.push(line);
  }
  const colors = opts.mode === "colour" ? cellColors(rgb, palette, color, g.cols * g.rows) : null;
  return { cols: g.cols, rows: g.rows, lines, colors, ink, paper, dots: null };
}

/** Bit for the Braille dot at column `x` (0–1), row `y` (0–3), per Unicode's dot numbering. */
const BRAILLE_BIT = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
];

export interface BrailleOptions {
  cols: number;
  dither: "diffusion" | "threshold";
  mode: TextColorMode;
}

export function makeBrailleArt(input: PixelBuffer, palette: Palette, color: ColorSettings, opts: BrailleOptions): TextArt {
  const g = grid(input.width, input.height, opts.cols);
  const { ink, paper } = inkAndPaper(palette, opts.mode);
  const { lum, gw, rgb } = sample(input, g, 2, 4, paper);
  const gh = g.rows * 4;
  const light = opts.mode !== "dark-on-light";
  // Ink amount per dot, then Floyd–Steinberg (or a plain threshold) down to on/off.
  const v = new Float64Array(gw * gh);
  for (let i = 0; i < v.length; i++) v[i] = light ? lum[i]! : 1 - lum[i]!;
  const on = new Uint8Array(gw * gh);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const i = y * gw + x;
      const bit = v[i]! >= 0.5 ? 1 : 0;
      on[i] = bit;
      if (opts.dither === "diffusion") {
        const e = v[i]! - bit;
        if (x + 1 < gw) v[i + 1] = v[i + 1]! + (e * 7) / 16;
        if (y + 1 < gh) {
          if (x > 0) v[i + gw - 1] = v[i + gw - 1]! + (e * 3) / 16;
          v[i + gw] = v[i + gw]! + (e * 5) / 16;
          if (x + 1 < gw) v[i + gw + 1] = v[i + gw + 1]! + (e * 1) / 16;
        }
      }
    }
  }
  const dots = new Uint8Array(g.cols * g.rows);
  const lines: string[] = [];
  for (let cy = 0; cy < g.rows; cy++) {
    let line = "";
    for (let cx = 0; cx < g.cols; cx++) {
      let bits = 0;
      for (let y = 0; y < 4; y++) for (let x = 0; x < 2; x++) if (on[(cy * 4 + y) * gw + cx * 2 + x]) bits |= BRAILLE_BIT[y]![x]!;
      dots[cy * g.cols + cx] = bits;
      line += String.fromCharCode(0x2800 + bits);
    }
    lines.push(line);
  }
  const colors = opts.mode === "colour" ? cellColors(rgb, palette, color, g.cols * g.rows) : null;
  return { cols: g.cols, rows: g.rows, lines, colors, ink, paper, dots };
}

/**
 * Draws text art as a page: paper everywhere (fully opaque, since text has
 * no transparency), characters on top. Space below the last full row is
 * paper. With `rasterize`, characters are drawn by the host in a real font
 * at the exact cell size; otherwise the built-in pixel font is scaled up.
 */
export function renderTextArt(art: TextArt, width: number, height: number, rasterize?: GlyphRasterizer): PixelBuffer {
  const out = createBuffer(width, height);
  const dst = out.data;
  const cellW = width / art.cols;
  const cellH = cellW / CHAR_ASPECT;
  // Real-font masks are made at the whole-pixel size of a cell and sampled by position within it.
  const maskW = Math.max(1, Math.ceil(cellW));
  const maskH = Math.max(1, Math.ceil(cellH));
  const masks = new Map<string, { mask: Uint8Array; w: number; h: number }>();
  const maskFor = (ch: string) => {
    let m = masks.get(ch);
    if (!m) {
      const real = rasterize?.(ch, maskW, maskH);
      m = real && real.length === maskW * maskH ? { mask: real, w: maskW, h: maskH } : { mask: glyph(ch) as Glyph, w: CELL_W, h: CELL_H };
      masks.set(ch, m);
    }
    return m;
  };
  const glyphs = art.dots ? null : art.lines.map((line) => [...line].map(maskFor));
  for (let y = 0; y < height; y++) {
    const cy = Math.floor(y / cellH);
    const fy = y / cellH - cy;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      let rgb = art.paper;
      if (cy < art.rows) {
        const cx = Math.min(art.cols - 1, Math.floor(x / cellW));
        const fx = x / cellW - cx;
        let ink = false;
        if (art.dots) {
          // Round dots centred in a 2×4 grid, about 70% of the pitch across.
          const dx = fx * 2;
          const dy = fy * 4;
          const col = Math.min(1, Math.floor(dx));
          const row = Math.min(3, Math.floor(dy));
          if (art.dots[cy * art.cols + cx]! & BRAILLE_BIT[row]![col]!) {
            const ux = (dx - col - 0.5) * (cellW / 2);
            const uy = (dy - row - 0.5) * (cellH / 4);
            const r = 0.36 * Math.min(cellW / 2, cellH / 4);
            ink = ux * ux + uy * uy <= r * r || r < 1; // tiny cells: fill the whole dot square
          }
        } else {
          const { mask, w: mw, h: mh } = glyphs![cy]![cx]!;
          ink = mask[Math.min(mh - 1, Math.floor(fy * mh)) * mw + Math.min(mw - 1, Math.floor(fx * mw))] === 1;
        }
        if (ink) rgb = art.colors ? art.colors[cy * art.cols + cx]! : art.ink;
      }
      dst[i] = rgb[0];
      dst[i + 1] = rgb[1];
      dst[i + 2] = rgb[2];
      dst[i + 3] = 255;
    }
  }
  return out;
}

export function toPlainText(art: TextArt): string {
  return art.lines.map((l) => l.replace(/\s+$/u, "")).join("\n") + "\n";
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** A standalone HTML page with the art in a <pre>, coloured runs merged into spans. */
export function toHtml(art: TextArt, title = "Text art"): string {
  const rows = art.lines.map((line, cy) => {
    if (!art.colors) return escapeHtml(line);
    let html = "";
    let run = "";
    let runColor = "";
    [...line].forEach((ch, cx) => {
      const c = toHex(art.colors![cy * art.cols + cx]!);
      if (c !== runColor && run) {
        html += `<span style="color:${runColor}">${escapeHtml(run)}</span>`;
        run = "";
      }
      runColor = c;
      run += ch;
    });
    if (run) html += `<span style="color:${runColor}">${escapeHtml(run)}</span>`;
    return html;
  });
  return `<!doctype html>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  body { margin: 0; background: ${toHex(art.paper)}; }
  pre { margin: 0; padding: 16px; color: ${toHex(art.ink)}; font: 12px/1 ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace; }
</style>
<pre>${rows.join("\n")}</pre>
`;
}

// ---------------------------------------------------------------------------
// Styles

const COLOUR_MODES = [
  { value: "dark-on-light", label: "Dark on light" },
  { value: "light-on-dark", label: "Light on dark" },
  { value: "colour", label: "Colour" },
] as const;

const num = (v: unknown, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

function asciiOptions(p: Params): AsciiOptions {
  const set = String(p.charset ?? "classic");
  return {
    cols: num(p.columns, 100),
    chars: set === "custom" ? String(p.custom ?? "") : (CHARSETS[set] ?? CHARSETS.classic!).chars,
    match: p.match === "tone" ? "tone" : "shape",
    mode: (COLOUR_MODES.some((m) => m.value === p.colours) ? p.colours : "dark-on-light") as TextColorMode,
  };
}

function brailleOptions(p: Params): BrailleOptions {
  return {
    cols: num(p.columns, 100),
    dither: p.dither === "threshold" ? "threshold" : "diffusion",
    mode: (COLOUR_MODES.some((m) => m.value === p.colours) ? p.colours : "dark-on-light") as TextColorMode,
  };
}

export const ascii: AlgorithmDefinition = {
  id: "ascii",
  name: "ASCII",
  family: "text",
  summary: "Rebuilds the image from characters, picking each one to match the brightness and shape of its patch. Copy or save it as real text.",
  controls: [
    { kind: "slider", id: "columns", label: "Characters across", min: 16, max: 320, step: 1, default: 100 },
    {
      kind: "select",
      id: "charset",
      label: "Characters",
      options: [...Object.entries(CHARSETS).map(([value, s]) => ({ value, label: s.label })), { value: "custom", label: "Custom" }],
      default: "classic",
    },
    {
      kind: "text",
      id: "custom",
      label: "Custom characters",
      help: "Any order; characters the built-in font can't draw are skipped.",
      maxLength: 64,
      visibleWhen: { control: "charset", is: ["custom"] },
      default: " .:oO@",
    },
    {
      kind: "select",
      id: "match",
      label: "Match",
      options: [
        { value: "shape", label: "Shape" },
        { value: "tone", label: "Tone" },
      ],
      default: "shape",
    },
    { kind: "select", id: "colours", label: "Colours", options: COLOUR_MODES, default: "dark-on-light" },
  ],
  run: (input, palette, p, ctx) => renderTextArt(makeAsciiArt(input, palette, ctx.color, asciiOptions(p)), input.width, input.height, ctx.glyphs),
};

export const braille: AlgorithmDefinition = {
  id: "braille",
  name: "Braille",
  family: "text",
  summary: "Each character is a 2×4 grid of Braille dots, dithered dot by dot: four times the detail of ASCII. Copy or save it as real text.",
  controls: [
    { kind: "slider", id: "columns", label: "Characters across", min: 16, max: 320, step: 1, default: 100 },
    {
      kind: "select",
      id: "dither",
      label: "Dots",
      options: [
        { value: "diffusion", label: "Diffused" },
        { value: "threshold", label: "Threshold" },
      ],
      default: "diffusion",
    },
    { kind: "select", id: "colours", label: "Colours", options: COLOUR_MODES, default: "dark-on-light" },
  ],
  // Braille is drawn as dots directly: many monospace fonts have no Braille characters.
  run: (input, palette, p, ctx) => renderTextArt(makeBrailleArt(input, palette, ctx.color, brailleOptions(p)), input.width, input.height),
};

/** The text behind a text-family style, for copying and saving. Null for other styles. */
export function textArtFor(algorithmId: string, input: PixelBuffer, palette: Palette, params: Params, color: ColorSettings): TextArt | null {
  if (algorithmId === "ascii") return makeAsciiArt(input, palette, color, asciiOptions(params));
  if (algorithmId === "braille") return makeBrailleArt(input, palette, color, brailleOptions(params));
  return null;
}
