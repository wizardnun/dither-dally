import {
  SPILL,
  brightPeaks,
  cellColours,
  curveFactor,
  darkest,
  layerSeed,
  lightest,
  orbLayout,
  parseHex,
  moireRanks,
  mulberry32,
  paletteSpread,
  stippleRanks,
  subpixelSettings,
  thresholdTile,
  type Layer,
  type LayerAccelerator,
  type Palette,
  type Params,
  type PipelineSettings,
  type PixelBuffer,
} from "@dither-dally/core";

/**
 * Runs the layers whose pixels are independent on the GPU with WebGPU:
 *
 * - threshold styles (Bayer and blue noise, curved or not, white noise,
 *   Halftone, Wave lines, Rings, Spiral, Crosshatch, Checker, Echoes from
 *   peaks found on the CPU, and Moiré and Stipple from their cached rank
 *   fields): each pixel's rank, then its nearest palette colour, in one
 *   compute pass;
 * - Edges: brightness, the same three-box blur, then a Sobel pass;
 * - Blur, Sharpen and Bloom: the same three-box Gaussian as the CPU;
 * - Glow orbs: the orbs laid out on the CPU, summed per pixel;
 * - Subpixels: cell colours from the CPU, then bars, the same blurs and a
 *   final glow-and-spill pass.
 *
 * Everything else, and OKLab matching, stays on the CPU (the accelerator
 * returns null). The CPU code in core is the reference: results match it
 * apart from floating-point ties and ±1 rounding in effects (see gpu-check).
 */

/** Buffer usage and map flags from the WebGPU spec (the DOM typings here lack the constant objects). */
const USAGE = { MAP_READ: 0x0001, COPY_SRC: 0x0004, COPY_DST: 0x0008, STORAGE: 0x0080 } as const;
const MAP_READ = 0x0001;
const COMPUTE = 0x4; // GPUShaderStage.COMPUTE
const WG = 16;

/** Threshold styles and the shader mode that computes their rank. */
const MODES: Record<string, number> = {
  bayer: 0,
  "blue-noise": 0,
  "white-noise": 1,
  halftone: 2,
  "wave-lines": 3,
  rings: 4,
  spiral: 5,
  crosshatch: 6,
  checker: 7,
  echoes: 8,
  // Rank fields that don't depend on the image: core caches them and the GPU reads them per pixel.
  moire: 1,
  stipple: 1,
};
const SHAPES = ["round", "diamond", "square", "line"];
const HATCH_ANGLES = [45, -45, 0, 90];

