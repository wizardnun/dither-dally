import { createBuffer } from "./color.ts";
import { createColorModel } from "./colorspace.ts";
import { mulberry32 } from "./random.ts";
import type { AlgorithmDefinition } from "./types.ts";

const num = (v: unknown, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export const streak: AlgorithmDefinition = {
  id: "streak",
  name: "Streak",
  family: "glitch",
  summary:
    "Error is only passed along each row (or column), never between them, so tones smear into long streaks like a dragged video signal.",
  controls: [
    {
      kind: "select",
      id: "direction",
      label: "Direction",
      options: [
        { value: "rows", label: "Rows" },
        { value: "columns", label: "Columns" },
      ],
      default: "rows",
    },
    { kind: "slider", id: "carry", label: "Carry", min: 0, max: 100, step: 1, default: 100, unit: "%" },
    {
      kind: "slider",
      id: "breaks",
      label: "Breaks",
      help: "Chance of dropping the carried error at a pixel, which chops streaks into dashes. Follows the seed.",
      min: 0,
      max: 50,
      step: 1,
      default: 0,
      unit: "%",
    },
  ],
  run: (input, palette, p, ctx) => {
    const { width: w, height: h, data: src } = input;
    const columns = p.direction === "columns";
    const carry = num(p.carry, 100) / 100;
    const breaks = num(p.breaks, 0) / 100;
    const rand = mulberry32(ctx.seed ^ 0x57ea4);
    const model = createColorModel(palette, ctx.color);
    const pw = model.paletteWorking;
    const out = createBuffer(w, h);
    const dst = out.data;
    const lines = columns ? w : h;
    const len = columns ? h : w;
    for (let line = 0; line < lines; line++) {
      let er = 0;
      let eg = 0;
      let eb = 0;
      for (let k = 0; k < len; k++) {
        const x = columns ? line : k;
        const y = columns ? k : line;
        const i = (y * w + x) * 4;
        if (breaks > 0 && rand() < breaks) er = eg = eb = 0;
        const r = model.toWorking(src[i]!) + er;
        const g = model.toWorking(src[i + 1]!) + eg;
        const b = model.toWorking(src[i + 2]!) + eb;
        const idx = model.nearest(r, g, b);
        const c = palette[idx]!;
        dst[i] = c[0];
        dst[i + 1] = c[1];
        dst[i + 2] = c[2];
        dst[i + 3] = src[i + 3]!;
        er = (r - pw[idx * 3]!) * carry;
        eg = (g - pw[idx * 3 + 1]!) * carry;
        eb = (b - pw[idx * 3 + 2]!) * carry;
      }
    }
    return out;
  },
};

export const slip: AlgorithmDefinition = {
  id: "slip",
  name: "Slip",
  family: "glitch",
  summary:
    "Floyd–Steinberg where random bands of rows hand their error down with a sideways jolt, tearing the dither texture. Follows the seed.",
  controls: [
    { kind: "slider", id: "band", label: "Band height", min: 1, max: 48, step: 1, default: 6, unit: "px" },
    { kind: "slider", id: "distance", label: "Slip distance", min: 1, max: 64, step: 1, default: 12, unit: "px" },
    { kind: "slider", id: "density", label: "Density", min: 0, max: 100, step: 1, default: 30, unit: "%" },
  ],
  run: (input, palette, p, ctx) => {
    const { width: w, height: h, data: src } = input;
    const band = Math.max(1, Math.round(num(p.band, 6)));
    const distance = Math.round(num(p.distance, 12));
    const density = num(p.density, 30) / 100;
    const rand = mulberry32(ctx.seed ^ 0x511b);
    // Each band boundary either passes error straight down or slips it sideways.
    const slipAt = new Int32Array(h);
    for (let y0 = 0; y0 < h; y0 += band) {
      const s = rand() < density ? Math.round((rand() * 2 - 1) * distance) : 0;
      for (let y = y0; y < Math.min(h, y0 + band); y++) slipAt[y] = s;
    }
    const model = createColorModel(palette, ctx.color);
    const pw = model.paletteWorking;
    const buf = new Float32Array(w * h * 3);
    for (let i = 0, j = 0; i < src.length; i += 4, j += 3) {
      buf[j] = model.toWorking(src[i]!);
      buf[j + 1] = model.toWorking(src[i + 1]!);
      buf[j + 2] = model.toWorking(src[i + 2]!);
    }
    const out = createBuffer(w, h);
    const dst = out.data;
    const push = (x: number, y: number, er: number, eg: number, eb: number, wgt: number) => {
      if (y >= h) return;
      const xx = (((x + (y === 0 ? 0 : slipAt[y]! - slipAt[y - 1]!)) % w) + w) % w; // wrap around
      const k = (y * w + xx) * 3;
      buf[k] = buf[k]! + er * wgt;
      buf[k + 1] = buf[k + 1]! + eg * wgt;
      buf[k + 2] = buf[k + 2]! + eb * wgt;
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const j = (y * w + x) * 3;
        const r = buf[j]!;
        const g = buf[j + 1]!;
        const b = buf[j + 2]!;
        const idx = model.nearest(r, g, b);
        const c = palette[idx]!;
        const o = (y * w + x) * 4;
        dst[o] = c[0];
        dst[o + 1] = c[1];
        dst[o + 2] = c[2];
        dst[o + 3] = src[o + 3]!;
        const er = (r - pw[idx * 3]!) / 16;
        const eg = (g - pw[idx * 3 + 1]!) / 16;
        const eb = (b - pw[idx * 3 + 2]!) / 16;
        if (x + 1 < w) {
          const k = j + 3;
          buf[k] = buf[k]! + er * 7;
          buf[k + 1] = buf[k + 1]! + eg * 7;
          buf[k + 2] = buf[k + 2]! + eb * 7;
        }
        // Error for the next row lands slipped by that row's offset relative to this one.
        if (x > 0) push(x - 1, y + 1, er, eg, eb, 3);
        push(x, y + 1, er, eg, eb, 5);
        if (x + 1 < w) push(x + 1, y + 1, er, eg, eb, 1);
      }
    }
    return out;
  },
};

