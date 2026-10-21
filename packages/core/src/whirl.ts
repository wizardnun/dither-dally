import { createBuffer } from "./color.ts";
import { createColorModel } from "./colorspace.ts";
import { cached } from "./field.ts";
import type { AlgorithmDefinition } from "./types.ts";

const num = (v: unknown, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const orderCache = new Map<string, Uint32Array>();
const WEIGHTS = [7, 3, 5, 1];

/**
 * Pixels in the order an Archimedean spiral (one pixel between turns) meets
 * them, walking out from the centre: sorted by radius + angle / 2π.
 */
function spiralOrder(w: number, h: number, cx: number, cy: number): Uint32Array {
  return cached(orderCache, `${w}:${h}:${cx}:${cy}`, () => {
    const key = new Float64Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const a = Math.atan2(dy, dx);
        key[y * w + x] = Math.hypot(dx, dy) + (a < 0 ? a + 2 * Math.PI : a) / (2 * Math.PI);
      }
    }
    const order = new Uint32Array(w * h);
    for (let i = 0; i < order.length; i++) order[i] = i;
    return order.sort((a, b) => key[a]! - key[b]!);
  });
}

export const whirl: AlgorithmDefinition = {
  id: "whirl",
  name: "Whirl",
  family: "error-diffusion",
  summary:
    "Diffuses error along a spiral out from a centre point instead of along rows, so the grain circles the centre; twist bends it into a whirlpool.",
  controls: [
    {
      kind: "slider",
      id: "twist",
      label: "Twist",
      help: "Skews the error passed to the next ring sideways, turning circular grain into spiral arms. Negative turns the other way.",
      min: -100,
      max: 100,
      step: 5,
      default: 60,
      unit: "%",
    },
    { kind: "slider", id: "cx", label: "Centre across", min: 0, max: 100, step: 1, default: 50, unit: "%" },
    { kind: "slider", id: "cy", label: "Centre down", min: 0, max: 100, step: 1, default: 50, unit: "%" },
    { kind: "slider", id: "strength", label: "Error strength", min: 0, max: 200, step: 5, default: 100, unit: "%" },
  ],
  run: (input, palette, p, ctx) => {
    const { width: w, height: h, data: src } = input;
    const cx = (num(p.cx, 50) / 100) * w;
    const cy = (num(p.cy, 50) / 100) * h;
    // At full twist the outward error lands 1.5 px sideways, whatever the radius.
    const skew = (num(p.twist, 60) / 100) * 1.5;
    const scale = num(p.strength, 100) / 100;
    const order = spiralOrder(w, h, cx, cy);
    const model = createColorModel(palette, ctx.color);
    const pw = model.paletteWorking;
    const buf = new Float32Array(w * h * 3);
    for (let i = 0, j = 0; i < src.length; i += 4, j += 3) {
      buf[j] = model.toWorking(src[i]!);
      buf[j + 1] = model.toWorking(src[i + 1]!);
      buf[j + 2] = model.toWorking(src[i + 2]!);
    }
    const done = new Uint8Array(w * h);
    const targets = new Int32Array(4);
    const out = createBuffer(w, h);
    const dst = out.data;
    const at = (r: number, a: number) => {
      const x = Math.floor(cx + r * Math.cos(a));
      const y = Math.floor(cy + r * Math.sin(a));
      return x < 0 || y < 0 || x >= w || y >= h ? -1 : y * w + x;
    };
    for (let n = 0; n < order.length; n++) {
      const pix = order[n]!;
      done[pix] = 1;
      const j = pix * 3;
      const r = buf[j]!;
      const g = buf[j + 1]!;
      const b = buf[j + 2]!;
      const idx = model.nearest(r, g, b);
      const c = palette[idx]!;
      const o = pix * 4;
      dst[o] = c[0];
      dst[o + 1] = c[1];
      dst[o + 2] = c[2];
      dst[o + 3] = src[o + 3]!;
      const er = r - pw[idx * 3]!;
      const eg = g - pw[idx * 3 + 1]!;
      const eb = b - pw[idx * 3 + 2]!;
      // Floyd–Steinberg weights in polar terms: 7 to the next pixel round the ring,
      // 3 / 5 / 1 to the ring outside (behind, level, ahead), shifted by the twist.
      // Targets already passed get nothing and the rest share their weight, so no error is lost.
      const dx = (pix % w) + 0.5 - cx;
      const dy = Math.floor(pix / w) + 0.5 - cy;
      const a = Math.atan2(dy, dx);
      const rad = Math.max(0.5, Math.hypot(dx, dy));
      const out1 = rad + 1;
      const step = 1 / out1;
      const twist = skew / out1;
      targets[0] = at(rad, a + 1 / rad);
      targets[1] = at(out1, a + twist - step);
      targets[2] = at(out1, a + twist);
      targets[3] = at(out1, a + twist + step);
      let total = 0;
      for (let t = 0; t < 4; t++) {
        const q = targets[t]!;
        if (q < 0 || done[q]) targets[t] = -1;
        else total += WEIGHTS[t]!;
      }
      if (total === 0) continue;
      const k0 = scale / total;
      for (let t = 0; t < 4; t++) {
        const q = targets[t]!;
        if (q < 0) continue;
        const k = q * 3;
        const wt = WEIGHTS[t]! * k0;
        buf[k] = buf[k]! + er * wt;
        buf[k + 1] = buf[k + 1]! + eg * wt;
        buf[k + 2] = buf[k + 2]! + eb * wt;
      }
    }
    return out;
  },
};