const FIELD = /* wgsl */ `
@group(0) @binding(0) var<storage, read> src: array<u32>;
@group(0) @binding(1) var<storage, read> ranks: array<f32>;
@group(0) @binding(2) var<storage, read> palette: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> dst: array<u32>;
@group(0) @binding(4) var<storage, read> ints: array<u32>;  // width, height, colours, mode, tile, shape, layers
@group(0) @binding(5) var<storage, read> nums: array<f32>;  // spread, then per-mode values

const PI = 3.141592653589793;

fn lineRank(phase: f32) -> f32 { return min(0.999999, abs(phase - floor(phase) - 0.5) * 2.0); }

fn circleCoverage(r: f32) -> f32 {
  if (r <= 0.5) { return PI * r * r; }
  if (r >= 0.7071067811865476) { return 1.0; }
  let cap = r * r * acos(0.5 / r) - 0.5 * sqrt(r * r - 0.25);
  return PI * r * r - 4.0 * cap;
}

fn spotRank(shape: u32, u: f32, v: f32) -> f32 {
  switch shape {
    case 0u: { return circleCoverage(sqrt(u * u + v * v)); }
    case 1u: {
      let d = abs(u) + abs(v);
      if (d <= 0.5) { return 2.0 * d * d; }
      return 1.0 - 2.0 * (1.0 - d) * (1.0 - d);
    }
    case 2u: { let m = max(abs(u), abs(v)); return 4.0 * m * m; }
    default: { return 2.0 * abs(v); }
  }
}

fn rankAt(x: u32, y: u32, i: u32) -> f32 {
  let px = f32(x) + 0.5;
  let py = f32(y) + 0.5;
  switch ints[3] {
    case 0u: {
      let n = ints[4];
      let k = nums[1];
      if (k == 0.0) { return ranks[(y % n) * n + (x % n)]; }
      // CRT bulge: read the tile further out toward the edges.
      let d = vec2<f32>(px - nums[2], py - nums[3]);
      let t = floor(vec2<f32>(nums[2], nums[3]) + d * (1.0 + k * dot(d, d)));
      let ni = i32(n);
      let tx = u32(((i32(t.x) % ni) + ni) % ni);
      let ty = u32(((i32(t.y) % ni) + ni) % ni);
      return ranks[ty * n + tx];
    }
    case 1u: { return ranks[i]; }
    case 2u: {
      let cell = nums[1]; let c = nums[2]; let s = nums[3];
      let a = (px * c + py * s) / cell;
      let b = (-px * s + py * c) / cell;
      return min(0.999999, spotRank(ints[5], a - floor(a) - 0.5, b - floor(b) - 0.5));
    }
    case 3u: {
      let spacing = nums[1]; let c = nums[2]; let s = nums[3]; let amp = nums[4]; let k = nums[5];
      let along = px * c + py * s;
      let across = -px * s + py * c;
      return lineRank((across + amp * sin(along * k)) / spacing);
    }
    case 4u: {
      let dx = px - nums[2]; let dy = py - nums[3];
      return lineRank(sqrt(dx * dx + dy * dy) / nums[1]);
    }
    case 5u: {
      let dx = px - nums[2]; let dy = py - nums[3];
      return lineRank(sqrt(dx * dx + dy * dy) / nums[1] + nums[4] * atan2(dy, dx) / (2.0 * PI));
    }
    case 8u: {
      var d = 3.4e38;
      for (var k = 0u; k < ints[6]; k++) {
        let dx = px - nums[2u + 2u * k]; let dy = py - nums[3u + 2u * k];
        d = min(d, sqrt(dx * dx + dy * dy));
      }
      return lineRank(d / nums[1]);
    }
    case 7u: {
      let size = u32(nums[1]);
      return select(0.25, 0.75, ((x / size + y / size) & 1u) == 1u);
    }
    default: {
      let spacing = nums[1];
      let layers = ints[6];
      var rank = 0.999999;
      for (var k = 0u; k < layers; k++) {
        let d = (px * nums[2u + 2u * k] + py * nums[3u + 2u * k]) / spacing;
        let dist = abs(d - floor(d) - 0.5) * 2.0;
        if (dist < 0.45) { rank = min(rank, (f32(k) + dist / 0.45) / f32(layers)); }
      }
      return rank;
    }
  }
}

@compute @workgroup_size(${WG}, ${WG})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let w = ints[0];
  if (id.x >= w || id.y >= ints[1]) { return; }
  let i = id.y * w + id.x;
  let px = src[i];
  let t = (rankAt(id.x, id.y, i) - 0.5) * nums[0];
  let q = vec3<f32>(f32(px & 255u), f32((px >> 8u) & 255u), f32((px >> 16u) & 255u)) + vec3<f32>(t);
  var best = 0u;
  var bestDist = 3.4e38;
  for (var k = 0u; k < ints[2]; k++) {
    let d = q - palette[k].xyz;
    let dist = d.x * d.x + d.y * d.y + d.z * d.z;
    if (dist < bestDist) { bestDist = dist; best = k; }
  }
  let c = palette[best];
  dst[i] = u32(c.x) | (u32(c.y) << 8u) | (u32(c.z) << 16u) | (px & 0xff000000u);
}`;

