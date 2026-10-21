import { createBuffer, parseHex } from "./color.ts";
import { mulberry32 } from "./random.ts";
import type { EffectCategory, EffectDefinition, Params, PixelBuffer } from "./types.ts";

// ---------------------------------------------------------------------------
// Helpers

const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);
const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Applies `fn` to every pixel's RGB, keeping alpha. */
function mapPixels(input: PixelBuffer, fn: (r: number, g: number, b: number, x: number, y: number) => [number, number, number]): PixelBuffer {
  const { width: w, height: h, data: src } = input;
  const out = createBuffer(w, h);
  const dst = out.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const [r, g, b] = fn(src[i]!, src[i + 1]!, src[i + 2]!, x, y);
      dst[i] = r;
      dst[i + 1] = g;
      dst[i + 2] = b;
      dst[i + 3] = src[i + 3]!;
    }
  }
  return out;
}

/** RGB of every pixel as floats, 3 per pixel. */
function toFloat(input: PixelBuffer): Float32Array {
  const n = input.width * input.height;
  const f = new Float32Array(n * 3);
  for (let p = 0; p < n; p++) {
    f[p * 3] = input.data[p * 4]!;
    f[p * 3 + 1] = input.data[p * 4 + 1]!;
    f[p * 3 + 2] = input.data[p * 4 + 2]!;
  }
  return f;
}

function fromFloat(f: Float32Array, like: PixelBuffer): PixelBuffer {
  const out = createBuffer(like.width, like.height);
  const n = like.width * like.height;
  for (let p = 0; p < n; p++) {
    out.data[p * 4] = clamp(f[p * 3]!);
    out.data[p * 4 + 1] = clamp(f[p * 3 + 1]!);
    out.data[p * 4 + 2] = clamp(f[p * 3 + 2]!);
    out.data[p * 4 + 3] = like.data[p * 4 + 3]!;
  }
  return out;
}

/**
 * Gaussian blur of a 3-channel float image, approximated by three box blurs
 * whose sizes match the requested sigma (Wells, 1986). Edges are clamped.
 */
export function gaussianBlur(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  if (sigma <= 0) return src.slice();
  const passes = 3;
  const ideal = Math.sqrt((12 * sigma * sigma) / passes + 1);
  let lower = Math.floor(ideal);
  if (lower % 2 === 0) lower--;
  const upper = lower + 2;
  const m = Math.round((12 * sigma * sigma - passes * lower * lower - 4 * passes * lower - 3 * passes) / (-4 * lower - 4));
  let a = src.slice();
  let b = new Float32Array(a.length);
  for (let i = 0; i < passes; i++) {
    const r = ((i < m ? lower : upper) - 1) / 2;
    boxBlur(a, b, w, h, r, true);
    boxBlur(b, a, w, h, r, false);
  }
  return a;
  function boxBlur(from: Float32Array, to: Float32Array, w: number, h: number, r: number, horizontal: boolean) {
    const len = horizontal ? w : h;
    const lines = horizontal ? h : w;
    const step = horizontal ? 3 : w * 3;
    const norm = 1 / (2 * r + 1);
    for (let line = 0; line < lines; line++) {
      const base = horizontal ? line * w * 3 : line * 3;
      for (let c = 0; c < 3; c++) {
        const at = (k: number) => from[base + Math.min(len - 1, Math.max(0, k)) * step + c]!;
        let sum = 0;
        for (let k = -r; k <= r; k++) sum += at(k);
        for (let k = 0; k < len; k++) {
          to[base + k * step + c] = sum * norm;
          sum += at(k + r + 1) - at(k - r);
        }
      }
    }
  }
}

const num = (p: Params, id: string, fallback: number) => {
  const v = Number(p[id]);
  return Number.isFinite(v) ? v : fallback;
};

// ---------------------------------------------------------------------------
// Adjust

/** Luminance-preserving hue rotation matrix (as used by SVG's feColorMatrix hueRotate). */
function hueMatrix(deg: number): number[] {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [
    0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
    0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.14, 0.072 - c * 0.072 - s * 0.283,
    0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072,
  ];
}