export const ripple: AlgorithmDefinition = {
  id: "ripple",
  name: "Ripple",
  family: "glitch",
  summary:
    "Error runs along each row like Streak, but how far it carries rises and falls down the image, so smeared and crisp bands alternate like a rolling TV picture.",
  controls: [
    {
      kind: "select",
      id: "direction",
      label: "Direction",
      options: [
        { value: "rows", label: "Rows" },
        { value: "columns", label: "Columns" },
      ],
      default: "rows",
    },
    { kind: "slider", id: "period", label: "Band size", min: 4, max: 200, step: 1, default: 32, unit: "px" },
    { kind: "slider", id: "depth", label: "Depth", help: "How much the carry drops in the crisp bands.", min: 0, max: 100, step: 1, default: 80, unit: "%" },
    {
      kind: "slider",
      id: "bleed",
      label: "Bleed",
      help: "Share of the error handed to the next row instead, so bands drip into each other.",
      min: 0,
      max: 100,
      step: 1,
      default: 0,
      unit: "%",
    },
  ],
  run: (input, palette, p, ctx) => {
    const { width: w, height: h, data: src } = input;
    const columns = p.direction === "columns";
    const period = Math.max(1, num(p.period, 32));
    const depth = num(p.depth, 80) / 100;
    const bleed = num(p.bleed, 0) / 100;
    const model = createColorModel(palette, ctx.color);
    const pw = model.paletteWorking;
    const out = createBuffer(w, h);
    const dst = out.data;
    const lines = columns ? w : h;
    const len = columns ? h : w;
    // Error waiting for each position of the next line.
    let down = new Float32Array(len * 3);
    let next = new Float32Array(len * 3);
    for (let line = 0; line < lines; line++) {
      const carry = 1 - depth * (0.5 - 0.5 * Math.cos((2 * Math.PI * line) / period));
      let er = 0;
      let eg = 0;
      let eb = 0;
      next.fill(0);
      for (let k = 0; k < len; k++) {
        const x = columns ? line : k;
        const y = columns ? k : line;
        const i = (y * w + x) * 4;
        const r = model.toWorking(src[i]!) + er + down[k * 3]!;
        const g = model.toWorking(src[i + 1]!) + eg + down[k * 3 + 1]!;
        const b = model.toWorking(src[i + 2]!) + eb + down[k * 3 + 2]!;
        const idx = model.nearest(r, g, b);
        const c = palette[idx]!;
        dst[i] = c[0];
        dst[i + 1] = c[1];
        dst[i + 2] = c[2];
        dst[i + 3] = src[i + 3]!;
        const dr = (r - pw[idx * 3]!) * carry;
        const dg = (g - pw[idx * 3 + 1]!) * carry;
        const db = (b - pw[idx * 3 + 2]!) * carry;
        er = dr * (1 - bleed);
        eg = dg * (1 - bleed);
        eb = db * (1 - bleed);
        next[k * 3] = dr * bleed;
        next[k * 3 + 1] = dg * bleed;
        next[k * 3 + 2] = db * bleed;
      }
      [down, next] = [next, down];
    }
    return out;
  },
};
