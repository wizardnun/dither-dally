import { createBuffer } from "./color.ts";
import { createColorModel } from "./colorspace.ts";
import { gaussianBlur } from "./effects.ts"; // used by blurPlane
import { cached, darkest, equalize, fieldDither, lightest } from "./field.ts";
import type { AlgorithmDefinition, Params, PixelBuffer } from "./types.ts";

/**
 * Rank for a line screen: 0 on a line's centre, 1 midway between lines. Because
 * the distance across a line is uniform, the share of pixels below any rank
 * equals that rank, so ink coverage tracks tone.
 */
const lineRank = (phase: number) => Math.min(0.999999, Math.abs(phase - Math.floor(phase) - 0.5) * 2);

const num = (v: unknown, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export const waveLines: AlgorithmDefinition = {
  id: "wave-lines",
  name: "Wave lines",
  family: "lines",
  summary: "Parallel lines that swell where the image is dark and thin where it's light, rippling as they go.",
  controls: [
    { kind: "slider", id: "spacing", label: "Line spacing", min: 3, max: 40, step: 1, default: 6, unit: "px" },
    { kind: "slider", id: "angle", label: "Angle", min: 0, max: 179, step: 1, default: 0, unit: "°" },
    { kind: "slider", id: "amplitude", label: "Wave height", min: 0, max: 60, step: 1, default: 4, unit: "px" },
    { kind: "slider", id: "wavelength", label: "Wave length", min: 8, max: 400, step: 2, default: 80, unit: "px" },
  ],
  run: (input, palette, p, ctx) => {
    const spacing = num(p.spacing, 6);
    const a = (num(p.angle, 0) * Math.PI) / 180;
    const amp = num(p.amplitude, 4);
    const k = (2 * Math.PI) / num(p.wavelength, 80);
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    return fieldDither(input, palette, ctx.color, (x, y) => {
      const along = (x + 0.5) * cos + (y + 0.5) * sin;
      const across = -(x + 0.5) * sin + (y + 0.5) * cos;
      return lineRank((across + amp * Math.sin(along * k)) / spacing);
    });
  },
};

export const rings: AlgorithmDefinition = {
  id: "rings",
  name: "Rings",
  family: "lines",
  summary: "Concentric circles radiating from a point you choose, thick in the shadows and fine in the highlights.",
  controls: [
    { kind: "slider", id: "spacing", label: "Ring spacing", min: 3, max: 40, step: 1, default: 6, unit: "px" },
    { kind: "slider", id: "cx", label: "Centre across", min: 0, max: 100, step: 1, default: 50, unit: "%" },
    { kind: "slider", id: "cy", label: "Centre down", min: 0, max: 100, step: 1, default: 50, unit: "%" },
  ],
  run: (input, palette, p, ctx) => {
    const spacing = num(p.spacing, 6);
    const cx = (num(p.cx, 50) / 100) * input.width;
    const cy = (num(p.cy, 50) / 100) * input.height;
    return fieldDither(input, palette, ctx.color, (x, y) => lineRank(Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / spacing));
  },
};

export const spiral: AlgorithmDefinition = {
  id: "spiral",
  name: "Spiral",
  family: "lines",
  summary: "One or more spiral arms winding out from the centre, like a record groove.",
  controls: [
    { kind: "slider", id: "spacing", label: "Groove spacing", min: 3, max: 40, step: 1, default: 6, unit: "px" },
    { kind: "slider", id: "arms", label: "Arms", min: 1, max: 12, step: 1, default: 1 },
    { kind: "select", id: "turn", label: "Direction", options: [{ value: "cw", label: "Clockwise" }, { value: "ccw", label: "Anticlockwise" }], default: "cw" },
  ],
  run: (input, palette, p, ctx) => {
    const spacing = num(p.spacing, 6);
    const arms = Math.round(num(p.arms, 1));
    const dir = p.turn === "ccw" ? -1 : 1;
    const cx = input.width / 2;
    const cy = input.height / 2;
    return fieldDither(input, palette, ctx.color, (x, y) => {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      // Integer arm counts keep the pattern continuous across the ±π seam.
      return lineRank(Math.hypot(dx, dy) / spacing + (dir * arms * Math.atan2(dy, dx)) / (2 * Math.PI));
    });
  },
};

export const moire: AlgorithmDefinition = {
  id: "moire",
  name: "Moiré",
  family: "lines",
  summary: "Two slightly mismatched line gratings laid over each other, so they beat into large rippling interference bands.",
  controls: [
    { kind: "slider", id: "spacing", label: "Line spacing", min: 3, max: 40, step: 1, default: 8, unit: "px" },
    {
      kind: "slider",
      id: "ratio",
      label: "Mismatch",
      help: "How much wider the second grating's lines are. Small differences give big, slow bands.",
      min: 0,
      max: 50,
      step: 1,
      default: 8,
      unit: "%",
    },
    { kind: "slider", id: "angle", label: "Angle", min: 0, max: 179, step: 1, default: 30, unit: "°" },
    { kind: "slider", id: "twist", label: "Twist", help: "Angle between the two gratings.", min: 0, max: 90, step: 1, default: 5, unit: "°" },
  ],
  run: (input, palette, p, ctx) => {
    const rank = moireRanks(input.width, input.height, p);
    return fieldDither(input, palette, ctx.color, (x, y) => rank[y * input.width + x]!);
  },
};

const moireCache = new Map<string, Float32Array>();

/** Moiré's rank per pixel. It doesn't depend on the image, so it is cached and shared with the GPU. */
export function moireRanks(w: number, h: number, p: Params): Float32Array {
  const spacing = num(p.spacing, 8);
  const ratio = num(p.ratio, 8);
  const angle = num(p.angle, 30);
  const twist = num(p.twist, 5);
  return cached(moireCache, `${w}:${h}:${spacing}:${ratio}:${angle}:${twist}`, () => {
    const k1 = (2 * Math.PI) / spacing;
    const k2 = k1 / (1 + ratio / 100);
    const a1 = (angle * Math.PI) / 180;
    const a2 = a1 + (twist * Math.PI) / 180;
    const [c1, s1, c2, s2] = [Math.cos(a1), Math.sin(a1), Math.cos(a2), Math.sin(a2)];
    const field = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const u = x + 0.5;
        const v = y + 0.5;
        field[y * w + x] = Math.cos((-u * s1 + v * c1) * k1) + Math.cos((-u * s2 + v * c2) * k2);
      }
    }
    // A sum of waves bunches up around zero; even ranks keep coverage matched to tone.
    return equalize(field);
  });
}