export const adjust: EffectDefinition = {
  id: "adjust",
  name: "Adjust",
  category: "adjust",
  summary: "Brightness, contrast, midtones, saturation and hue: shape the image before it's dithered.",
  controls: [
    { kind: "slider", id: "brightness", label: "Brightness", min: -100, max: 100, step: 1, default: 0 },
    { kind: "slider", id: "contrast", label: "Contrast", min: -100, max: 100, step: 1, default: 0 },
    {
      kind: "slider",
      id: "midtones",
      label: "Midtones",
      help: "Lightens or darkens the middle greys while leaving black and white alone.",
      min: -100,
      max: 100,
      step: 1,
      default: 0,
    },
    { kind: "slider", id: "saturation", label: "Saturation", min: -100, max: 100, step: 1, default: 0 },
    { kind: "slider", id: "hue", label: "Hue", min: -180, max: 180, step: 1, default: 0, unit: "°" },
  ],
  run: (input, p) => {
    const brightness = num(p, "brightness", 0) * 1.28;
    // Contrast slope: 0 at −100, 1 at 0, steep at +100.
    const c = num(p, "contrast", 0) / 100;
    const slope = Math.tan(((c + 1) * Math.PI) / 4);
    // Midtones as a gamma curve: +100 lifts mid-grey to ~75%, −100 drops it to ~25%.
    const gamma = Math.pow(2, num(p, "midtones", 0) / 50);
    const sat = 1 + num(p, "saturation", 0) / 100;
    const hue = num(p, "hue", 0);
    const m = hue ? hueMatrix(hue) : null;
    const lut = new Float32Array(256);
    for (let v = 0; v < 256; v++) {
      let t = clamp((v - 128) * slope + 128 + brightness) / 255;
      t = Math.pow(t, 1 / gamma);
      lut[v] = t * 255;
    }
    return mapPixels(input, (r, g, b) => {
      if (m) [r, g, b] = [m[0]! * r + m[1]! * g + m[2]! * b, m[3]! * r + m[4]! * g + m[5]! * b, m[6]! * r + m[7]! * g + m[8]! * b];
      if (sat !== 1) {
        const l = luma(r, g, b);
        r = l + (r - l) * sat;
        g = l + (g - l) * sat;
        b = l + (b - l) * sat;
      }
      return [lut[clamp(Math.round(r))]!, lut[clamp(Math.round(g))]!, lut[clamp(Math.round(b))]!];
    });
  },
};

export const blur: EffectDefinition = {
  id: "blur",
  name: "Blur",
  category: "adjust",
  summary: "Softens the image. Before the dither it smooths away noise and fine detail; after it, it melts the pattern.",
  controls: [{ kind: "slider", id: "radius", label: "Radius", min: 0, max: 20, step: 0.5, default: 2, unit: "px" }],
  run: (input, p) => fromFloat(gaussianBlur(toFloat(input), input.width, input.height, num(p, "radius", 2)), input),
};

export const sharpen: EffectDefinition = {
  id: "sharpen",
  name: "Sharpen",
  category: "adjust",
  summary: "Crisps up edges (unsharp mask), so detail survives the dither better.",
  controls: [
    { kind: "slider", id: "amount", label: "Amount", min: 0, max: 300, step: 5, default: 80, unit: "%" },
    { kind: "slider", id: "radius", label: "Radius", min: 0.5, max: 8, step: 0.5, default: 1.5, unit: "px" },
  ],
  run: (input, p) => {
    const f = toFloat(input);
    const soft = gaussianBlur(f, input.width, input.height, num(p, "radius", 1.5));
    const k = num(p, "amount", 80) / 100;
    for (let i = 0; i < f.length; i++) f[i] = f[i]! + k * (f[i]! - soft[i]!);
    return fromFloat(f, input);
  },
};

export const invert: EffectDefinition = {
  id: "invert",
  name: "Invert",
  category: "adjust",
  summary: "Swaps light and dark, like a photographic negative.",
  controls: [],
  run: (input) => mapPixels(input, (r, g, b) => [255 - r, 255 - g, 255 - b]),
};