/** Effects: unpack to floats, box-blur passes, and the final combine. Uniform values live in a small storage buffer. */
const EFFECTS = /* wgsl */ `
@group(0) @binding(0) var<storage, read> src: array<u32>;
@group(0) @binding(1) var<storage, read> a: array<f32>;
@group(0) @binding(2) var<storage, read_write> b: array<f32>;
@group(0) @binding(3) var<storage, read_write> dst: array<u32>;
@group(0) @binding(4) var<storage, read> ints: array<u32>;  // width, height, radius, horizontal, mode
@group(0) @binding(5) var<storage, read> nums: array<f32>;  // per-mode values

fn channel(px: u32, c: u32) -> f32 { return f32((px >> (8u * c)) & 255u); }
fn luma(r: f32, g: f32, bl: f32) -> f32 { return 0.2126 * r + 0.7152 * g + 0.0722 * bl; }
fn byte(v: f32) -> u32 { return u32(round(clamp(v, 0.0, 255.0))); }

// Into floats: RGB as is, for bloom (mode 2) only what's brighter than the threshold,
// for edges (mode 3) brightness in the first channel.
@compute @workgroup_size(${WG}, ${WG})
fn unpack(@builtin(global_invocation_id) id: vec3<u32>) {
  let w = ints[0];
  if (id.x >= w || id.y >= ints[1]) { return; }
  let i = id.y * w + id.x;
  let px = src[i];
  let r = channel(px, 0u); let g = channel(px, 1u); let bl = channel(px, 2u);
  var k = 1.0;
  if (ints[4] == 2u) {
    let t = nums[0];
    let l = luma(r, g, bl);
    k = select(0.0, (l - t) / (255.0 - t), l > t);
  }
  if (ints[4] == 3u) {
    b[i * 3u] = luma(r, g, bl); b[i * 3u + 1u] = 0.0; b[i * 3u + 2u] = 0.0;
    return;
  }
  b[i * 3u] = r * k; b[i * 3u + 1u] = g * k; b[i * 3u + 2u] = bl * k;
}

// One box-blur pass along rows or columns, edges clamped.
@compute @workgroup_size(${WG}, ${WG})
fn box(@builtin(global_invocation_id) id: vec3<u32>) {
  let w = ints[0]; let h = ints[1];
  if (id.x >= w || id.y >= h) { return; }
  let r = i32(ints[2]);
  let horizontal = ints[3] == 1u;
  let len = i32(select(h, w, horizontal));
  let pos = i32(select(id.y, id.x, horizontal));
  var sum = vec3<f32>(0.0);
  for (var k = -r; k <= r; k++) {
    let p = u32(clamp(pos + k, 0, len - 1));
    let j = select(p * w + id.x, id.y * w + p, horizontal) * 3u;
    sum += vec3<f32>(a[j], a[j + 1u], a[j + 2u]);
  }
  let o = (id.y * w + id.x) * 3u;
  let v = sum / f32(2 * r + 1);
  b[o] = v.x; b[o + 1u] = v.y; b[o + 2u] = v.z;
}

// Glow orbs: Gaussian glows summed, screened over the source in the orbs' colour.
// ints: width, height, orb count; nums: intensity, colour r g b (0–1), then x, y, 1/(2σ²) per orb.
@compute @workgroup_size(${WG}, ${WG})
fn glow(@builtin(global_invocation_id) id: vec3<u32>) {
  let w = ints[0];
  if (id.x >= w || id.y >= ints[1]) { return; }
  let i = id.y * w + id.x;
  let px = src[i];
  let p = vec2<f32>(f32(id.x) + 0.5, f32(id.y) + 0.5);
  var sum = 0.0;
  for (var k = 0u; k < ints[2]; k++) {
    let d = p - vec2<f32>(nums[4u + 3u * k], nums[5u + 3u * k]);
    sum += exp(-dot(d, d) * nums[6u + 3u * k]);
  }
  let g = min(1.0, sum * nums[0]);
  let f = vec3<f32>(channel(px, 0u), channel(px, 1u), channel(px, 2u));
  let out = f + (vec3<f32>(255.0) - f) * g * vec3<f32>(nums[1], nums[2], nums[3]);
  dst[i] = byte(out.x) | (byte(out.y) << 8u) | (byte(out.z) << 16u) | (px & 0xff000000u);
}

// Subpixels, 1: capsule bars lit by their cell's colour (cell colours in a, 3 per cell), into b.
// ints: width, height, cell columns, stripes; nums: cell, half width, half height, corner radius, gain.
fn capsule(d: vec2<f32>, half: vec2<f32>, r: f32) -> f32 {
  let q = abs(d) - (half - vec2<f32>(r));
  let dist = length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) - r;
  return clamp(0.5 - dist, 0.0, 1.0);
}

@compute @workgroup_size(${WG}, ${WG})
fn bars(@builtin(global_invocation_id) id: vec3<u32>) {
  let w = ints[0];
  if (id.x >= w || id.y >= ints[1]) { return; }
  let cell = nums[0];
  let half = vec2<f32>(nums[1], nums[2]);
  let ci = floor(f32(id.x) / cell);
  let cj = floor(f32(id.y) / cell);
  let k = (u32(cj) * ints[2] + u32(ci)) * 3u;
  let dy = f32(id.y) + 0.5 - (cj + 0.5) * cell;
  let o = (id.y * w + id.x) * 3u;
  var v = vec3<f32>(0.0);
  if (ints[3] == 1u) {
    let u = f32(id.x) + 0.5 - ci * cell;
    let c = min(2u, u32(floor(u * 3.0 / cell)));
    let m = capsule(vec2<f32>(u - (f32(c) + 0.5) * cell / 3.0, dy), half, nums[3]);
    v[c] = a[k + c] * m * nums[4];
  } else {
    let m = capsule(vec2<f32>(f32(id.x) + 0.5 - (ci + 0.5) * cell, dy), half, nums[3]) * nums[4];
    v = vec3<f32>(a[k], a[k + 1u], a[k + 2u]) * m;
  }
  b[o] = v.x; b[o + 1u] = v.y; b[o + 2u] = v.z;
}

// Subpixels, 2: defocused bars in a, their wide glow in b; glow tinted by the haze, overexposure spilt.
// nums: glow, haze, tint r g b (0–1), spill.
@compute @workgroup_size(${WG}, ${WG})
fn screen(@builtin(global_invocation_id) id: vec3<u32>) {
  let w = ints[0];
  if (id.x >= w || id.y >= ints[1]) { return; }
  let i = id.y * w + id.x;
  let o = i * 3u;
  let soft = vec3<f32>(a[o], a[o + 1u], a[o + 2u]);
  let g0 = vec3<f32>(b[o], b[o + 1u], b[o + 2u]);
  let gl = luma(g0.x, g0.y, g0.z);
  let g = g0 + (gl * vec3<f32>(nums[2], nums[3], nums[4]) * 2.0 - g0) * nums[1];
  let v = soft + g * nums[0];
  let over = max(v - vec3<f32>(255.0), vec3<f32>(0.0));
  let out = v + vec3<f32>((over.x + over.y + over.z) * nums[5]);
  dst[i] = byte(out.x) | (byte(out.y) << 8u) | (byte(out.z) << 16u) | (src[i] & 0xff000000u);
}

// Back to bytes: mode 0 blur, 1 sharpen (amount), 2 bloom (intensity, screened over the source).
@compute @workgroup_size(${WG}, ${WG})
fn combine(@builtin(global_invocation_id) id: vec3<u32>) {
  let w = ints[0];
  if (id.x >= w || id.y >= ints[1]) { return; }
  let i = id.y * w + id.x;
  let px = src[i];
  var out = vec3<f32>(a[i * 3u], a[i * 3u + 1u], a[i * 3u + 2u]);
  let f = vec3<f32>(channel(px, 0u), channel(px, 1u), channel(px, 2u));
  if (ints[4] == 1u) {
    out = f + nums[0] * (f - out);
  } else if (ints[4] == 2u) {
    let base = f / 255.0;
    let g = min(vec3<f32>(1.0), out * nums[0] / 255.0);
    out = (base + g - base * g) * 255.0;
  }
  dst[i] = byte(out.x) | (byte(out.y) << 8u) | (byte(out.z) << 16u) | (px & 0xff000000u);
}`;