/** Rec. 709 luma per pixel, 0–255. */
function lumaPlane(input: PixelBuffer): Float32Array {
  const n = input.width * input.height;
  const out = new Float32Array(n);
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    out[p] = 0.2126 * input.data[i]! + 0.7152 * input.data[i + 1]! + 0.0722 * input.data[i + 2]!;
  }
  return out;
}

/** Blurs a single-channel plane by packing it into the 3-channel Gaussian blur. */
function blurPlane(plane: Float32Array, w: number, h: number, sigma: number): Float32Array {
  const packed = new Float32Array(plane.length * 3);
  for (let i = 0; i < plane.length; i++) packed[i * 3] = plane[i]!;
  const blurred = gaussianBlur(packed, w, h, sigma);
  const out = new Float32Array(plane.length);
  for (let i = 0; i < plane.length; i++) out[i] = blurred[i * 3]!;
  return out;
}

export const engraving: AlgorithmDefinition = {
  id: "engraving",
  name: "Engraving",
  family: "lines",
  summary:
    "Parallel lines pushed sideways by the brightness underneath, so they bend around the shapes in the picture, like an engraved banknote portrait.",
  controls: [
    { kind: "slider", id: "spacing", label: "Line spacing", min: 3, max: 24, step: 1, default: 5, unit: "px" },
    { kind: "slider", id: "angle", label: "Angle", min: 0, max: 179, step: 1, default: 45, unit: "°" },
    {
      kind: "slider",
      id: "bend",
      label: "Bend",
      help: "How far lines are pushed by the picture. 0 gives a plain line screen.",
      min: 0,
      max: 100,
      step: 1,
      default: 40,
      unit: "%",
    },
    {
      kind: "slider",
      id: "smoothness",
      label: "Smoothness",
      help: "Blurs the picture before it bends the lines, for calmer curves.",
      min: 0,
      max: 30,
      step: 0.5,
      default: 6,
      unit: "px",
    },
  ],
  run: (input, palette, p, ctx) => {
    const { width: w, height: h } = input;
    const spacing = num(p.spacing, 5);
    const a = (num(p.angle, 45) * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    // Full bend moves a line by up to 6 line spacings between black and white.
    const push = (num(p.bend, 40) / 100) * 6 * spacing;
    const smooth = num(p.smoothness, 6);
    const lum = push > 0 ? blurPlane(lumaPlane(input), w, h, smooth) : null;
    // The line position is a continuous function of position and brightness, so
    // lines bend smoothly and never break up, however curved the picture.
    return fieldDither(input, palette, ctx.color, (x, y) => {
      const across = -(x + 0.5) * sin + (y + 0.5) * cos;
      const shift = lum ? (lum[y * w + x]! / 255) * push : 0;
      return lineRank((across + shift) / spacing);
    });
  },
};

export const contours: AlgorithmDefinition = {
  id: "contours",
  name: "Contours",
  family: "pattern",
  summary: "Turns brightness into elevation and draws it as a topographic map: a line wherever the image crosses a level.",
  controls: [
    { kind: "slider", id: "levels", label: "Levels", min: 2, max: 32, step: 1, default: 10 },
    { kind: "slider", id: "width", label: "Line width", min: 1, max: 4, step: 1, default: 1, unit: "px" },
    { kind: "slider", id: "smoothing", label: "Smoothing", min: 0, max: 12, step: 0.5, default: 2, unit: "px" },
    { kind: "toggle", id: "fill", label: "Fill with colour", help: "Fill between lines with the nearest palette colour instead of the lightest one.", default: false },
  ],
  run: (input, palette, p, ctx) => {
    const { width: w, height: h, data: src } = input;
    const levels = Math.max(2, Math.round(num(p.levels, 10)));
    const lw = Math.max(1, Math.round(num(p.width, 1)));
    const lum = blurPlane(lumaPlane(input), w, h, num(p.smoothing, 2));
    const band = new Int32Array(w * h);
    for (let i = 0; i < band.length; i++) band[i] = Math.min(levels - 1, Math.floor((lum[i]! / 256) * levels));
    const ink = darkest(palette);
    const paper = lightest(palette);
    const model = createColorModel(palette, { space: "srgb", metric: ctx.color.metric });
    const out = createBuffer(w, h);
    const dst = out.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p0 = y * w + x;
        const b = band[p0]!;
        // A pixel is on a contour if a neighbour within the line width is in a higher band
        // (checking one side only keeps lines a consistent width).
        let line = false;
        for (let d = 1; d <= lw && !line; d++) {
          if (x + d < w && band[p0 + d]! > b) line = true;
          else if (y + d < h && band[p0 + d * w]! > b) line = true;
          else if (x - d >= 0 && band[p0 - d]! > b) line = true;
          else if (y - d >= 0 && band[p0 - d * w]! > b) line = true;
        }
        const i = p0 * 4;
        const c = line ? ink : p.fill ? palette[model.nearest(src[i]!, src[i + 1]!, src[i + 2]!)]! : paper;
        dst[i] = c[0];
        dst[i + 1] = c[1];
        dst[i + 2] = c[2];
        dst[i + 3] = src[i + 3]!;
      }
    }
    return out;
  },
};