export const grain: EffectDefinition = {
  id: "grain",
  name: "Grain",
  category: "adjust",
  summary: "Adds film-like noise. Before the dither it breaks up flat areas and banding. Change the seed for different grain.",
  controls: [
    { kind: "slider", id: "amount", label: "Amount", min: 0, max: 100, step: 1, default: 20, unit: "%" },
    { kind: "toggle", id: "colour", label: "Colour noise", default: false },
  ],
  run: (input, p, ctx) => {
    const rand = mulberry32(ctx.seed ^ 0x5eed);
    const amount = (num(p, "amount", 20) / 100) * 128;
    const colour = Boolean(p.colour);
    // Sum of uniforms: a cheap, bell-shaped noise in [-1, 1].
    const noise = () => (rand() + rand() + rand() - 1.5) / 1.5;
    return mapPixels(input, (r, g, b) => {
      if (colour) return [clamp(r + noise() * amount), clamp(g + noise() * amount), clamp(b + noise() * amount)];
      const n = noise() * amount;
      return [clamp(r + n), clamp(g + n), clamp(b + n)];
    });
  },
};

// ---------------------------------------------------------------------------
// Light & colour

/** W3C Compositing blend modes, per channel, on values in 0–1. */
const BLEND: Record<string, (b: number, s: number) => number> = {
  multiply: (b, s) => b * s,
  screen: (b, s) => b + s - b * s,
  overlay: (b, s) => (b <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s)),
  "soft-light": (b, s) =>
    s <= 0.5 ? b - (1 - 2 * s) * b * (1 - b) : b + (2 * s - 1) * ((b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b)) - b),
  darken: (b, s) => Math.min(b, s),
  lighten: (b, s) => Math.max(b, s),
  difference: (b, s) => Math.abs(b - s),
};

export const tint: EffectDefinition = {
  id: "tint",
  name: "Tint",
  category: "light",
  summary: "Washes the image with a colour. After a 1-bit dither, Multiply or Screen turns black and white into a duotone.",
  controls: [
    { kind: "color", id: "color", label: "Colour", default: "#ff5a36" },
    {
      kind: "select",
      id: "mode",
      label: "Blend",
      options: [
        { value: "multiply", label: "Multiply" },
        { value: "screen", label: "Screen" },
        { value: "overlay", label: "Overlay" },
        { value: "soft-light", label: "Soft light" },
        { value: "darken", label: "Darken" },
        { value: "lighten", label: "Lighten" },
        { value: "difference", label: "Difference" },
        { value: "color", label: "Colour" },
      ],
      default: "multiply",
    },
    { kind: "slider", id: "opacity", label: "Opacity", min: 0, max: 100, step: 1, default: 100, unit: "%" },
  ],
  run: (input, p) => {
    let tc: [number, number, number];
    try {
      tc = [...parseHex(String(p.color ?? "#ff5a36"))] as [number, number, number];
    } catch {
      tc = [255, 90, 54];
    }
    const [sr, sg, sb] = tc.map((v) => v / 255) as [number, number, number];
    const mode = String(p.mode ?? "multiply");
    const a = num(p, "opacity", 100) / 100;
    if (mode === "color") {
      // Keep each pixel's luminance, take the tint's hue and chroma.
      const tl = luma(sr, sg, sb);
      return mapPixels(input, (r, g, b) => {
        const l = luma(r, g, b) / 255;
        const blended = [sr, sg, sb].map((s) => s - tl + l);
        // Bring out-of-gamut results back toward grey at the same luminance.
        const lo = Math.min(...blended);
        const hi = Math.max(...blended);
        const k = Math.min(1, lo < 0 ? l / (l - lo) : 1, hi > 1 ? (1 - l) / (hi - l) : 1);
        const out = blended.map((v) => l + (v - l) * k);
        return [r * (1 - a) + out[0]! * 255 * a, g * (1 - a) + out[1]! * 255 * a, b * (1 - a) + out[2]! * 255 * a];
      });
    }
    const f = BLEND[mode] ?? BLEND.multiply!;
    return mapPixels(input, (r, g, b) => [
      r * (1 - a) + f(r / 255, sr) * 255 * a,
      g * (1 - a) + f(g / 255, sg) * 255 * a,
      b * (1 - a) + f(b / 255, sb) * 255 * a,
    ]);
  },
};