/** Edges: Sobel on blurred brightness (first channel of `a`), then ink, paper or the nearest palette colour. */
const EDGES = /* wgsl */ `
@group(0) @binding(0) var<storage, read> src: array<u32>;
@group(0) @binding(1) var<storage, read> a: array<f32>;
@group(0) @binding(2) var<storage, read> palette: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> dst: array<u32>;
@group(0) @binding(4) var<storage, read> ints: array<u32>;  // width, height, colours, fill, ink, paper
@group(0) @binding(5) var<storage, read> nums: array<f32>;  // squared cut-off

fn at(x: i32, y: i32) -> f32 {
  let w = i32(ints[0]); let h = i32(ints[1]);
  return a[u32(clamp(y, 0, h - 1) * w + clamp(x, 0, w - 1)) * 3u];
}

@compute @workgroup_size(${WG}, ${WG})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let w = ints[0];
  if (id.x >= w || id.y >= ints[1]) { return; }
  let x = i32(id.x); let y = i32(id.y);
  let gx = at(x + 1, y - 1) + 2.0 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2.0 * at(x - 1, y) - at(x - 1, y + 1);
  let gy = at(x - 1, y + 1) + 2.0 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2.0 * at(x, y - 1) - at(x + 1, y - 1);
  let i = id.y * w + id.x;
  let px = src[i];
  var best = ints[5];
  if (gx * gx + gy * gy > nums[0]) {
    best = ints[4];
  } else if (ints[3] == 1u) {
    let q = vec3<f32>(f32(px & 255u), f32((px >> 8u) & 255u), f32((px >> 16u) & 255u));
    var bestDist = 3.4e38;
    for (var k = 0u; k < ints[2]; k++) {
      let d = q - palette[k].xyz;
      let dist = d.x * d.x + d.y * d.y + d.z * d.z;
      if (dist < bestDist) { bestDist = dist; best = k; }
    }
  }
  let c = palette[best];
  dst[i] = u32(c.x) | (u32(c.y) << 8u) | (u32(c.z) << 16u) | (px & 0xff000000u);
}`;