export const edges: AlgorithmDefinition = {
  id: "edges",
  name: "Edges",
  family: "pattern",
  summary: "Draws only the outlines: a line wherever brightness changes sharply, like a pen sketch or a wireframe.",
  controls: [
    { kind: "slider", id: "sensitivity", label: "Sensitivity", min: 0, max: 100, step: 1, default: 70, unit: "%" },
    { kind: "slider", id: "smoothing", label: "Smoothing", help: "Blurs the picture first so fine texture and noise don't draw.", min: 0, max: 12, step: 0.5, default: 1, unit: "px" },
    { kind: "toggle", id: "fill", label: "Fill with colour", help: "Fill between lines with the nearest palette colour instead of the lightest one.", default: false },
    { kind: "toggle", id: "invert", label: "Light lines on dark", default: false },
  ],
  run: (input, palette, p, ctx) => {
    const { width: w, height: h, data: src } = input;
    const lum = blurPlane(lumaPlane(input), w, h, num(p.smoothing, 1));
    // Sobel magnitude of a full black-to-white step is 4 × 255; lines draw above a share of that.
    const cut = ((100 - num(p.sensitivity, 70)) / 100) * 0.5 * 4 * 255;
    const cut2 = cut * cut;
    const invert = Boolean(p.invert);
    const ink = invert ? lightest(palette) : darkest(palette);
    const paper = invert ? darkest(palette) : lightest(palette);
    const model = createColorModel(palette, { space: "srgb", metric: ctx.color.metric });
    const at = (x: number, y: number) => lum[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))]!;
    const out = createBuffer(w, h);
    const dst = out.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const tl = at(x - 1, y - 1), t = at(x, y - 1), tr = at(x + 1, y - 1);
        const l = at(x - 1, y), r = at(x + 1, y);
        const bl = at(x - 1, y + 1), b = at(x, y + 1), br = at(x + 1, y + 1);
        const gx = tr + 2 * r + br - tl - 2 * l - bl;
        const gy = bl + 2 * b + br - tl - 2 * t - tr;
        const i = (y * w + x) * 4;
        const line = gx * gx + gy * gy > cut2;
        const c = line ? ink : p.fill ? palette[model.nearest(src[i]!, src[i + 1]!, src[i + 2]!)]! : paper;
        dst[i] = c[0];
        dst[i + 1] = c[1];
        dst[i + 2] = c[2];
        dst[i + 3] = src[i + 3]!;
      }
    }
    return out;
  },
};