export const bloom: EffectDefinition = {
  id: "bloom",
  name: "Bloom",
  category: "light",
  summary: "Bright areas spill a soft glow onto their surroundings, like light on a screen or film.",
  controls: [
    { kind: "slider", id: "threshold", label: "Threshold", min: 0, max: 254, step: 1, default: 170 },
    { kind: "slider", id: "radius", label: "Radius", min: 1, max: 40, step: 1, default: 8, unit: "px" },
    { kind: "slider", id: "intensity", label: "Intensity", min: 0, max: 300, step: 5, default: 100, unit: "%" },
  ],
  run: (input, p) => {
    const { width: w, height: h } = input;
    const f = toFloat(input);
    const t = num(p, "threshold", 170);
    const bright = new Float32Array(f.length);
    for (let i = 0; i < f.length; i += 3) {
      const l = luma(f[i]!, f[i + 1]!, f[i + 2]!);
      const k = l > t ? (l - t) / (255 - t) : 0;
      bright[i] = f[i]! * k;
      bright[i + 1] = f[i + 1]! * k;
      bright[i + 2] = f[i + 2]! * k;
    }
    const glow = gaussianBlur(bright, w, h, num(p, "radius", 8));
    const k = num(p, "intensity", 100) / 100;
    // Screen the glow over the image so it brightens without blowing straight to white.
    for (let i = 0; i < f.length; i++) {
      const base = f[i]! / 255;
      const g = Math.min(1, (glow[i]! * k) / 255);
      f[i] = (base + g - base * g) * 255;
    }
    return fromFloat(f, input);
  },
};

export const vignette: EffectDefinition = {
  id: "vignette",
  name: "Vignette",
  category: "light",
  summary: "Darkens the edges and corners to pull the eye to the centre.",
  controls: [
    { kind: "slider", id: "amount", label: "Amount", min: 0, max: 100, step: 1, default: 50, unit: "%" },
    { kind: "slider", id: "size", label: "Size", min: 0, max: 100, step: 1, default: 40, unit: "%" },
    { kind: "slider", id: "softness", label: "Softness", min: 1, max: 100, step: 1, default: 60, unit: "%" },
  ],
  run: (input, p) => {
    const { width: w, height: h } = input;
    const amount = num(p, "amount", 50) / 100;
    const inner = num(p, "size", 40) / 100;
    const soft = Math.max(0.01, num(p, "softness", 60) / 100);
    return mapPixels(input, (r, g, b, x, y) => {
      // Elliptical distance: 0 at the centre, 1 at the corners.
      const dx = ((x + 0.5) / w - 0.5) * 2;
      const dy = ((y + 0.5) / h - 0.5) * 2;
      const d = Math.hypot(dx, dy) / Math.SQRT2;
      const t = Math.min(1, Math.max(0, (d - inner) / soft));
      const k = 1 - amount * t * t * (3 - 2 * t);
      return [r * k, g * k, b * k];
    });
  },
};

/** Orb centres (px), spreads σ (px) for the Glow orbs effect, from its settings and seed. */
export function orbLayout(w: number, h: number, p: Params, seed: number): { x: number; y: number; sigma: number }[] {
  const count = Math.round(num(p, "count", 6));
  const size = num(p, "size", 80);
  const variation = num(p, "variation", 50) / 100;
  const rand = mulberry32(seed ^ 0x0eb5);
  return Array.from({ length: count }, () => ({
    x: rand() * w,
    y: rand() * h,
    sigma: Math.max(0.5, (size / 2) * (1 - variation * rand())),
  }));
}

export const orbs: EffectDefinition = {
  id: "orbs",
  name: "Glow orbs",
  category: "light",
  summary: "Scatters soft round glows over the image. Before a dither they become pools of light the pattern melts into. Change the seed to move them.",
  controls: [
    { kind: "slider", id: "count", label: "Count", min: 1, max: 40, step: 1, default: 6 },
    { kind: "slider", id: "size", label: "Size", min: 10, max: 400, step: 5, default: 80, unit: "px" },
    { kind: "slider", id: "variation", label: "Size variation", min: 0, max: 100, step: 1, default: 50, unit: "%" },
    { kind: "slider", id: "intensity", label: "Intensity", min: 0, max: 200, step: 5, default: 80, unit: "%" },
    { kind: "color", id: "color", label: "Colour", default: "#ffffff" },
  ],
  run: (input, p, ctx) => {
    const layout = orbLayout(input.width, input.height, p, ctx.seed);
    const intensity = num(p, "intensity", 80) / 100;
    const [cr, cg, cb] = parseHex(String(p.color ?? "#ffffff")).map((v) => v / 255) as [number, number, number];
    return mapPixels(input, (r, g, b, x, y) => {
      let glow = 0;
      for (const o of layout) {
        const dx = x + 0.5 - o.x;
        const dy = y + 0.5 - o.y;
        glow += Math.exp(-(dx * dx + dy * dy) / (2 * o.sigma * o.sigma));
      }
      // Screen the orb colour over the image.
      const k = Math.min(1, glow * intensity);
      return [r + (255 - r) * k * cr, g + (255 - g) * k * cg, b + (255 - b) * k * cb];
    });
  },
};