/** Box radii for the three-box Gaussian, exactly as core's gaussianBlur picks them. */
function boxRadii(sigma: number): number[] {
  const passes = 3;
  const ideal = Math.sqrt((12 * sigma * sigma) / passes + 1);
  let lower = Math.floor(ideal);
  if (lower % 2 === 0) lower--;
  const upper = lower + 2;
  const m = Math.round((12 * sigma * sigma - passes * lower * lower - 4 * passes * lower - 3 * passes) / (-4 * lower - 4));
  return [0, 1, 2].map((i) => ((i < m ? lower : upper) - 1) / 2);
}

const num = (p: Params, id: string, fallback: number) => {
  const v = Number(p[id]);
  return Number.isFinite(v) ? v : fallback;
};

type Pipelines = {
  field: GPUComputePipeline;
  edges: GPUComputePipeline;
  unpack: GPUComputePipeline;
  box: GPUComputePipeline;
  combine: GPUComputePipeline;
  glow: GPUComputePipeline;
  bars: GPUComputePipeline;
  screen: GPUComputePipeline;
};

export class GpuAccelerator {
  private lost = false;

  private constructor(
    private readonly device: GPUDevice,
    private readonly pipelines: Pipelines,
  ) {
    void device.lost.then(() => (this.lost = true));
  }

  /** Null when WebGPU isn't available. */
  static async create(): Promise<GpuAccelerator | null> {
    try {
      const adapter = await navigator.gpu?.requestAdapter();
      if (!adapter) return null;
      // Full-size images need more than the default 128 MB per buffer.
      const device = await adapter.requestDevice({
        requiredLimits: {
          maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
          maxBufferSize: adapter.limits.maxBufferSize,
        },
      });
      // Explicit layouts: with "auto", each entry point would only accept the bindings it happens to use.
      const layout = (writable: number[]) =>
        device.createPipelineLayout({
          bindGroupLayouts: [
            device.createBindGroupLayout({
              entries: [0, 1, 2, 3, 4, 5].map((binding) => ({
                binding,
                visibility: COMPUTE,
                buffer: { type: writable.includes(binding) ? "storage" : "read-only-storage" },
              })),
            }),
          ],
        });
      const fieldLayout = layout([3]);
      const effectsLayout = layout([2, 3]);
      const make = (code: string, entryPoint: string, pipelineLayout: GPUPipelineLayout) =>
        device.createComputePipelineAsync({ layout: pipelineLayout, compute: { module: device.createShaderModule({ code }), entryPoint } });
      const [field, edges, unpack, box, combine, glow, bars, screen] = await Promise.all([
        make(FIELD, "main", fieldLayout),
        make(EDGES, "main", fieldLayout),
        make(EFFECTS, "unpack", effectsLayout),
        make(EFFECTS, "box", effectsLayout),
        make(EFFECTS, "combine", effectsLayout),
        make(EFFECTS, "glow", effectsLayout),
        make(EFFECTS, "bars", effectsLayout),
        make(EFFECTS, "screen", effectsLayout),
      ]);
      return new GpuAccelerator(device, { field, edges, unpack, box, combine, glow, bars, screen });
    } catch {
      return null;
    }
  }

