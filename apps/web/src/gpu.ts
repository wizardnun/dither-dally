import { paletteSpread, type Palette } from "@dither-dally/core";

/**
 * WebGPU prototype: tiled threshold dithering (Bayer, blue noise) with
 * nearest-colour matching in sRGB, one GPU thread per pixel. The CPU version
 * in core stays the reference; see the benchmark notes in docs/DESIGN.md.
 */
const SHADER = /* wgsl */ `
struct Params { width: u32, height: u32, tile: u32, count: u32 };
@group(0) @binding(0) var<storage, read> src: array<u32>;
@group(0) @binding(1) var<storage, read> offsets: array<f32>;
@group(0) @binding(2) var<storage, read> palette: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> dst: array<u32>;
@group(0) @binding(4) var<uniform> p: Params;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= p.width || id.y >= p.height) { return; }
  let i = id.y * p.width + id.x;
  let px = src[i];
  let t = offsets[(id.y % p.tile) * p.tile + (id.x % p.tile)];
  let q = vec3<f32>(f32(px & 255u), f32((px >> 8u) & 255u), f32((px >> 16u) & 255u)) + vec3<f32>(t);
  var best = 0u;
  var bestDist = 3.4e38;
  for (var k = 0u; k < p.count; k++) {
    let d = q - palette[k].xyz;
    let dist = d.x * d.x + d.y * d.y + d.z * d.z;
    if (dist < bestDist) { bestDist = dist; best = k; }
  }
  let c = palette[best];
  dst[i] = u32(c.x) | (u32(c.y) << 8u) | (u32(c.z) << 16u) | (px & 0xff000000u);
}`;

/** Buffer usage and map flags from the WebGPU spec (the DOM typings here lack the constant objects). */
const USAGE = { MAP_READ: 0x0001, COPY_SRC: 0x0004, COPY_DST: 0x0008, UNIFORM: 0x0040, STORAGE: 0x0080 } as const;
const MAP_READ = 0x0001;

export class GpuThreshold {
  private constructor(
    private readonly device: GPUDevice,
    private readonly pipeline: GPUComputePipeline,
  ) {}

  /** Null when WebGPU isn't available. */
  static async create(): Promise<GpuThreshold | null> {
    const adapter = await navigator.gpu?.requestAdapter();
    const device = await adapter?.requestDevice();
    if (!device) return null;
    const module = device.createShaderModule({ code: SHADER });
    const pipeline = await device.createComputePipelineAsync({ layout: "auto", compute: { module, entryPoint: "main" } });
    return new GpuThreshold(device, pipeline);
  }

  /** Same result as fieldDither with the tile's ranks, within float32 rounding. */
  async run(input: { width: number; height: number; data: Uint8ClampedArray }, palette: Palette, tile: { size: number; ranks: Float64Array }) {
    const { device } = this;
    const { width, height } = input;
    const spread = paletteSpread(palette);
    const offsets = Float32Array.from(tile.ranks, (r) => (r - 0.5) * spread);
    const pal = new Float32Array(palette.length * 4);
    palette.forEach(([r, g, b], k) => pal.set([r, g, b, 0], k * 4));
    const bytes = width * height * 4;
    const buffer = (size: number, usage: number, data?: ArrayBufferView) => {
      const b = device.createBuffer({ size: Math.max(16, Math.ceil(size / 4) * 4), usage, mappedAtCreation: !!data });
      if (data) {
        new Uint8Array(b.getMappedRange()).set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
        b.unmap();
      }
      return b;
    };
    const S = USAGE;
    const src = buffer(bytes, S.STORAGE, input.data);
    const off = buffer(offsets.byteLength, S.STORAGE, offsets);
    const palBuf = buffer(pal.byteLength, S.STORAGE, pal);
    const dst = buffer(bytes, S.STORAGE | S.COPY_SRC);
    const params = buffer(16, S.UNIFORM, new Uint32Array([width, height, tile.size, palette.length]));
    const read = buffer(bytes, S.MAP_READ | S.COPY_DST);
    const bind = device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [src, off, palBuf, dst, params].map((b, binding) => ({ binding, resource: { buffer: b } })),
    });
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bind);
    pass.dispatchWorkgroups(Math.ceil(width / 16), Math.ceil(height / 16));
    pass.end();
    enc.copyBufferToBuffer(dst, 0, read, 0, bytes);
    device.queue.submit([enc.finish()]);
    await read.mapAsync(MAP_READ);
    const out = new Uint8ClampedArray(read.getMappedRange().slice(0, bytes));
    read.unmap();
    for (const b of [src, off, palBuf, dst, params, read]) b.destroy();
    return { width, height, data: out };
  }
}