/**
 * The brightest spots: up to `count` peaks of blurred brightness, at least
 * `separation` px apart, brightest first. Searched on a copy shrunk so the
 * separation is ~8 px, which keeps it cheap at any size. Pixel coordinates.
 */
export function brightPeaks(input: PixelBuffer, count: number, separation: number): { x: number; y: number }[] {
  const { width: w, height: h, data: src } = input;
  const f = Math.max(1, Math.floor(separation / 8));
  const sw = Math.ceil(w / f);
  const sh = Math.ceil(h / f);
  const small = new Float32Array(sw * sh);
  const n = new Float32Array(sw * sh);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const k = Math.floor(y / f) * sw + Math.floor(x / f);
      small[k] = small[k]! + 0.2126 * src[i]! + 0.7152 * src[i + 1]! + 0.0722 * src[i + 2]!;
      n[k] = n[k]! + 1;
    }
  }
  for (let k = 0; k < small.length; k++) small[k] = small[k]! / n[k]!;
  const lum = blurPlane(small, sw, sh, separation / f / 4);
  // Local maxima of the shrunk image, then the brightest ones kept greedily, far enough apart.
  const candidates: { x: number; y: number; v: number }[] = [];
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const v = lum[y * sw + x]!;
      let peak = true;
      for (let dy = -1; dy <= 1 && peak; dy++)
        for (let dx = -1; dx <= 1 && peak; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if ((dx || dy) && xx >= 0 && yy >= 0 && xx < sw && yy < sh && lum[yy * sw + xx]! > v) peak = false;
        }
      if (peak) candidates.push({ x: (x + 0.5) * f, y: (y + 0.5) * f, v });
    }
  }
  candidates.sort((a, b) => b.v - a.v || a.y - b.y || a.x - b.x);
  const peaks: { x: number; y: number }[] = [];
  for (const c of candidates) {
    if (peaks.length >= count) break;
    if (peaks.every((q) => Math.hypot(q.x - c.x, q.y - c.y) >= separation)) peaks.push({ x: c.x, y: c.y });
  }
  return peaks;
}

export const echoes: AlgorithmDefinition = {
  id: "echoes",
  name: "Echoes",
  family: "lines",
  summary: "Rings spread out from the brightest spots in the picture like ripples on a pond, meeting where they collide.",
  controls: [
    { kind: "slider", id: "spacing", label: "Ring spacing", min: 3, max: 40, step: 1, default: 6, unit: "px" },
    { kind: "slider", id: "count", label: "Sources", min: 1, max: 32, step: 1, default: 6 },
    {
      kind: "slider",
      id: "separation",
      label: "Separation",
      help: "Minimum distance between ring centres.",
      min: 10,
      max: 400,
      step: 5,
      default: 60,
      unit: "px",
    },
  ],
  run: (input, palette, p, ctx) => {
    const spacing = num(p.spacing, 6);
    const peaks = brightPeaks(input, Math.round(num(p.count, 6)), num(p.separation, 60));
    return fieldDither(input, palette, ctx.color, (x, y) => {
      let d = Infinity;
      for (const q of peaks) d = Math.min(d, Math.hypot(x + 0.5 - q.x, y + 0.5 - q.y));
      return lineRank(d / spacing);
    });
  },
};