/**
 * Average (or centre) colour of each square cell, 3 floats per cell, row by
 * row. The screen-pixel grid behind Subpixels.
 */
export function cellColours(input: PixelBuffer, cell: number, centre: boolean): { cols: number; rows: number; rgb: Float32Array } {
  const { width: w, height: h, data: src } = input;
  const cols = Math.ceil(w / cell);
  const rows = Math.ceil(h / cell);
  const rgb = new Float32Array(cols * rows * 3);
  if (centre) {
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const x = Math.min(w - 1, Math.floor((i + 0.5) * cell));
        const y = Math.min(h - 1, Math.floor((j + 0.5) * cell));
        const o = (y * w + x) * 4;
        rgb.set([src[o]!, src[o + 1]!, src[o + 2]!], (j * cols + i) * 3);
      }
    }
    return { cols, rows, rgb };
  }
  const n = new Float32Array(cols * rows);
  for (let y = 0; y < h; y++) {
    const row = Math.floor(y / cell) * cols;
    for (let x = 0; x < w; x++) {
      const k = row + Math.floor(x / cell);
      const o = (y * w + x) * 4;
      rgb[k * 3] = rgb[k * 3]! + src[o]!;
      rgb[k * 3 + 1] = rgb[k * 3 + 1]! + src[o + 1]!;
      rgb[k * 3 + 2] = rgb[k * 3 + 2]! + src[o + 2]!;
      n[k] = n[k]! + 1;
    }
  }
  for (let k = 0; k < n.length; k++) for (let c = 0; c < 3; c++) rgb[k * 3 + c] = rgb[k * 3 + c]! / n[k]!;
  return { cols, rows, rgb };
}

/**
 * Subpixels' settings in the units its passes use, shared with the GPU:
 * cell size, the capsule's half width and height and corner radius (px),
 * bar gain, both blur sigmas, glow, haze and its tint (0–1).
 */
export function subpixelSettings(p: Params) {
  const cell = Math.max(2, Math.round(num(p, "cell", 12)));
  const stripes = p.layout !== "led";
  const gap = num(p, "gap", 25) / 100;
  const bx = 0.5 * (1 - gap) * (stripes ? cell / 3 : cell * 0.6);
  const by = 0.5 * (1 - gap) * cell;
  return {
    cell,
    stripes,
    centre: p.sample === "centre",
    bx,
    by,
    radius: Math.min(bx, by),
    gain: num(p, "brightness", 260) / 100,
    focus: (num(p, "focus", 40) / 100) * cell * 0.3,
    glowSigma: cell * 0.8,
    glow: num(p, "glow", 45) / 100,
    haze: num(p, "haze", 75) / 100,
    tint: parseHex(String(p.tint ?? "#6a5cff")).map((v) => v / 255) as [number, number, number],
  };
}

/** Share of a channel's light past full brightness that spills into the other two. */
export const SPILL = 0.7;

/** Inside-ness of a rounded box (half size bx × by, corner r) at offset (dx, dy) px: 1 inside, 0 outside, a 1 px soft edge. */
function capsule(dx: number, dy: number, bx: number, by: number, r: number): number {
  const qx = Math.abs(dx) - (bx - r);
  const qy = Math.abs(dy) - (by - r);
  const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  return Math.min(1, Math.max(0, 0.5 - d));
}

