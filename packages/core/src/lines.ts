import { createBuffer } from "./color.ts";
import { createColorModel } from "./colorspace.ts";
import { gaussianBlur } from "./effects.ts"; // used by blurPlane
import { darkest, fieldDither, lightest } from "./field.ts";
import type { AlgorithmDefinition, PixelBuffer } from "./types.ts";

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