  /** Offers a layer to the GPU: its output, or null for the CPU to run it. */
  accelerate: LayerAccelerator = async (layer, input, s) => {
    if (this.lost || !this.fits(input)) return null;
    return layer.kind === "dither" ? this.dither(layer, input, s) : this.effect(layer, input, s);
  };

  private fits(input: PixelBuffer): boolean {
    // The largest buffer is the float copy for effects: 12 bytes per pixel.
    return input.width * input.height * 12 <= this.device.limits.maxStorageBufferBindingSize;
  }

  private async dither(layer: Extract<Layer, { kind: "dither" }>, input: PixelBuffer, s: PipelineSettings): Promise<PixelBuffer | null> {
    // OKLab matching is non-linear; it stays on the CPU.
    if (s.color.metric !== "srgb" || s.palette.length === 0) return null;
    if (layer.algorithm === "edges") return this.edges(layer.params, input, s.palette);
    const mode = MODES[layer.algorithm];
    if (mode === undefined) return null;
    const p = layer.params;
    const { width: w, height: h } = input;
    const ints = [w, h, s.palette.length, mode, 1, 0, 0];
    const nums = [paletteSpread(s.palette)];
    let ranks: Float32Array = new Float32Array(1);
    switch (layer.algorithm) {
      case "bayer":
      case "blue-noise": {
        const tile = thresholdTile(layer.algorithm, p, s.seed)!;
        ranks = Float32Array.from(tile.ranks);
        ints[4] = tile.size;
        nums.push(curveFactor(p, w, h), w / 2, h / 2);
        break;
      }
      case "white-noise": {
        // The CPU draws one number per pixel from a seeded stream; the GPU reads the same numbers.
        const rand = mulberry32(s.seed);
        ranks = new Float32Array(w * h);
        for (let i = 0; i < ranks.length; i++) ranks[i] = rand();
        break;
      }
      case "halftone": {
        const a = (num(p, "angle", 45) * Math.PI) / 180;
        nums.push(num(p, "cell", 8), Math.cos(a), Math.sin(a));
        ints[5] = Math.max(0, SHAPES.indexOf(String(p.shape ?? "round")));
        break;
      }
      case "wave-lines": {
        const a = (num(p, "angle", 0) * Math.PI) / 180;
        nums.push(num(p, "spacing", 6), Math.cos(a), Math.sin(a), num(p, "amplitude", 4), (2 * Math.PI) / num(p, "wavelength", 80));
        break;
      }
      case "rings":
        nums.push(num(p, "spacing", 6), (num(p, "cx", 50) / 100) * w, (num(p, "cy", 50) / 100) * h);
        break;
      case "spiral":
        nums.push(num(p, "spacing", 6), w / 2, h / 2, (p.turn === "ccw" ? -1 : 1) * Math.round(num(p, "arms", 1)));
        break;
      case "moire":
        ranks = moireRanks(w, h, p);
        break;
      case "stipple":
        ranks = stippleRanks(w, h, p, s.seed);
        break;
      case "echoes": {
        const peaks = brightPeaks(input, Math.round(num(p, "count", 6)), num(p, "separation", 60));
        nums.push(num(p, "spacing", 6), ...peaks.flatMap((q) => [q.x, q.y]));
        ints[6] = peaks.length;
        break;
      }
      case "checker":
        nums.push(Math.max(1, Math.round(num(p, "size", 1))));
        break;
      case "crosshatch": {
        const dirs = HATCH_ANGLES.slice(0, Number(p.layers ?? 4));
        nums.push(Number(p.spacing ?? 6), ...dirs.flatMap((deg) => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)]));
        ints[6] = dirs.length;
        break;
      }
    }
    const pal = new Float32Array(s.palette.length * 4);
    (s.palette as Palette).forEach(([r, g, b], k) => pal.set([r, g, b, 0], k * 4));
    const run = this.session(input);
    const out = run.output();
    run.dispatch(this.pipelines.field, [run.src, run.storage(ranks), run.storage(pal), out, run.storage(new Uint32Array(ints)), run.storage(new Float32Array(nums))]);
    return run.read(out);
  }

  private async edges(p: Params, input: PixelBuffer, palette: Palette): Promise<PixelBuffer> {
    const { width: w, height: h } = input;
    const sigma = num(p, "smoothing", 1);
    const cut = ((100 - num(p, "sensitivity", 70)) / 100) * 0.5 * 4 * 255;
    const invert = Boolean(p.invert);
    const ink = palette.indexOf(invert ? lightest(palette) : darkest(palette));
    const paper = palette.indexOf(invert ? darkest(palette) : lightest(palette));
    const run = this.session(input);
    const floats = w * h * 3 * 4;
    const ping = run.scratch(floats);
    const pong = run.scratch(floats);
    const empty = run.scratch(16);
    const out = run.output();
    const ints = (radius: number, horizontal: number) => run.storage(new Uint32Array([w, h, radius, horizontal, 3]));
    // Brightness into pong, blurred like core's blurPlane (none when smoothing is 0), then Sobel.
    run.dispatch(this.pipelines.unpack, [run.src, empty, pong, out, ints(0, 0), empty]);
    if (sigma > 0) {
      for (const r of boxRadii(sigma)) {
        run.dispatch(this.pipelines.box, [run.src, pong, ping, out, ints(r, 1), empty]);
        run.dispatch(this.pipelines.box, [run.src, ping, pong, out, ints(r, 0), empty]);
      }
    }
    const pal = new Float32Array(palette.length * 4);
    palette.forEach(([r, g, b], k) => pal.set([r, g, b, 0], k * 4));
    const edgeInts = new Uint32Array([w, h, palette.length, p.fill ? 1 : 0, ink, paper]);
    run.dispatch(this.pipelines.edges, [run.src, pong, run.storage(pal), out, run.storage(edgeInts), run.storage(new Float32Array([cut * cut]))]);
    return run.read(out);
  }

  private async effect(layer: Extract<Layer, { kind: "effect" }>, input: PixelBuffer, s: PipelineSettings): Promise<PixelBuffer | null> {
    const p = layer.params;
    if (layer.effect === "orbs") return this.orbs(p, input, layerSeed(layer, s.seed));
    if (layer.effect === "subpixels") return this.subpixels(p, input);
    let mode: number;
    let sigma: number;
    let value = 0;
    let threshold = 0;
    if (layer.effect === "blur") [mode, sigma] = [0, num(p, "radius", 2)];
    else if (layer.effect === "sharpen") [mode, sigma, value] = [1, num(p, "radius", 1.5), num(p, "amount", 80) / 100];
    else if (layer.effect === "bloom") [mode, sigma, value, threshold] = [2, num(p, "radius", 8), num(p, "intensity", 100) / 100, num(p, "threshold", 170)];
    else return null;
    if (!(sigma > 0)) return null; // nothing to blur: the CPU path is a copy anyway
    const { width: w, height: h } = input;
    const run = this.session(input);
    const floats = w * h * 3 * 4;
    const ping = run.scratch(floats);
    const pong = run.scratch(floats);
    const empty = run.scratch(16);
    const out = run.output();
    const ints = (radius: number, horizontal: number) => run.storage(new Uint32Array([w, h, radius, horizontal, mode]));
    // Floats in pong (bright parts only, for bloom); then three box blurs, each across then down.
    run.dispatch(this.pipelines.unpack, [run.src, empty, pong, out, ints(0, 0), run.storage(new Float32Array([threshold]))]);
    for (const r of boxRadii(sigma)) {
      run.dispatch(this.pipelines.box, [run.src, pong, ping, out, ints(r, 1), empty]);
      run.dispatch(this.pipelines.box, [run.src, ping, pong, out, ints(r, 0), empty]);
    }
    run.dispatch(this.pipelines.combine, [run.src, pong, ping, out, ints(0, 0), run.storage(new Float32Array([value]))]);
    return run.read(out);
  }

  private async orbs(p: Params, input: PixelBuffer, seed: number): Promise<PixelBuffer> {
    const { width: w, height: h } = input;
    const layout = orbLayout(w, h, p, seed);
    const colour = parseHex(String(p.color ?? "#ffffff")).map((v) => v / 255);
    const nums = new Float32Array([num(p, "intensity", 80) / 100, ...colour, ...layout.flatMap((o) => [o.x, o.y, 1 / (2 * o.sigma * o.sigma)])]);
    const run = this.session(input);
    const empty = run.scratch(16);
    const out = run.output();
    run.dispatch(this.pipelines.glow, [run.src, empty, run.scratch(16), out, run.storage(new Uint32Array([w, h, layout.length])), run.storage(nums)]);
    return run.read(out);
  }

  private async subpixels(p: Params, input: PixelBuffer): Promise<PixelBuffer> {
    const { width: w, height: h } = input;
    const t = subpixelSettings(p);
    const cells = cellColours(input, t.cell, t.centre);
    const run = this.session(input);
    const floats = w * h * 3 * 4;
    const soft = run.scratch(floats);
    const tmp = run.scratch(floats);
    const glow = run.scratch(floats);
    const empty = run.scratch(16);
    const out = run.output();
    const ints = (radius: number, horizontal: number) => run.storage(new Uint32Array([w, h, radius, horizontal, 0]));
    run.dispatch(this.pipelines.bars, [
      run.src,
      run.storage(cells.rgb),
      soft,
      out,
      run.storage(new Uint32Array([w, h, cells.cols, t.stripes ? 1 : 0])),
      run.storage(new Float32Array([t.cell, t.bx, t.by, t.radius, t.gain])),
    ]);
    // Defocus in place (soft → tmp → soft per radius), then the glow from it into its own buffer.
    if (t.focus > 0) {
      for (const r of boxRadii(t.focus)) {
        run.dispatch(this.pipelines.box, [run.src, soft, tmp, out, ints(r, 1), empty]);
        run.dispatch(this.pipelines.box, [run.src, tmp, soft, out, ints(r, 0), empty]);
      }
    }
    let from = soft;
    for (const r of boxRadii(t.glowSigma)) {
      run.dispatch(this.pipelines.box, [run.src, from, tmp, out, ints(r, 1), empty]);
      run.dispatch(this.pipelines.box, [run.src, tmp, glow, out, ints(r, 0), empty]);
      from = glow;
    }
    run.dispatch(this.pipelines.screen, [run.src, soft, glow, out, ints(0, 0), run.storage(new Float32Array([t.glow, t.haze, ...t.tint, SPILL]))]);
    return run.read(out);
  }

  /** Buffers and passes for one layer; everything is freed once its output is read back. */
  private session(input: PixelBuffer) {
    const { device } = this;
    const { width: w, height: h } = input;
    const bytes = w * h * 4;
    const owned: GPUBuffer[] = [];
    const encoder = device.createCommandEncoder();
    const make = (size: number, usage: number, data?: ArrayBufferView) => {
      const b = device.createBuffer({ size: Math.max(16, Math.ceil(size / 4) * 4), usage, mappedAtCreation: !!data });
      if (data) {
        new Uint8Array(b.getMappedRange()).set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
        b.unmap();
      }
      owned.push(b);
      return b;
    };
    return {
      src: make(bytes, USAGE.STORAGE, input.data),
      storage: (data: ArrayBufferView) => make(data.byteLength, USAGE.STORAGE, data),
      scratch: (size: number) => make(size, USAGE.STORAGE),
      output: () => make(bytes, USAGE.STORAGE | USAGE.COPY_SRC),
      dispatch(pipeline: GPUComputePipeline, buffers: GPUBuffer[]) {
        const bind = device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: buffers.map((buffer, binding) => ({ binding, resource: { buffer } })),
        });
        const pass = encoder.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bind);
        pass.dispatchWorkgroups(Math.ceil(w / WG), Math.ceil(h / WG));
        pass.end();
      },
      async read(out: GPUBuffer): Promise<PixelBuffer> {
        const staging = make(bytes, USAGE.MAP_READ | USAGE.COPY_DST);
        encoder.copyBufferToBuffer(out, 0, staging, 0, bytes);
        device.queue.submit([encoder.finish()]);
        try {
          await staging.mapAsync(MAP_READ);
          const data = new Uint8ClampedArray(staging.getMappedRange().slice(0, bytes));
          staging.unmap();
          return { width: w, height: h, data };
        } finally {
          for (const b of owned) b.destroy();
        }
      },
    };
  }
}