export const subpixels: EffectDefinition = {
  id: "subpixels",
  name: "Subpixels",
  category: "light",
  summary:
    "Rebuilds the picture from glowing red, green and blue screen subpixels, soft and hazy, as if your nose were pressed against a monitor.",
  controls: [
    { kind: "slider", id: "cell", label: "Pixel size", help: "Size of one screen pixel.", min: 4, max: 64, step: 1, default: 12, unit: "px" },
    {
      kind: "select",
      id: "layout",
      label: "Layout",
      options: [
        { value: "stripes", label: "RGB stripes" },
        { value: "led", label: "LED" },
      ],
      default: "stripes",
    },
    {
      kind: "select",
      id: "sample",
      label: "Colour from",
      help: "Centre keeps a dither underneath crisp: each screen pixel is fully on or off.",
      options: [
        { value: "average", label: "Average" },
        { value: "centre", label: "Centre" },
      ],
      default: "average",
    },
    { kind: "slider", id: "gap", label: "Gap", min: 0, max: 60, step: 1, default: 25, unit: "%" },
    { kind: "slider", id: "focus", label: "Defocus", min: 0, max: 100, step: 1, default: 40, unit: "%" },
    { kind: "slider", id: "brightness", label: "Brightness", min: 50, max: 400, step: 5, default: 260, unit: "%" },
    { kind: "slider", id: "glow", label: "Glow", min: 0, max: 200, step: 5, default: 45, unit: "%" },
    { kind: "slider", id: "haze", label: "Haze", help: "How much the glow takes on the tint colour.", min: 0, max: 100, step: 1, default: 75, unit: "%" },
    { kind: "color", id: "tint", label: "Haze colour", default: "#6a5cff" },
  ],
  run: (input, p) => {
    const { width: w, height: h } = input;
    const s = subpixelSettings(p);
    const cells = cellColours(input, s.cell, s.centre);
    // 1. Bars: each subpixel lit by its channel of the cell colour.
    const bars = new Float32Array(w * h * 3);
    for (let y = 0; y < h; y++) {
      const j = Math.floor(y / s.cell);
      const dy = y + 0.5 - (j + 0.5) * s.cell;
      for (let x = 0; x < w; x++) {
        const i = Math.floor(x / s.cell);
        const k = (j * cells.cols + i) * 3;
        const o = (y * w + x) * 3;
        if (s.stripes) {
          const u = x + 0.5 - i * s.cell;
          const c = Math.min(2, Math.floor((u * 3) / s.cell));
          const m = capsule(u - ((c + 0.5) * s.cell) / 3, dy, s.bx, s.by, s.radius);
          bars[o + c] = cells.rgb[k + c]! * m * s.gain;
        } else {
          const m = capsule(x + 0.5 - (i + 0.5) * s.cell, dy, s.bx, s.by, s.radius) * s.gain;
          bars[o] = cells.rgb[k]! * m;
          bars[o + 1] = cells.rgb[k + 1]! * m;
          bars[o + 2] = cells.rgb[k + 2]! * m;
        }
      }
    }
    // 2. Defocus, 3. a wide glow from that.
    const soft = gaussianBlur(bars, w, h, s.focus);
    const glow = gaussianBlur(soft, w, h, s.glowSigma);
    // 4. Glow tinted toward the haze colour by its own brightness, then light past
    //    full brightness in one channel spills into the others (overexposed bars go pastel).
    const out = new Float32Array(w * h * 3);
    for (let q = 0; q < w * h; q++) {
      const o = q * 3;
      const gl = luma(glow[o]!, glow[o + 1]!, glow[o + 2]!);
      let spill = 0;
      const v = [0, 0, 0];
      for (let c = 0; c < 3; c++) {
        const g = glow[o + c]! + (gl * s.tint[c]! * 2 - glow[o + c]!) * s.haze;
        v[c] = soft[o + c]! + g * s.glow;
        spill += Math.max(0, v[c]! - 255);
      }
      for (let c = 0; c < 3; c++) out[o + c] = v[c]! + spill * SPILL;
    }
    return fromFloat(out, input);
  },
};

// ---------------------------------------------------------------------------
// Glitch

export const chromaticSplit: EffectDefinition = {
  id: "chromatic-split",
  name: "Chromatic split",
  category: "glitch",
  summary: "Pulls the red and blue channels apart in opposite directions, like a misaligned print or cheap lens.",
  controls: [
    { kind: "slider", id: "distance", label: "Distance", min: 0, max: 24, step: 1, default: 3, unit: "px" },
    { kind: "slider", id: "angle", label: "Angle", min: 0, max: 359, step: 1, default: 0, unit: "°" },
  ],
  run: (input, p) => {
    const { width: w, height: h, data: src } = input;
    const d = num(p, "distance", 3);
    const a = (num(p, "angle", 0) * Math.PI) / 180;
    const ox = Math.round(Math.cos(a) * d);
    const oy = Math.round(Math.sin(a) * d);
    const at = (x: number, y: number, c: number) => {
      const xx = Math.min(w - 1, Math.max(0, x));
      const yy = Math.min(h - 1, Math.max(0, y));
      return src[(yy * w + xx) * 4 + c]!;
    };
    return mapPixels(input, (_r, g, _b, x, y) => [at(x - ox, y - oy, 0), g, at(x + ox, y + oy, 2)]);
  },
};

export const scanlines: EffectDefinition = {
  id: "scanlines",
  name: "Scanlines",
  category: "glitch",
  summary: "Dark horizontal lines across the image, like an old CRT monitor.",
  controls: [
    { kind: "slider", id: "spacing", label: "Spacing", min: 2, max: 16, step: 1, default: 3, unit: "px" },
    { kind: "slider", id: "thickness", label: "Thickness", min: 1, max: 8, step: 1, default: 1, unit: "px" },
    { kind: "slider", id: "darkness", label: "Darkness", min: 0, max: 100, step: 1, default: 45, unit: "%" },
  ],
  run: (input, p) => {
    const spacing = num(p, "spacing", 3);
    const thick = Math.min(spacing - 1, num(p, "thickness", 1));
    const k = 1 - num(p, "darkness", 45) / 100;
    return mapPixels(input, (r, g, b, _x, y) => (y % spacing < thick ? [r * k, g * k, b * k] : [r, g, b]));
  },
};

export const rowShift: EffectDefinition = {
  id: "row-shift",
  name: "Row shift",
  category: "glitch",
  summary: "Slides random bands of rows sideways, like a corrupted video signal. Change the seed for a different glitch.",
  controls: [
    { kind: "slider", id: "distance", label: "Distance", min: 0, max: 200, step: 1, default: 24, unit: "px" },
    { kind: "slider", id: "density", label: "Density", min: 0, max: 100, step: 1, default: 15, unit: "%" },
    { kind: "slider", id: "band", label: "Band height", min: 1, max: 64, step: 1, default: 6, unit: "px" },
  ],
  run: (input, p, ctx) => {
    const { width: w, height: h, data: src } = input;
    const rand = mulberry32(ctx.seed ^ 0x9117c4);
    const dist = num(p, "distance", 24);
    const density = num(p, "density", 15) / 100;
    const band = Math.max(1, num(p, "band", 6));
    const shift = new Int32Array(h);
    for (let y0 = 0; y0 < h; y0 += band) {
      const s = rand() < density ? Math.round((rand() * 2 - 1) * dist) : 0;
      for (let y = y0; y < Math.min(h, y0 + band); y++) shift[y] = s;
    }
    return mapPixels(input, (r, g, b, x, y) => {
      const s = shift[y]!;
      if (!s) return [r, g, b];
      const sx = (((x - s) % w) + w) % w; // wrap around
      const i = (y * w + sx) * 4;
      return [src[i]!, src[i + 1]!, src[i + 2]!];
    });
  },
};

export const EFFECTS: readonly EffectDefinition[] = [
  adjust,
  blur,
  sharpen,
  invert,
  grain,
  tint,
  bloom,
  vignette,
  orbs,
  subpixels,
  chromaticSplit,
  scanlines,
  rowShift,
];

export const EFFECT_CATEGORY_LABELS: Record<EffectCategory, string> = {
  adjust: "Adjust",
  light: "Light & colour",
  glitch: "Glitch",
};

export function getEffect(id: string): EffectDefinition {
  const e = EFFECTS.find((x) => x.id === id);
  if (!e) throw new Error(`Unknown effect "${id}"`);
  return e;
}
